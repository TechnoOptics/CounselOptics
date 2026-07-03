import 'server-only';

import type { createAdminSupabase } from './supabase/admin';
import {
  readPortalRoles,
  resolveEntitlements,
  type PortalFeature,
} from './portal-features';

/**
 * Server-side entitlement gate shared by every firm action a portal
 * employee can reach (filing a request, uploading intake files,
 * running Advottic Review, messaging legal).
 *
 * The rule, in one place so it can't drift between call sites:
 *   - A legal-team member (firm_members row) always has full access.
 *   - Otherwise the caller must be an ACTIVE employee (firm_employees,
 *     deactivated_at IS NULL) whose resolved role entitlements include
 *     the required feature.
 *   - Neither -> denied.
 *
 * Hiding a button in the Hub UI is not security; every action that a
 * lower-privilege role shouldn't perform must call this before it
 * writes or spends anything. Mirrors the inline check first written
 * in postIntakeThreadMessageAction (lib/intake-thread.ts).
 */
type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

export type FirmActorAuth =
  | { ok: true; role: 'legal' | 'employee' }
  | { ok: false; error: string };

export async function authorizeFirmActor(
  admin: Admin,
  firmId: string,
  userId: string,
  requiredEmployeeFeature: PortalFeature,
): Promise<FirmActorAuth> {
  // Legal-team members bypass the portal-feature model entirely.
  const { data: mem } = await admin
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (mem) return { ok: true, role: 'legal' };

  // Otherwise: active employee whose role grants the feature.
  const { data: emp } = await admin
    .from('firm_employees')
    .select('role_key')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .is('deactivated_at', null)
    .maybeSingle();
  if (!emp) {
    return { ok: false, error: 'You do not have access to this firm.' };
  }

  const { data: firmRow } = await admin
    .from('firms')
    .select('metadata')
    .eq('id', firmId)
    .maybeSingle();
  const entitlements = resolveEntitlements(
    (emp as { role_key?: string | null }).role_key ?? null,
    readPortalRoles((firmRow as { metadata?: unknown } | null)?.metadata),
  );
  if (!entitlements.includes(requiredEmployeeFeature)) {
    return { ok: false, error: 'This action is not enabled for your role.' };
  }
  return { ok: true, role: 'employee' };
}
