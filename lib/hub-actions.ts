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
export async function saveHubProfileAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const phone = String(formData.get('phone') ?? '')
    .trim()
    .slice(0, 32);
  const notify_prefs = {
    email: formData.get('notifyEmail') === 'on',
    sms: formData.get('notifySms') === 'on',
    reminders: formData.get('notifyReminders') === 'on',
  };
  const { error } = await admin
    .from('firm_employees')
    .update({ phone: phone || null, notify_prefs })
    .eq('user_id', user.id)
    .is('deactivated_at', null);
  if (error) return { ok: false, error: 'Could not save your preferences.' };
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
