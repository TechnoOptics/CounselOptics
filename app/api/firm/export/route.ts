import { NextResponse } from 'next/server';
import {
  getCurrentUser,
  getRealCurrentUser,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { callerHasFirmRole, FIRM_ADMIN_ROLES } from '@/lib/firm-authz';
import { logSecurityEvent, requestMeta } from '@/lib/security-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A whole-organization archive is the one export that can legitimately take
// minutes. The other heavy routes in this app settle for 60s; this one is the
// route a departing organization depends on, so it gets the ceiling.
export const maxDuration = 300;

/**
 * The organization-scoped data export.
 *
 * ── Why this route is exempt from the access gate ────────────────────────────
 * An organization whose trial has ended is `export_only`: it can no longer
 * write, and the counsel shell redirects it away from the working surfaces.
 * This route is DELIBERATELY exempt from `requireActiveFirm` and from the
 * gated-organization layout redirect. That is not an oversight, and it is not
 * a gap to close.
 *
 * Nothing here is ever deleted on a timer. The product's answer to an expired
 * trial is "your data stays put and you can take a copy whenever you want",
 * and this route IS that answer. Gating it would mean an organization loses
 * access to its own records at exactly the moment it needs them.
 *
 * Worse than a plain lockout: if this path is ever added to the gated set, an
 * `export_only` organization asking for its export gets redirected to a page
 * that redirects it back here. That is an infinite redirect, and the data
 * becomes unreachable rather than merely inconvenient. If you are here to
 * "add the missing gate", this comment is the reason not to.
 *
 * ── Authorization ────────────────────────────────────────────────────────────
 * Owner and admin only, through `lib/firm-authz.ts`. This archive holds every
 * matter, every document record and every client name the organization has.
 * A departing paralegal downloading the whole organization is a data loss
 * incident, not an offboarding convenience. There is no fourth membership
 * axis here on purpose: `callerHasFirmRole` reads `firm_members` through the
 * USER-scoped client, so a caller can only ever confirm their own membership.
 *
 * ── The one invariant that keeps this from being a cross-organization read ───
 * Reads go through the service-role client, because firm RLS is not uniformly
 * firm-member-aware and a partial archive would be worse than none. The
 * service role bypasses RLS, so the scoping is this route's job: ONE firm id,
 * and ONE set of ids derived from it. Every query below is either
 * `.eq('firm_id', firmId)` against the single `firmId` that
 * `callerHasFirmRole` just approved, or `.in(<parent key>, ids)` over ids that
 * were themselves read under that filter. Do not add a query to this file that
 * is scoped any other way, and do not introduce a second firm id.
 *
 * ── What is not in the archive ───────────────────────────────────────────────
 * No secrets (integration, SCIM and API tokens, webhook secrets, invitation
 * and guest-account credentials) - the archive is meant to be stored on the
 * organization's own disk, so it must be safe there. Two layers keep that
 * true: the table list below, and `redactRow`, which blanks any column whose
 * NAME looks like a credential. The second layer exists because `select('*')`
 * means a column added to any of these tables lands in a customer's archive
 * with nobody reviewing it, and the promise should not depend on someone
 * remembering.
 *
 * No document file BYTES either: those live in private storage and the archive
 * carries their metadata and storage paths. Signed download URLs are
 * deliberately NOT embedded, since a URL that grants access to a private file
 * is itself a credential and does not belong in a file the organization keeps.
 * That leaves a real limitation rather than a solved problem, and the notes say
 * so plainly, in BOTH directions now that the decisions have been made.
 * `case_timeline_events.media` IS reachable: lib/firm-access.ts exempts the
 * per-matter evidence download from the access gate, specifically so this
 * archive is not an index to nothing. `/counsel/documents/<id>` is NOT: it is
 * absent from ALWAYS_ALLOWED, so a gated organization is redirected off it, and
 * the note says that rather than leaving it open. `exhibits.storage_path` is a
 * different table from the timeline media and the evidence download does not
 * serve it. The archive must not promise a door that nobody has agreed to leave
 * open, and it must not disown one that was deliberately propped.
 *
 * ── What `_summary.complete` does and does not certify ───────────────────────
 * It certifies that every table READ HERE matched the row count the database
 * reported for it. It does NOT certify that a matter is whole. A table absent
 * from `EXPORT_TABLES` can never appear in `errors`, `shortfalls` or
 * `unverified`, and neither can a column left out of a table that is read. The
 * completeness machinery is blind in exactly those two directions, so both are
 * named in `_meta.notes` rather than left for the recipient to infer.
 */

/**
 * How a table is reached.
 *
 * `firm` is the flat case: the table carries `firm_id` and one filter scopes
 * it. `case`, `signing` and `channel` are the tables that carry no usable firm
 * id and hang off a parent instead. Excluding those would have made the
 * archive's scope "whatever happens to carry firm_id", which silently drops
 * every piece of matter substance: the evidence, the timeline, the exhibits,
 * the legal reviews, the persons of interest, the collaborators and the
 * comments that a matter actually consists of.
 *
 * `case_deadlines` and `case_approaches` are here for a subtler version of the
 * same reason. They DO carry `firm_id`, but it is NULLABLE:
 * `lib/deadlines-actions.ts` writes `input.firmId ?? null` and the
 * `case_approaches` DDL declares the column without `not null`. A null there is
 * invisible to `.eq('firm_id', ...)` AND to the count probe that uses the same
 * filter, so the row would be missing and the archive would still call itself
 * complete. Reached by case id, both are exact.
 *
 * The parent id lists are collected while their own table streams, so there is
 * still exactly one firm id in this file and one set of ids derived from it.
 */
type ScopeVia = 'firm' | 'case' | 'signing' | 'channel';

type TableSpec = {
  table: string;
  via: ScopeVia;
  /**
   * The keyset cursor column. Unique and orderable. Defaults to `id`;
   * `case_timeline_narratives` is keyed by `case_id` and has no `id` at all.
   */
  key?: string;
  /**
   * An explicit column allowlist, for a table where reading every column would
   * export something that must not leave. Absent means every column, which is
   * still filtered by `redactRow`.
   */
  columns?: string;
};

type DerivedScope = Exclude<ScopeVia, 'firm'>;

/** The parent column each derived scope filters on. */
const SCOPE_COLUMN: Record<DerivedScope, string> = {
  case: 'case_id',
  signing: 'signing_request_id',
  channel: 'channel_id',
};

/** The table whose ids each derived scope is built from. */
const SCOPE_SOURCE: Record<DerivedScope, string> = {
  case: 'cases',
  signing: 'firm_signing_requests',
  channel: 'firm_channels',
};

/**
 * The inverse: which derived scope a table feeds, if any. Derived from
 * SCOPE_SOURCE so a new scope cannot be half-wired.
 */
const COLLECTS_FOR = Object.fromEntries(
  (Object.keys(SCOPE_SOURCE) as DerivedScope[]).map((via) => [
    SCOPE_SOURCE[via],
    via,
  ]),
) as Record<string, DerivedScope | undefined>;

/**
 * What an organization taking its records with it gets, grouped by what it is.
 *
 * ORDER MATTERS: a derived table must come after the table its ids come from,
 * because those ids are collected as the parent streams. A derived table that
 * runs early does not silently export nothing; it records a named error and
 * turns `_summary.complete` false.
 *
 * A table that does not exist on this deployment does not break the export:
 * the read fails, the failure is recorded by name in `_summary.errors`, the
 * archive is marked incomplete, and the rest still ships. A silent omission
 * would be the bad outcome, so omissions are always named.
 */
const EXPORT_TABLES: readonly TableSpec[] = [
  // Who the organization is and who works in it.
  { table: 'firm_members', via: 'firm' },
  { table: 'firm_employees', via: 'firm' },
  { table: 'firm_clients', via: 'firm' },
  // The matters themselves, which are the reason the archive exists.
  { table: 'cases', via: 'firm' },
  { table: 'firm_matter_intakes', via: 'firm' },
  { table: 'firm_intake_messages', via: 'firm' },
  // What the matters are actually made of. All of it hangs off case_id, so it
  // is reached through the case ids read just above. `case_deadlines` and
  // `case_approaches` are here because their `firm_id` is nullable, not
  // because they lack one; see the ScopeVia comment.
  { table: 'case_deadlines', via: 'case' },
  { table: 'case_approaches', via: 'case' },
  // Who the matter is about. Written by the firm timeline builder
  // (lib/firm-timeline-actions.ts) and rendered by the exhibit PDF as the
  // persons of interest, so leaving it out would have exported a timeline
  // whose cast list was missing.
  { table: 'case_people', via: 'case' },
  // Who was on the matter. Firm matter invites map the four firm roles onto
  // these shared rows (lib/firm-actions.ts), so this is the record of which
  // client, co-counsel or contributor had access to what.
  { table: 'case_collaborators', via: 'case' },
  { table: 'case_timeline_events', via: 'case' },
  { table: 'case_timeline_narratives', via: 'case', key: 'case_id' },
  { table: 'exhibits', via: 'case' },
  { table: 'case_legal_reviews', via: 'case' },
  { table: 'case_images', via: 'case' },
  // The collaboration work product on the matter timeline: comments anchored
  // to a specific event, exhibit or calendar period, and the matter chat.
  // `case_chat_messages.thread_key` is redacted by the credential-name guard
  // below, since it ends in `_key`. That is a false positive and a cheap one:
  // the value is `general` or `dm:<uuidA>:<uuidB>`, and both are readable back
  // from `thread_kind` and `participants`, which are exported intact.
  { table: 'case_section_comments', via: 'case' },
  { table: 'case_chat_messages', via: 'case' },
  // Documents and signing history.
  { table: 'firm_documents', via: 'firm' },
  { table: 'firm_signing_requests', via: 'firm' },
  // The per-signer record: proof that a named person executed a named document
  // at a named time, which cannot be reconstructed from the request alone. The
  // allowlist is explicit because this table carries two credentials: `token`,
  // which lib/signing-actions.ts accepts on its own as authentication, and
  // `access_code_hash`. Missing DDL is a reason to write the list out, not a
  // reason to leave the table behind.
  {
    table: 'firm_signatures',
    via: 'signing',
    columns: [
      'id',
      'signing_request_id',
      'signer_email',
      'signer_name',
      'signer_user_id',
      'signed_at',
      'ip_address',
      'user_agent',
      'signature_image_path',
      'audit_hash',
      'access_code_verified_at',
      'access_attempts',
      'response',
      'response_note',
      'responded_at',
      'position_page',
      'position_x',
      'position_y',
      // When the signer was INVITED, which is not `signed_at` and is the
      // column lib/firm-storage.ts orders the signer list by. Dropping it
      // would have reordered the archive's signers against the product's.
      'created_at',
    ].join(','),
  },
  // The tamper-evident chain behind those signatures. A `firm_signatures` row
  // ASSERTS that someone signed; this table is the record that PROVES it, with
  // `event_hash` chained to `prev_event_hash` per event
  // (lib/esign-audit.ts). It carries no credential column, and the hashes do
  // not match the credential-name guard, so the chain survives the archive
  // intact and stays verifiable. Its only other route out of the product is one
  // authenticated call per signing request against a product the organization
  // may be leaving.
  { table: 'firm_signature_events', via: 'signing' },
  // Money: the records an organization is required to keep.
  { table: 'firm_invoices', via: 'firm' },
  { table: 'firm_time_entries', via: 'firm' },
  { table: 'firm_trust_accounts', via: 'firm' },
  { table: 'firm_trust_transactions', via: 'firm' },
  { table: 'firm_trust_reconciliations', via: 'firm' },
  // Work product and day-to-day operations.
  { table: 'firm_projects', via: 'firm' },
  { table: 'firm_project_folders', via: 'firm' },
  { table: 'firm_project_items', via: 'firm' },
  // The join link stays in `firm_meetings`. It is the organization's own
  // meeting link, and the organization already holds the same links in its
  // calendar and its mail, so withholding it protects nothing. It is a
  // different asset class from a signing token, which lets a stranger execute
  // a document as the client. The narrower rules that WOULD catch it exist
  // (`/(join|invite|share|magic)_url$/`, or a `columns` allowlist on this
  // table), so this is a decision about what the column is, not a claim that
  // no rule could reach it.
  { table: 'firm_meetings', via: 'firm' },
  { table: 'firm_channels', via: 'firm' },
  // The organization's own internal communication. Excluding an entire class
  // of it from the one door left open is the same defect as leaving out the
  // matter substance, one level up. Volume is the real objection and it is a
  // TIME cost, not a memory one, because the archive streams: memory stays at
  // one page either way. One page of PAGE_SIZE rows is one round trip, so
  // maxDuration = 300 buys on the order of 3,000 pages at 100ms each, roughly
  // 3 million rows across the WHOLE archive. An organization past that gets a
  // torn stream, which does not parse, rather than a plausible short file. If
  // that becomes a live risk the answer is the `?tables=` selector, so the
  // archive can be taken in pieces, not dropping the table.
  { table: 'firm_messages', via: 'channel' },
  { table: 'firm_templates', via: 'firm' },
  { table: 'firm_policies', via: 'firm' },
  { table: 'firm_trainings', via: 'firm' },
  { table: 'firm_training_assignments', via: 'firm' },
];

/**
 * How many rows to ask for at a time. PostgREST also enforces its own
 * `db-max-rows`, which this repo does not set and cannot see, so the paging
 * loop below must not assume a page came back full. It terminates on an EMPTY
 * page and advances by a cursor, which is correct at any server cap.
 */
const PAGE_SIZE = 1000;

/**
 * How many parent ids to put in one `.in(...)` filter. PostgREST puts the
 * whole list in the query string, so an organization with tens of thousands of
 * matters would build a URL no server will accept. Chunking keeps every
 * request a sane size.
 */
const ID_CHUNK = 200;

/**
 * Column names that must never reach the archive, matched by NAME rather than
 * by table. `select('*')` over thirty tables means the "no secrets" promise is
 * otherwise kept only by whoever last read the schema; this catches the next
 * credential column by default instead of by memory. Blanking rather than
 * dropping keeps the row shape honest about what the record contains.
 *
 * `apikey` is spelled out because `_key` misses it: there is no underscore.
 * `webhook_url` is here because a Slack-style webhook URL is a bearer
 * credential whose name matches nothing else in this pattern; it is an exact
 * name rather than a URL shape, so `file_url`, `document_url`, `source_url` and
 * `join_url` are untouched. The bare key is anchored as `^key$`, a column
 * literally NAMED `key`, rather than a loose `key` alternation: unanchored it
 * would also blank `key_facts`, which is matter substance and not a secret.
 */
const CREDENTIAL_COLUMN =
  /(token|secret|password|passcode|credential|code_hash|apikey|webhook_url|_key|^key$)/i;

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  let needsRedaction = false;
  for (const column of Object.keys(row)) {
    if (CREDENTIAL_COLUMN.test(column)) {
      needsRedaction = true;
      break;
    }
  }
  if (!needsRedaction) return row;
  const safe: Record<string, unknown> = { ...row };
  for (const column of Object.keys(safe)) {
    if (CREDENTIAL_COLUMN.test(column) && safe[column] !== null) {
      safe[column] = '[redacted]';
    }
  }
  return safe;
}

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }

  // The organization to export. Defaults to the caller's active organization;
  // an explicit id is accepted so that an owner of more than one organization
  // can reach either without first switching the active one. This is safe to
  // accept from the caller for exactly one reason: it is authorized below
  // against the caller's own membership row, so an id they do not belong to
  // is a 403 rather than a read.
  const requestedFirmId = new URL(req.url).searchParams.get('firmId')?.trim() || null;
  const context = requestedFirmId ? null : await getActiveFirmContext();
  const firmId = requestedFirmId ?? context?.firm.id ?? null;
  if (!firmId) {
    return NextResponse.json(
      { error: 'No organization selected.' },
      { status: 403 },
    );
  }

  const { ip, userAgent, url } = requestMeta(req);
  // An HQ operator can be acting as a firm owner. Logging only the effective
  // user would attribute the download to the owner and lose the operator.
  const realUser = await getRealCurrentUser();
  const actingVia =
    realUser && realUser.id !== user.id
      ? { operatorId: realUser.id, operatorEmail: realUser.email ?? null }
      : null;

  if (!(await callerHasFirmRole(firmId, FIRM_ADMIN_ROLES))) {
    // A refused whole-organization export is worth more than a granted one.
    // Someone trying this repeatedly, or walking through organization ids
    // they saw in a URL, leaves no other trace anywhere. Recorded at
    // `medium` so it stays unacknowledged and lands in the triage queue
    // instead of the routine audit stream. Only `low` is auto-acknowledged,
    // so anything above it is what a triage record has to be.
    await logSecurityEvent({
      kind: 'data_exported',
      severity: 'medium',
      userId: user.id,
      ip,
      userAgent,
      url,
      details: {
        scope: 'organization',
        firmId,
        email: user.email ?? null,
        refused: true,
        reason: 'not_an_owner_or_admin',
        actingVia,
      },
    });
    return NextResponse.json(
      { error: 'Only an owner or admin can export the organization.' },
      { status: 403 },
    );
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Export is not available on this deployment.' },
      { status: 503 },
    );
  }

  // Name and slug for the archive header and the filename. Read after
  // authorization, never before it.
  const { data: firmRow } = await admin
    .from('firms')
    .select('id, name, slug, firm_type, created_at')
    .eq('id', firmId)
    .maybeSingle();
  const firm = (firmRow ?? null) as {
    id: string;
    name: string | null;
    slug: string | null;
    firm_type: string | null;
    created_at: string | null;
  } | null;

  // Audited BEFORE the transfer starts, not after it finishes. A download that
  // the client abandons half way through still handed out rows, so an audit
  // record written only on clean completion would miss the exports most worth
  // seeing. One record per request, at the moment access is granted.
  await logSecurityEvent({
    kind: 'data_exported',
    userId: user.id,
    ip,
    userAgent,
    url,
    details: {
      scope: 'organization',
      firmId,
      firmName: firm?.name ?? null,
      email: user.email ?? null,
      actingVia,
    },
  });

  const meta = {
    format: 'advottic.organization-export',
    version: 4,
    exportedAt: new Date().toISOString(),
    organization: {
      id: firmId,
      name: firm?.name ?? null,
      slug: firm?.slug ?? null,
      type: firm?.firm_type ?? null,
      createdAt: firm?.created_at ?? null,
    },
    exportedBy: user.email ?? user.id,
    notes: [
      "This organization's own records, taken at the time above. Check _summary at the end of the file before relying on it: that is where the archive says what it could and could not verify.",
      'This is a copy. Everything in it remains available in Advottic as well.',
      'What _summary.complete certifies, exactly: every table this export reads matched the row count the database reported for it just before it was read. It does not certify that a matter is whole. A table this export does not read can never appear in _summary.errors, _summary.shortfalls or _summary.unverified, and neither can a column left out of a table that is read. The tables it does read are the keys of data, and they are the whole of what complete speaks for.',
      'Matter substance is included. cases, case_deadlines, case_approaches, case_people, case_collaborators, case_timeline_events, case_timeline_narratives, exhibits, case_legal_reviews, case_images, case_section_comments and case_chat_messages are what a matter is made of. Most of them carry no organization id of their own, so they are scoped to the matters listed under cases.',
      'File contents are not embedded, only names, metadata and storage paths. This is a real limitation and not a solved one, and what remains reachable differs by kind, so it is set out plainly here rather than left to be discovered. The files listed under case_timeline_events.media can still be downloaded, a matter at a time, from the evidence download on that matter: that route is deliberately left open to an organization whose access has ended, precisely so this archive is not an index to files nobody can open. An entry in firm_documents is different: /counsel/documents/<id> is NOT reachable once access has ended, so please do not plan around it. The paths under exhibits.storage_path are not covered by the evidence download either. For anything in those last two, email contact@advottic.com and we will arrange it.',
      'firm_signatures carries the per-signer record: who signed, when, from what address, and whether the emailed access code was verified. It is the one table read with a fixed column list rather than in full, because it also holds the signing link token and the access code hash, and each of those is a credential on its own. A column withheld this way is invisible to the completeness check, since the row counts still match either way.',
      'firm_signature_events is the tamper-evident chain behind those signatures. Each event carries event_hash and prev_event_hash, chained to the event before it, which is the difference between a row asserting that someone signed and a record that proves it. What it proves is bounded, and the bound matters if you are relying on it: a passing chain establishes that the events on record are unmodified and in the order recorded, and that none has been altered or removed from the middle. It does not establish that they are all the events. An event that was never written leaves nothing behind for a hash chain to find, so a chain with a hole in it verifies exactly like a whole one. The chain can also still be verified one request at a time at /api/firm/sign/audit-trail/<signing_request_id>, which returns that limit in words alongside the result, plus any event a separately written row attests to that the chain does not hold.',
      'firm_meetings keeps its join link. It is a link to your own meeting, which you already hold in your calendar and your mail, and it is not a key to your data. That is a different thing from a signing token, which would let a stranger execute a document as your client.',
      'Any column whose name looks like a credential (token, secret, key, api key, password, passcode, credential, code hash, webhook URL) is written as [redacted]. This archive is meant to sit on your own disk, so it has to be safe there. One column is caught by that rule without being a secret: case_chat_messages.thread_key, which only groups a direct message thread and reads back from thread_kind and participants.',
      'Left out on purpose: integration, SCIM and API tokens, webhook secrets, and invitation and guest-account credentials. They are secrets that should not sit in a stored file.',
      'Read _summary at the end of this file. For every table it carries the number of rows exported, the number of rows the database reported before paging started, any read failure by name, any table that came up short, and any table whose count the database did not report at all. That last list, unverified, is not a pass: a missing count means the check itself did not run, so nothing is known about that table either way. _summary.complete is true only when nothing failed, nothing came up short, and every count was reported. If _summary is missing entirely, the transfer did not finish.',
      'Tables are read one after another, so the archive is not a single instant. A matter created while the export was running can appear in cases without its case_deadlines, and rows written after a table was read are not in that table.',
      'For another format, or for anything not covered here, email contact@advottic.com.',
    ],
  };

  const counts: Record<string, number> = {};
  /** What the database said each table held, taken before paging started. */
  const expected: Record<string, number> = {};
  /** Tables that came up short of that count, with both numbers. */
  const shortfalls: Record<string, { expected: number; exported: number }> = {};
  /**
   * Tables the check could not be run on, because the database reported no
   * count. This is NOT the same as a table with nothing in it, and treating it
   * as zero is the fail-open that the whole completeness layer exists to
   * prevent: with `count ?? 0`, an unreported count makes every table match, so
   * nothing is ever short and `complete` stays true precisely when the check
   * went dark. supabase-js yields `count: null` whenever the `Content-Range`
   * header is missing or unparsed, which is exactly that case.
   */
  const unverified: string[] = [];
  const errors: Record<string, string> = {};

  /**
   * Streamed, not buffered. A buffered archive holds every row of every table
   * in memory and sends nothing until the last one is read, so a large
   * organization is exactly where it falls over: the memory ceiling and the
   * gateway's patience are both spent before a single byte arrives. Streaming
   * keeps memory flat at one page of rows and starts the download immediately.
   *
   * Rows are written compactly rather than pretty-printed: this is a machine
   * archive, and indentation on a multi-hundred-megabyte file is pure cost.
   */
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        push(`{"_meta":${JSON.stringify(meta)},"data":{`);

        // Ids collected as their own table streams, so the tables that hang
        // off a matter or a signing request can be reached without a second
        // full read. Null means the parent list is not trustworthy: either it
        // has not run yet (a table-order mistake) or its read failed. An empty
        // ARRAY is different, and means the organization genuinely has none.
        const derivedIds: Record<DerivedScope, string[] | null> = {
          case: null,
          signing: null,
          channel: null,
        };
        /**
         * Whether each parent id list is itself count-verified. A parent whose
         * count went unreported may have handed over a partial id list, and a
         * child scoped to a partial list will match its own count and look
         * clean. So the doubt travels down with the ids rather than stopping at
         * the table that raised it.
         */
        const derivedVerified: Record<DerivedScope, boolean> = {
          case: true,
          signing: true,
          channel: true,
        };

        let firstTable = true;
        for (const spec of EXPORT_TABLES) {
          const { table, via } = spec;
          const key = spec.key ?? 'id';
          push(`${firstTable ? '' : ','}${JSON.stringify(table)}:[`);
          firstTable = false;

          // The units of work for this table: one pass for a firm-scoped
          // table, one pass per chunk of parent ids for a derived one.
          let units: Array<string[] | null> = [null];
          let unresolvedParent: string | null = null;
          if (via !== 'firm') {
            const ids = derivedIds[via];
            if (ids === null) {
              unresolvedParent = SCOPE_SOURCE[via];
              units = [];
            } else {
              units = [];
              for (let i = 0; i < ids.length; i += ID_CHUNK) {
                units.push(ids.slice(i, i + ID_CHUNK));
              }
            }
          }

          // Tables whose ids something else hangs off collect them on the way
          // past. Ids only, so the memory cost stays proportional to matter
          // count rather than to the archive.
          const collectsFor: DerivedScope | null = COLLECTS_FOR[table] ?? null;
          const collected: string[] = [];

          let rowCount = 0;
          let expectedCount = 0;
          // A derived table inherits its parent's doubt: see derivedVerified.
          let countVerified = via === 'firm' ? true : derivedVerified[via];
          let firstRow = true;
          let failed = false;

          if (unresolvedParent) {
            errors[table] =
              `Could not be scoped: the ids from ${unresolvedParent} were not available, ` +
              'because that table was not read successfully before this one.';
            failed = true;
          }

          for (const unit of units) {
            // What the database says is there, taken BEFORE paging. Without a
            // number to compare against, only an ERRORED table is detectable:
            // a table that returns 2,000 of its 5,400 rows without erroring
            // is indistinguishable from an organization that has 2,000, and
            // the archive would certify a fraction of the evidence as whole.
            const probe = admin.from(table).select('*', {
              head: true,
              count: 'exact',
            });
            const { count, error: countError } = await (via === 'firm'
              ? probe.eq('firm_id', firmId)
              : probe.in(SCOPE_COLUMN[via], unit ?? []));
            if (countError) {
              errors[table] = countError.message;
              failed = true;
              break;
            }
            // `count ?? 0` here would be the same fail-open this whole layer
            // exists to close: an unreported count would read as "this table
            // holds nothing", so nothing could ever be short and `complete`
            // would stay true exactly when the check did not run. A null count
            // is recorded as unverified instead, and it clears `complete` on
            // its own.
            if (typeof count === 'number') {
              expectedCount += count;
            } else {
              countVerified = false;
            }

            // Keyset paging, not offset paging. This export is linked from
            // /counsel/settings and runs against organizations that are still
            // working, so rows are being inserted and removed underneath it.
            // An offset is re-evaluated against the live table on every page,
            // so a row leaving before the cursor shifts everything after it up
            // and one row is never read. A cursor on an ordered unique column
            // cannot skip or duplicate, and terminating on an EMPTY page (not
            // a short one) is correct at any server row cap.
            let cursor: string | null = null;
            for (;;) {
              const query = admin.from(table).select(spec.columns ?? '*');
              const scoped =
                via === 'firm'
                  ? query.eq('firm_id', firmId)
                  : query.in(SCOPE_COLUMN[via], unit ?? []);
              const fromCursor =
                cursor === null ? scoped : scoped.gt(key, cursor);
              const { data: rows, error } = await fromCursor
                .order(key, { ascending: true })
                .limit(PAGE_SIZE);
              if (error) {
                errors[table] = error.message;
                failed = true;
                break;
              }
              // The client types a `select(<string>)` result as a per-column
              // shape it cannot know here, since the column list is data.
              const batch = (rows ?? []) as unknown as Array<
                Record<string, unknown>
              >;
              if (batch.length === 0) break;
              for (const row of batch) {
                cursor = String(row[key]);
                if (collectsFor) collected.push(String(row.id));
                push(`${firstRow ? '' : ','}${JSON.stringify(redactRow(row))}`);
                firstRow = false;
                rowCount += 1;
              }
            }
            if (failed) break;
          }

          counts[table] = rowCount;
          if (!failed) {
            if (countVerified) {
              expected[table] = expectedCount;
              // Only a SHORTFALL is a defect. More rows than the probe
              // reported just means the organization kept working during the
              // export.
              if (rowCount < expectedCount) {
                shortfalls[table] = {
                  expected: expectedCount,
                  exported: rowCount,
                };
              }
            } else {
              // No `expected` entry: a partial sum of the counts that did come
              // back would read as a number the archive stands behind.
              unverified.push(table);
            }
            // Hand the ids to the tables that hang off this one. Only on a
            // clean read: a partial parent list would scope its children to
            // less than the organization has and call the result complete.
            if (collectsFor) {
              derivedIds[collectsFor] = collected;
              derivedVerified[collectsFor] = countVerified;
            }
          }
          push(']');
        }

        push(
          `},"_summary":${JSON.stringify({
            tables: counts,
            expected,
            shortfalls,
            unverified,
            errors,
            // Computed, never asserted. A partial archive that calls itself
            // complete is the exact failure this export exists to prevent, and
            // a check that did not run counts against it rather than for it.
            complete:
              Object.keys(errors).length === 0 &&
              Object.keys(shortfalls).length === 0 &&
              unverified.length === 0,
          })}}`,
        );
        controller.close();
      } catch (err) {
        // Per-table failures are already handled above, so reaching here means
        // something unexpected. Tear the stream rather than closing it: a
        // truncated body will not parse as JSON, which is how the recipient
        // finds out. Closing cleanly would hand over a short archive that
        // looks whole.
        controller.error(err);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const safeSlug = (firm?.slug || 'organization').replace(/[^a-z0-9]+/gi, '-');
  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="advottic-export-${safeSlug}-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
