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
 * service role bypasses RLS, so the scoping is this route's job: EVERY query
 * below is `.eq('firm_id', firmId)` against the single `firmId` that
 * `callerHasFirmRole` just approved. Do not add a query to this file without
 * that filter, and do not introduce a second firm id.
 *
 * ── What is not in the archive ───────────────────────────────────────────────
 * No secrets (integration, SCIM and API tokens, webhook secrets, invitation
 * and guest-account credentials) - the archive is meant to be stored on the
 * organization's own disk, so it must be safe there. No document file BYTES
 * either: those live in private storage and the archive carries their metadata
 * and storage paths. Signed download URLs are deliberately NOT embedded, since
 * a URL that grants access to a private file is itself a credential and does
 * not belong in a file the organization keeps.
 */

/**
 * The organization-scoped tables that are useful to an organization taking its
 * records with it, grouped by what they are. Every one of these is keyed by
 * `firm_id`, which is what makes the scoping invariant above a single uniform
 * rule rather than a per-table judgment call.
 *
 * A table that does not exist on this deployment does not break the export:
 * the read fails, the failure is recorded by name in `_summary.errors`, and
 * the rest of the archive still ships. A silent omission would be the bad
 * outcome, so omissions are always named.
 */
const EXPORT_TABLES = [
  // Who the organization is and who works in it.
  'firm_members',
  'firm_employees',
  'firm_clients',
  // The matters themselves, which are the reason the archive exists.
  'cases',
  'case_deadlines',
  'case_approaches',
  'firm_matter_intakes',
  'firm_intake_messages',
  // Documents and signing history.
  'firm_documents',
  'firm_signing_requests',
  // Money: the records an organization is required to keep.
  'firm_invoices',
  'firm_time_entries',
  'firm_trust_accounts',
  'firm_trust_transactions',
  'firm_trust_reconciliations',
  // Work product and day-to-day operations.
  'firm_projects',
  'firm_project_folders',
  'firm_project_items',
  'firm_meetings',
  'firm_channels',
  'firm_templates',
  'firm_policies',
  'firm_trainings',
  'firm_training_assignments',
] as const;

/**
 * PostgREST caps a single response at 1000 rows. Reading each table once, the
 * way the older export did, therefore returns the first 1000 rows and says
 * nothing about the rest: fine for a three-matter trial, quietly wrong for a
 * real organization, which is the failure mode that matters least when you
 * test it and most when it is used. Every table below is paged to exhaustion.
 */
const PAGE_SIZE = 1000;

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

  if (!(await callerHasFirmRole(firmId, FIRM_ADMIN_ROLES))) {
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
  const { ip, userAgent, url } = requestMeta(req);
  // An HQ operator can be acting as a firm owner. Logging only the effective
  // user would attribute the download to the owner and lose the operator.
  const realUser = await getRealCurrentUser();
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
      actingVia:
        realUser && realUser.id !== user.id
          ? { operatorId: realUser.id, operatorEmail: realUser.email ?? null }
          : null,
    },
  });

  const meta = {
    format: 'advottic.organization-export',
    version: 2,
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
      "A complete copy of this organization's own records, taken at the time above.",
      'This is a copy. Everything in it remains available in Advottic as well.',
      'Document file contents are not embedded. Each entry in firm_documents carries its name, metadata and storage path, and the file itself can be downloaded from /counsel/documents/<id> while signed in.',
      'Per-signer signature records and the signing audit trail are available per request at /api/firm/sign/audit-trail/<signing_request_id>.',
      'Excluded on purpose: integration, SCIM and API tokens, webhook secrets, invitation and guest-account credentials, and internal chat messages. The first group are secrets that should not sit in a stored file; chat is held per channel rather than per organization.',
      'Read _summary at the end of this file. It carries the row count for every table and names anything that could not be read. If _summary is missing the transfer did not finish.',
      'For another format, or for anything not covered here, email contact@advottic.com.',
    ],
  };

  const counts: Record<string, number> = {};
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

        let firstTable = true;
        for (const table of EXPORT_TABLES) {
          push(`${firstTable ? '' : ','}${JSON.stringify(table)}:[`);
          firstTable = false;

          let rowCount = 0;
          let firstRow = true;
          let offset = 0;
          for (;;) {
            // Ordered by id so the pages compose into one consistent set.
            // An unordered paged read has no guaranteed order between pages,
            // which duplicates some rows and drops others without saying so.
            const { data: rows, error } = await admin
              .from(table)
              .select('*')
              .eq('firm_id', firmId)
              .order('id', { ascending: true })
              .range(offset, offset + PAGE_SIZE - 1);
            if (error) {
              errors[table] = error.message;
              break;
            }
            const batch = rows ?? [];
            for (const row of batch) {
              push(`${firstRow ? '' : ','}${JSON.stringify(row)}`);
              firstRow = false;
              rowCount += 1;
            }
            if (batch.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }
          counts[table] = rowCount;
          push(']');
        }

        push(
          `},"_summary":${JSON.stringify({
            tables: counts,
            errors,
            complete: true,
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
