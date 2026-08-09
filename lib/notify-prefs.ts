import 'server-only';

import type { createAdminSupabase } from './supabase/admin';

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * The one place that decides whether an employee has asked not to be emailed.
 *
 * `firm_employees.notify_prefs` was written by the Hub profile form and read
 * by nothing: five references, all five the form itself. A person who turned
 * email off kept receiving it, and had a confirmation message saying their
 * preferences were saved. The two toggles that had no send path anywhere -
 * text messages and due-date reminders - were removed rather than left
 * decorative; this key is the one with a real consumer, and these are the
 * consumers.
 *
 * SCOPE. This governs EMAIL only, never the in-app bell. A notification the
 * person sees when they open the Hub is not something the toggle offered to
 * silence, and dropping it would lose the record of what happened on their
 * request.
 *
 * FIRM MEMBERS ARE NOT COVERED. The legal team are `firm_members` and have no
 * row in `firm_employees`, so they never appear in these lookups and their
 * mail is untouched. There is no equivalent control on the counsel side.
 */

/**
 * Default ON. An absent column, an empty object and a row that predates the
 * form all mean "never chose", and never choosing is not opting out.
 */
export function employeeWantsEmail(prefs: unknown): boolean {
  if (!prefs || typeof prefs !== 'object') return true;
  return (prefs as Record<string, unknown>).email !== false;
}

/**
 * Which of these user ids have turned email off.
 *
 * A read that fails returns the empty set, so mail still goes out. Treating a
 * failed lookup as an opt-out would silence messages nobody asked to silence,
 * and the person would never learn their request had been answered.
 */
export async function emailOptedOutUserIds(
  admin: Admin,
  userIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await admin
    .from('firm_employees')
    .select('user_id, notify_prefs')
    .in('user_id', ids);
  if (error || !data) return out;
  for (const row of data as Array<{
    user_id: string | null;
    notify_prefs: unknown;
  }>) {
    if (row.user_id && !employeeWantsEmail(row.notify_prefs)) {
      out.add(row.user_id);
    }
  }
  return out;
}

/**
 * The same question for a path that knows an address rather than a user id:
 * the partner bridge emails a ticket's employee, who may never have signed in.
 */
export async function employeeEmailOptedOut(
  admin: Admin,
  firmId: string,
  email: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const { data, error } = await admin
    .from('firm_employees')
    .select('notify_prefs')
    .eq('firm_id', firmId)
    .eq('email', address)
    .maybeSingle();
  if (error || !data) return false;
  return !employeeWantsEmail((data as { notify_prefs: unknown }).notify_prefs);
}
