import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The per-firm opt-in for recurring-face detection (biometric / special-category
 * data). The feature is OFF by default and processes ZERO faces until a firm
 * turns it on. See docs/face-detection-spike.md and R14 in
 * docs/compliance/policies/risk-register.md.
 *
 * These are pure server-side reads over the admin client, used by both the
 * detection pipeline (gate before doing any face work) and the settings UI.
 * Writes + purge-on-disable live in lib/face-actions.ts.
 */

export type FirmFaceSetting = {
  enabled: boolean;
  updatedAt: string | null;
};

/** Read a firm's recurring-face opt-in (defaults to OFF when no row exists). */
export async function getFirmFaceSetting(
  admin: SupabaseClient,
  firmId: string,
): Promise<FirmFaceSetting> {
  const { data } = await admin
    .from('firm_settings')
    .select('recurring_faces_enabled, recurring_faces_updated_at')
    .eq('firm_id', firmId)
    .maybeSingle();
  const r = data as
    | { recurring_faces_enabled: boolean; recurring_faces_updated_at: string | null }
    | null;
  return {
    enabled: Boolean(r?.recurring_faces_enabled),
    updatedAt: r?.recurring_faces_updated_at ?? null,
  };
}

/**
 * True only if the case's owning firm has explicitly enabled recurring-face
 * detection. This is the hard gate the detection pipeline checks before it
 * touches a single pixel: no firm, no firm opt-in => no face processing.
 */
export async function facesEnabledForCase(
  admin: SupabaseClient,
  caseId: string,
): Promise<boolean> {
  const { data: kase } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (kase as { firm_id: string | null } | null)?.firm_id;
  if (!firmId) return false;
  const setting = await getFirmFaceSetting(admin, firmId);
  return setting.enabled;
}
