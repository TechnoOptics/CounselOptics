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
 */

/**
 * How a table is reached.
 *
 * `firm` is the flat case: the table carries `firm_id` and one filter scopes
 * it. `case` and `signing` are the tables that carry no firm id at all and
 * hang off a parent instead. Excluding those would have made the archive's
 * scope "whatever happens to carry firm_id", which silently drops every piece
 * of matter substance: the evidence, the timeline, the exhibits, the legal
 * reviews and the images that a matter actually consists of.
 *
 * The parent id lists are collected while their own table streams, so there is
 * still exactly one firm id in this file and one set of ids derived from it.
 */
type ScopeVia = 'firm' | 'case' | 'signing';

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

/** The parent column each derived scope filters on. */
const SCOPE_COLUMN: Record<Exclude<ScopeVia, 'firm'>, string> = {
  case: 'case_id',
  signing: 'signing_request_id',
};

/** The table whose ids each derived scope is built from. */
const SCOPE_SOURCE: Record<Exclude<ScopeVia, 'firm'>, string> = {
  case: 'cases',
  signing: 'firm_signing_requests',
};

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
  { table: 'case_deadlines', via: 'firm' },
  { table: 'case_approaches', via: 'firm' },
  { table: 'firm_matter_intakes', via: 'firm' },
  { table: 'firm_intake_messages', via: 'firm' },
  // What the matters are actually made of. All of it hangs off case_id, so it
  // is reached through the case ids read just above.
  { table: 'case_timeline_events', via: 'case' },
  { table: 'case_timeline_narratives', via: 'case', key: 'case_id' },
  { table: 'exhibits', via: 'case' },
  { table: 'case_legal_reviews', via: 'case' },
  { table: 'case_images', via: 'case' },
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
    ].join(','),
  },
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
  { table: 'firm_meetings', via: 'firm' },
  { table: 'firm_channels', via: 'firm' },
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
 */
const CREDENTIAL_COLUMN = /(token|secret|password|code_hash|_key)/i;

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
    // `warning` so it stays unacknowledged and lands in the triage queue
    // instead of the routine audit stream.
    await logSecurityEvent({
      kind: 'data_exported',
      severity: 'warning',
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
    version: 3,
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
      "This organization's own records, taken at the time above. Check _summary at the end of the file before relying on it: that is where the archive says whether everything came through.",
      'This is a copy. Everything in it remains available in Advottic as well.',
      'Matter substance is included. case_timeline_events, case_timeline_narratives, exhibits, case_legal_reviews and case_images carry no organization id of their own, so they are scoped to the matters listed under cases.',
      'Document file contents are not embedded. Each entry in firm_documents carries its name, metadata and storage path, and the file itself can be downloaded from /counsel/documents/<id> while signed in.',
      'firm_signatures carries the per-signer record: who signed, when, from what address, and whether the emailed access code was verified. The signing link token and the access code hash are left out because each one is a credential on its own. The full tamper-evident event chain stays available per request at /api/firm/sign/audit-trail/<signing_request_id>.',
      'Any column whose name looks like a credential (token, secret, key, password, code hash) is written as [redacted]. This archive is meant to sit on your own disk, so it has to be safe there.',
      'Left out on purpose: integration, SCIM and API tokens, webhook secrets, invitation and guest-account credentials, and internal chat messages. The first group are secrets that should not sit in a stored file; chat is held per channel rather than per organization.',
      'Read _summary at the end of this file. For every table it carries the number of rows exported, the number of rows the database reported before paging started, any read failure by name, and any table that came up short. _summary.complete is true only when nothing failed and every table matched its count. If _summary is missing entirely, the transfer did not finish.',
      'Tables are read one after another, so the archive is not a single instant. A matter created while the export was running can appear in cases without its case_deadlines, and rows written after a table was read are not in that table.',
      'For another format, or for anything not covered here, email contact@advottic.com.',
    ],
  };

  const counts: Record<string, number> = {};
  /** What the database said each table held, taken before paging started. */
  const expected: Record<string, number> = {};
  /** Tables that came up short of that count, with both numbers. */
  const shortfalls: Record<string, { expected: number; exported: number }> = {};
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
        const derivedIds: Record<Exclude<ScopeVia, 'firm'>, string[] | null> = {
          case: null,
          signing: null,
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
          const collectsFor: Exclude<ScopeVia, 'firm'> | null =
            table === SCOPE_SOURCE.case
              ? 'case'
              : table === SCOPE_SOURCE.signing
                ? 'signing'
                : null;
          const collected: string[] = [];

          let rowCount = 0;
          let expectedCount = 0;
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
            expectedCount += count ?? 0;

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
            expected[table] = expectedCount;
            // Only a SHORTFALL is a defect. More rows than the probe reported
            // just means the organization kept working during the export.
            if (rowCount < expectedCount) {
              shortfalls[table] = {
                expected: expectedCount,
                exported: rowCount,
              };
            }
            // Hand the ids to the tables that hang off this one. Only on a
            // clean read: a partial parent list would scope its children to
            // less than the organization has and call the result complete.
            if (collectsFor) derivedIds[collectsFor] = collected;
          }
          push(']');
        }

        push(
          `},"_summary":${JSON.stringify({
            tables: counts,
            expected,
            shortfalls,
            errors,
            // Computed, never asserted. A partial archive that calls itself
            // complete is the exact failure this export exists to prevent.
            complete:
              Object.keys(errors).length === 0 &&
              Object.keys(shortfalls).length === 0,
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
