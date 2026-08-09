import 'server-only';

import type { createAdminSupabase } from './supabase/admin';

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * Which requests an employee is allowed to see in the Hub.
 *
 * The rule is: a request you created, or a request you were explicitly
 * invited onto (a `firm_intake_participants` row), inside your own firm.
 * Nothing wider.
 *
 * This used to be written twice. The detail page unioned `created_by` with
 * the participants table, but every list page filtered on `created_by`
 * alone, so an invited colleague could only ever reach a request through
 * the link in their email, and an external collaborator, who by definition
 * never files anything, had a Hub that was empty by construction. Both
 * shapes now come from here, so the two cannot drift again.
 */

/** Every intake id in `firmId` that `userId` created or was invited onto. */
export async function visibleIntakeIds(
  admin: Admin,
  userId: string,
  firmId: string,
): Promise<string[]> {
  const [ownRes, partRes] = await Promise.all([
    admin
      .from('firm_matter_intakes')
      .select('id')
      .eq('firm_id', firmId)
      .eq('created_by', userId)
      .limit(200),
    admin
      .from('firm_intake_participants')
      .select('intake_id')
      .eq('firm_id', firmId)
      .eq('user_id', userId)
      .limit(200),
  ]);

  const ids = new Set<string>();
  for (const r of (ownRes.data ?? []) as { id: string }[]) ids.add(r.id);
  for (const r of (partRes.data ?? []) as { intake_id: string }[]) {
    ids.add(r.intake_id);
  }
  return [...ids];
}

/**
 * The same rule for a single request. Used by the detail page, where
 * loading every id the user can see would be wasteful and the answer is
 * one row either way.
 */
export async function canViewIntake(
  admin: Admin,
  intake: { id: string; firm_id: string; created_by: string | null },
  userId: string,
  firmId: string,
): Promise<boolean> {
  if (intake.firm_id !== firmId) return false;
  if (intake.created_by === userId) return true;
  const { data } = await admin
    .from('firm_intake_participants')
    .select('id')
    .eq('intake_id', intake.id)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * The subset of `intakeIds` whose most recent message is from legal.
 *
 * There is no read-state tracking on `firm_intake_messages` (no per-user
 * last-read marker exists anywhere in the schema), so "awaiting you" is
 * defined as: legal spoke last and you have not answered. That is the same
 * definition the rest of the Hub uses when it says a request needs a reply.
 *
 * Only `visibility = 'shared'` rows count. Counting internal notes would
 * leak both that they exist and how many there are, which is the one thing
 * the internal-note feature must never do.
 */
export async function intakesAwaitingReply(
  admin: Admin,
  intakeIds: string[],
): Promise<Set<string>> {
  const awaiting = new Set<string>();
  if (intakeIds.length === 0) return awaiting;

  const { data } = await admin
    .from('firm_intake_messages')
    .select('intake_id, author_role, created_at')
    .in('intake_id', intakeIds)
    .eq('visibility', 'shared')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);

  const seen = new Set<string>();
  for (const m of (data ?? []) as {
    intake_id: string;
    author_role: string;
  }[]) {
    // Rows arrive newest first, so the first one per intake is the latest.
    if (seen.has(m.intake_id)) continue;
    seen.add(m.intake_id);
    if (m.author_role === 'legal') awaiting.add(m.intake_id);
  }
  return awaiting;
}

/**
 * The newest shared message on one request, or null when it has none.
 *
 * The mirror image of intakesAwaitingReply, for the side that asks "is legal
 * still the one who owes an answer". It is deliberately per-request rather
 * than batched: the reminder sweep only needs this for the handful of tickets
 * that have already passed every cheap gate, and a batched newest-first query
 * silently mislabels a quiet request as having no messages once a chattier one
 * fills the row limit. Guessing "no messages" is the direction that sends mail
 * to attorneys who are not owed a nudge.
 *
 * Only `visibility = 'shared'` counts. An internal legal note is not an answer
 * to the employee, and treating it as one would stop a reminder the requester
 * is still waiting on.
 */
export async function latestSharedIntakeMessage(
  admin: Admin,
  intakeId: string,
): Promise<{ author_role: string; created_at: string } | null> {
  const { data } = await admin
    .from('firm_intake_messages')
    .select('author_role, created_at')
    .eq('intake_id', intakeId)
    .eq('visibility', 'shared')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { author_role: string; created_at: string } | null) ?? null;
}
