'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Hub (employee/client) self-service writes. Employees aren't
 * firm_members, so these go through the service-role client scoped
 * strictly to the signed-in user's own rows - the same containment
 * pattern the rest of /portal uses.
 */
/**
 * The Hub's one notification preference.
 *
 * It used to save three toggles and a mobile number, and nothing anywhere
 * read any of them: a person who turned email off kept receiving it and was
 * told their preferences were saved. Email is now honoured on both employee
 * send paths (see lib/notify-prefs.ts). Text messages and due-date reminders
 * were removed instead of wired, because no code path sends an employee
 * either one, and the mobile number went with the texts that were never sent.
 *
 * `email` is written as an explicit boolean, and an unchecked box posts
 * nothing at all, which is why absence has to mean false HERE. Everywhere it
 * is READ, a missing key means "never chose" and defaults to on.
 */
export async function saveHubProfileAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const notify_prefs = { email: formData.get('notifyEmail') === 'on' };
  const { data, error } = await admin
    .from('firm_employees')
    .update({ notify_prefs })
    .eq('user_id', user.id)
    .is('deactivated_at', null)
    .select('id');
  if (error) return { ok: false, error: 'Could not save your preferences.' };
  // PostgREST reports no error when a filter matches nothing, so without the
  // select above a save that wrote no row would report success and the
  // toggle would spring back on the next load with no explanation.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'Could not find your employee record, so nothing was saved.',
    };
  }
  revalidatePath('/portal/profile');
  return { ok: true };
}

export async function completeTrainingAction(
  assignmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const { error } = await admin
    .from('firm_training_assignments')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .eq('employee_user_id', user.id);
  if (error) return { ok: false, error: 'Could not update that.' };
  revalidatePath('/portal/trainings');
  revalidatePath('/portal');
  return { ok: true };
}
