import 'server-only';

import { createServerSupabase, getCurrentUser } from './supabase/server';
import type { FirmRole } from './firm-types';

/**
 * The single place that answers "may this caller act on this firm?".
 *
 * Why it exists: every export of a `'use server'` module is a public HTTP
 * endpoint, callable by any signed-in user with arguments of their own
 * choosing. A large number of firm actions write through the service-role
 * client (`createAdminSupabase()`), which bypasses RLS entirely, so on those
 * paths the server action is the ONLY authorization there is. A
 * caller-supplied `firmId` that is never checked against the caller's own
 * membership is a cross-firm write.
 *
 * Every check here reads `firm_members` through the USER-scoped client, so
 * the caller can only ever confirm their own membership row.
 *
 * The role sets below mirror the live RLS policies so the code gate and the
 * database gate agree:
 *   firm_clients insert/update -> owner, admin, attorney
 *   firm_documents insert/update, cases update -> owner, admin, attorney, paralegal
 *   cocounsel_referrals write -> owner, admin, attorney
 */

/** Change firm-wide configuration, membership, and billing surfaces. */
export const FIRM_ADMIN_ROLES: readonly FirmRole[] = ['owner', 'admin'];

/**
 * Run a matter: invite clients and collaborators, act on referrals.
 * Matches the `firm_clients` and `cocounsel_referrals` write policies.
 */
export const FIRM_MANAGE_ROLES: readonly FirmRole[] = ['owner', 'admin', 'attorney'];

/**
 * Do case work: create and edit matters, post documents and evidence.
 * Matches the `firm_documents` write and `cases` update policies.
 * Deliberately excludes `staff`, which is advertised to firm owners as
 * "read-only access to non-privileged surfaces".
 */
export const FIRM_POSTING_ROLES: readonly FirmRole[] = [
  'owner',
  'admin',
  'attorney',
  'paralegal',
];

/** The caller's role in `firmId`, or null if they are not a member. */
export async function callerFirmRole(firmId: string): Promise<FirmRole | null> {
  if (!firmId) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role?: FirmRole } | null)?.role;
  return role ?? null;
}

/** True if the signed-in user is ANY member of `firmId` (legal team). */
export async function callerIsFirmMember(firmId: string): Promise<boolean> {
  return (await callerFirmRole(firmId)) !== null;
}

/** True only if the signed-in user is owner/admin of `firmId`. */
export async function callerIsFirmAdmin(firmId: string): Promise<boolean> {
  return callerHasFirmRole(firmId, FIRM_ADMIN_ROLES);
}

/** True only if the signed-in user holds one of `roles` in `firmId`. */
export async function callerHasFirmRole(
  firmId: string,
  roles: readonly FirmRole[],
): Promise<boolean> {
  const role = await callerFirmRole(firmId);
  return role !== null && roles.includes(role);
}
