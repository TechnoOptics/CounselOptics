'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Owner/admin writes for the per-firm surface toggles
 * (firm_settings.hide_search / hide_time_billing). Reads live in
 * lib/firm-settings.ts.
 *
 * The write goes through the admin client with an explicit owner/admin
 * check (defense in depth; the firm_settings_admin_write RLS policy
 * enforces the same rule). We upsert so a firm that has never touched
 * its settings still gets a row created on first save.
 */

async function callerIsFirmAdmin(firmId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

export async function updateFirmSurfaceSettingsAction(
  firmId: string,
  input: { hideSearch: boolean; hideTimeBilling: boolean },
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { error } = await admin
    .from('firm_settings')
    .upsert(
      {
        firm_id: firmId,
        hide_search: Boolean(input.hideSearch),
        hide_time_billing: Boolean(input.hideTimeBilling),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id' },
    );
  if (error) return { ok: false, error: error.message };

  // These flags change the chrome the whole workspace renders, so bust
  // the counsel layout + settings caches.
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}
