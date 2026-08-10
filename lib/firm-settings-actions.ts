'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { isUnknownColumnError } from './signer-view';
import { normalizeMatterPrefix, normalizeTicketPrefix } from './ticket-numbers';

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

/**
 * The letters in front of every ticket number this firm issues.
 *
 * Its own action, and its own upsert naming only this column, for the same
 * reason getFirmTicketPrefix is its own read: `ticket_prefix` arrives with
 * 20260807_flow_join.sql and is not applied yet. Folding it into the surface
 * toggles above would make saving a toggle fail on an unmigrated database,
 * and a firm would lose the ability to change settings that work today
 * because of a setting that does not exist yet.
 *
 * Changing the prefix renumbers nothing. Every number already on a filed
 * document keeps the prefix it was filed under, and the series carries on
 * from where it was rather than restarting onto numbers that are already out.
 */
export async function updateFirmTicketPrefixAction(
  firmId: string,
  prefix: string,
): Promise<{ ok: boolean; error?: string; prefix?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  // Normalised before it is stored, not only when it is read, so what the
  // firm sees on the settings page afterwards is what will actually appear on
  // their documents.
  const stored = normalizeTicketPrefix(prefix);
  const { error } = await admin
    .from('firm_settings')
    .upsert(
      { firm_id: firmId, ticket_prefix: stored, updated_at: new Date().toISOString() },
      { onConflict: 'firm_id' },
    );
  if (error) {
    if (isUnknownColumnError(error, 'ticket_prefix')) {
      return {
        ok: false,
        error:
          'Ticket numbers are not switched on yet. Ask your administrator to apply the pending database update.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/counsel/settings');
  return { ok: true, prefix: stored };
}

/**
 * The letters in front of every matter reference this firm issues.
 *
 * Its own action and its own single-column upsert, for the reason the ticket
 * prefix above has one: `matter_prefix` arrives with
 * supabase/migrations/20260813_matter_number.sql and is not applied, and
 * folding it into a shared write would make saving a setting that works today
 * fail because of one that does not exist yet.
 *
 * Changing the prefix renumbers nothing. Every matter keeps the reference it
 * was opened under, which is the whole point of a reference, and the series
 * carries on from where it was rather than restarting onto numbers that are
 * already on filings (the allocator reads the trailing digits and ignores
 * whatever is in front of them).
 */
export async function updateFirmMatterPrefixAction(
  firmId: string,
  prefix: string,
): Promise<{ ok: boolean; error?: string; prefix?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const stored = normalizeMatterPrefix(prefix);
  const { error } = await admin
    .from('firm_settings')
    .upsert(
      { firm_id: firmId, matter_prefix: stored, updated_at: new Date().toISOString() },
      { onConflict: 'firm_id' },
    );
  if (error) {
    if (isUnknownColumnError(error, 'matter_prefix')) {
      return {
        ok: false,
        error:
          'Matter reference numbers are not switched on yet. Ask your administrator to apply the pending database update.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/counsel/settings');
  revalidatePath('/counsel/cases');
  return { ok: true, prefix: stored };
}
