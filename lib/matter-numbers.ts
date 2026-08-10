import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmMember } from './firm-authz';
import { allocateMatterNumber, readMatterPrefix } from './ticket-allocator';

/**
 * Reading, and where needed allocating, a matter's reference number.
 *
 * NOT a `'use server'` module, on purpose. Every export of one is a public
 * HTTP endpoint callable by any signed-in user with arguments of their own
 * choosing, and `ensureMatterNumber` takes a firm id and a case id and writes
 * through the service role. Keeping it a plain server module means the only
 * things that can reach it are the server components in this repo that import
 * it, each of which has already established the caller's firm. It re-checks
 * membership through lib/firm-authz.ts anyway before it writes, because that
 * is the one firm authorization axis and a second surface may import this
 * later.
 *
 * EVERY READ HERE DEGRADES TO "NO NUMBER" RATHER THAN THROWING.
 * `cases.matter_number` and `firm_settings.matter_prefix` arrive with
 * supabase/migrations/20260813_matter_number.sql, which is applied to
 * production (commit 0e46e947) and is NOT applied everywhere: a preview
 * branch, a colleague's local database and a restored copy each run whatever
 * schema they were built from. PostgREST reports an absent column as an error
 * on the whole request, so a database without the column has to read as "this
 * matter has no number yet" and let the caller show the fallback
 * (displayMatterNumber). The alternative is a matter page that 500s until
 * somebody runs a migration.
 *
 * SEPARATE QUERIES, NOT COLUMNS ADDED TO EXISTING READS, for the reason
 * lib/firm-settings.ts gives at getFirmTicketPrefix: the matter page selects a
 * fixed column list, and naming an unapplied column in it would fail that
 * request and take the whole page down with it. The same argument is why the
 * two counsel export routes call readMatterNumber instead of widening their
 * own fixed select: there the request that fails is the one that fetches the
 * matter, so the export would not print a worse reference, it would 500.
 */

/** The letters in front of this firm's matter numbers, for the settings page. */
export async function getFirmMatterPrefix(firmId: string): Promise<string> {
  return readMatterPrefix(createServerSupabase(), firmId);
}

/**
 * Every numbered matter in this firm, as `case id -> reference`.
 *
 * One query for the whole list rather than one per row, and read through the
 * user-scoped client so RLS is still the gate on which matters this caller can
 * see. A matter that is missing from the map has no number and the list shows
 * its fallback.
 */
export async function listMatterNumbers(
  firmId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data, error } = await createServerSupabase()
      .from('cases')
      .select('id, matter_number')
      .eq('firm_id', firmId)
      .not('matter_number', 'is', null);
    if (error || !data) return out;
    for (const row of data as { id: string; matter_number: string | null }[]) {
      const stored = (row.matter_number ?? '').trim();
      if (stored) out.set(row.id, stored);
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * This matter's reference, allocating one if it does not have it yet.
 *
 * WHY ALLOCATION HAPPENS HERE AND NOT AT CREATION. Creation would be the
 * obvious place, and it is where this belongs; the two paths that insert a
 * firm matter both live in lib/firm-actions.ts, which another session owns
 * outright while this lands. Allocating on first read of the matter covers
 * every creation path at once instead of the one this branch could reach,
 * including any added later, and the migration numbers everything that
 * already exists, so in practice this only ever fires for a matter created
 * after the migration and it fires within a second of creation: opening a new
 * matter redirects straight to this page. Moving the call into the creation
 * actions once that file is free would change nothing a firm sees.
 *
 * IT CANNOT RENUMBER. The allocator's write is conditional on the column
 * still being null, so a second tab, a refresh and a late caller all read the
 * number that is already there rather than issuing another one.
 *
 * FAILURE IS NEVER FATAL. Every path returns null instead of throwing, and
 * null renders as the fallback the matter already showed. A matter must not
 * become unopenable because a counter would not move.
 */
export async function ensureMatterNumber(
  firmId: string,
  caseId: string,
): Promise<string | null> {
  const stored = await readMatterNumber(createServerSupabase(), firmId, caseId);
  if (stored) return stored;

  // Only past this point does anything get written, so the membership check
  // sits here rather than at the top: a matter that already has its number
  // costs one read and no authorization round trip.
  if (!(await callerIsFirmMember(firmId))) return null;

  const admin = createAdminSupabase();
  if (!admin) return null;
  const res = await allocateMatterNumber(admin, { firmId, caseId });
  return res.ok ? res.ticketNumber : null;
}

/**
 * The number already on this matter, or null (including "not migrated").
 *
 * IT TAKES ITS CLIENT rather than making one, because the two kinds of caller
 * are already holding different ones and neither can use the other's. A matter
 * page reads as the signed-in attorney, so RLS stays the gate on which matters
 * they can see. The two counsel export routes have already authorized the
 * caller themselves, as EITHER a firm member OR a case-scoped co-counsel
 * guest, and read the matter through the service role for exactly that reason:
 * the firm RLS on `cases` does not admit a guest, so a user-scoped read here
 * would hand an outside co-counsel the uuid fallback on an exhibit while the
 * matter page they were looking at showed the reference.
 *
 * `firmId` is not decoration. The service role bypasses RLS, so the firm
 * filter is what stops a caller authorized for one organization from reading
 * another organization's reference by id, and it is applied here rather than
 * left to each call site to remember.
 */
export async function readMatterNumber(
  client: SupabaseClient,
  firmId: string,
  caseId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from('cases')
      .select('matter_number')
      .eq('id', caseId)
      .eq('firm_id', firmId)
      .maybeSingle();
    if (error || !data) return null;
    const stored = (data as { matter_number: string | null }).matter_number ?? '';
    return stored.trim() || null;
  } catch {
    return null;
  }
}
