'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getFirmFaceSetting } from './face-settings';

/**
 * Firm-scoped actions for recurring-face detection (biometric / special-category
 * data). Like the rest of firm evidence, firm members are NOT case members, so
 * every read/write goes through the ADMIN client, gated on the caller being a
 * member of the firm (and, for case work, the case belonging to that firm) -
 * mirroring lib/case-evidence-actions.ts.
 *
 * This file owns the opt-in toggle (with purge-on-disable). Face reads +
 * merge/split/label land here too as the feature is built out.
 */

/** The current user is an owner/admin of `firmId`. */
async function assertFirmAdmin(
  firmId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (member as { role: string } | null)?.role;
  if (!role) return { ok: false, error: 'You do not have access to this firm.' };
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only a firm owner or admin can change this setting.' };
  }
  return { ok: true, userId: user.id };
}

/** Read the firm's recurring-face opt-in (any firm member). */
export async function getRecurringFacesEnabledAction(
  firmId: string,
): Promise<{ ok: boolean; enabled?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You do not have access to this firm.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const setting = await getFirmFaceSetting(admin, firmId);
  return { ok: true, enabled: setting.enabled };
}

/**
 * Turn recurring-face detection on or off for a firm (owner/admin only).
 *
 * Turning it OFF is a purge: every face vector + cluster the firm holds, across
 * all its matters, is hard-deleted. This is deliberate - face embeddings are
 * biometric identifiers, so switching the feature off must leave none behind
 * (R14 retention commitment). Turning it back on starts from an empty slate;
 * faces are re-detected as evidence is (re-)analysed.
 */
export async function setRecurringFacesEnabledAction(
  firmId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string; purged?: number }> {
  const gate = await assertFirmAdmin(firmId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const now = new Date().toISOString();
  const { error: upErr } = await admin
    .from('firm_settings')
    .upsert(
      {
        firm_id: firmId,
        recurring_faces_enabled: enabled,
        recurring_faces_updated_at: now,
        recurring_faces_updated_by: gate.userId,
        updated_at: now,
      },
      { onConflict: 'firm_id' },
    );
  if (upErr) return { ok: false, error: upErr.message };

  let purged = 0;
  if (!enabled) {
    // Collect the firm's cases, then hard-delete their face vectors + clusters.
    const { data: cases } = await admin.from('cases').select('id').eq('firm_id', firmId);
    const caseIds = ((cases ?? []) as { id: string }[]).map((c) => c.id);
    if (caseIds.length) {
      const { count } = await admin
        .from('case_evidence_faces')
        .delete({ count: 'exact' })
        .in('case_id', caseIds);
      purged = count ?? 0;
      await admin.from('case_face_clusters').delete().in('case_id', caseIds);
    }
  }

  revalidatePath('/counsel');
  return { ok: true, purged };
}
