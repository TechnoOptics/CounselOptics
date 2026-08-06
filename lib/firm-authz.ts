import 'server-only';

import { createServerSupabase, getCurrentUser } from './supabase/server';
import type { FirmRole } from './firm-types';
import {
  ACCESS_ENDED_CODE,
  ACCESS_ENDED_ERROR_NAME,
  type FirmAccessState,
} from './firm-access';

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

/**
 * The caller's role in `firmId`, distinguishing "they hold no role" from "the
 * membership row could not be read".
 *
 * callerFirmRole below collapses both into null, which is the right answer for
 * a gate: an unknown role must not be treated as a held one, and every caller
 * of it is deciding whether to ALLOW something. It is the wrong answer for a
 * surface that EXPLAINS something, because "we could not check" rendered as
 * "you are not an admin" tells the wrong person the wrong thing and offers
 * them no way to retry.
 *
 * So both exist, and the split is deliberate. Reach for this one only where
 * the difference is shown to a person. Never use `ok: false` to grant
 * anything.
 */
export type FirmRoleLookup =
  | { ok: true; role: FirmRole | null }
  | { ok: false };

export async function callerFirmRoleLookup(
  firmId: string,
): Promise<FirmRoleLookup> {
  if (!firmId) return { ok: true, role: null };
  const user = await getCurrentUser();
  if (!user) return { ok: true, role: null };
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { ok: false };
  const role = (data as { role?: FirmRole } | null)?.role;
  return { ok: true, role: role ?? null };
}

/**
 * The caller's role in `firmId`, or null if they are not a member.
 *
 * Null also covers a failed read, which is the fail-closed direction for
 * every gate that calls this. Use callerFirmRoleLookup where the two need to
 * be told apart.
 */
export async function callerFirmRole(firmId: string): Promise<FirmRole | null> {
  const lookup = await callerFirmRoleLookup(firmId);
  return lookup.ok ? lookup.role : null;
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

/** What a caller is told when their organization's access has ended. */
export const ACCESS_ENDED_ERROR = 'This organization’s access has ended.';

/**
 * The refusal, as a TYPE rather than as a sentence.
 *
 * The message above is copy and will be edited; the identity must not move
 * when it is. `code` and `name` carry that identity in process, and `digest`
 * carries it across the boundary into app/counsel/error.tsx, because Next
 * redacts the message of a server throw before a client error boundary sees
 * it but forwards `digest`. lib/firm-access.ts holds the matching predicate,
 * since that boundary is a client component and cannot import this file.
 */
export class FirmAccessEndedError extends Error {
  readonly code = ACCESS_ENDED_CODE;
  readonly digest = ACCESS_ENDED_CODE;

  constructor(message: string = ACCESS_ENDED_ERROR) {
    super(message);
    this.name = ACCESS_ENDED_ERROR_NAME;
  }
}

/**
 * Refuses when the organization's access has ended.
 *
 * THIS IS THE GATE. The layout redirect is a courtesy to a browser: every
 * `'use server'` export is a public HTTP endpoint and is callable directly,
 * with arguments of the caller's choosing, regardless of what the UI shows.
 * This codebase has shipped that exact defect twice, on the intake form path
 * and on document release, and both needed a fix round.
 *
 * Three things about this function are load-bearing, and each of them is a
 * two-line edit away from being lost.
 *
 * 1. There is NO try around firmTrialState, and there must never be one. That
 *    call throws when access cannot be determined: a read failure, a missing
 *    organization, a stored timestamp that will not parse. "Could not
 *    determine access" is not "this caller may proceed", and a catch that
 *    yields a state converts the whole fail-closed design into a fail-open
 *    one. The shape someone will copy already exists in this repo at
 *    lib/firm-cache.ts, which is `catch { return null }`. That function is
 *    tenant branding, not access. Let the throw travel: in a server action it
 *    surfaces as a failed call, in a server component it renders the error
 *    boundary, and both are refusals, which is the correct direction.
 *
 *    Calm copy for the person who sees that refusal is app/counsel/error.tsx,
 *    NOT a catch here or at a call site. A catch beside the gate is
 *    byte-identical to the fail-open above and a reviewer cannot tell intent
 *    from accident; an error boundary cannot let the action continue, because
 *    by the time it renders the write has already been refused.
 *
 * 2. The state is never cached, here or by any caller. Caching the firm ROW is
 *    fine, because a row does not change as time passes. A cached STATE
 *    outlives the trial end, which is exactly the staleness that having no
 *    scheduled job removes. firmTrialState reads a fresh clock on every call,
 *    so call it at every enforcement point.
 *
 * 3. It switches on the union rather than testing for one member, so a third
 *    access state added later is a compile error here instead of a silent
 *    default-allow.
 *
 * The import is dynamic so that lib/firm-trials.ts, and with it the
 * service-role client, stays out of the module graph of the many callers that
 * import this file only for a role check.
 */
export async function requireActiveFirm(firmId: string): Promise<void> {
  const { firmTrialState } = await import('./firm-trials');
  const state: FirmAccessState = await firmTrialState(firmId);
  switch (state) {
    case 'active':
      return;
    case 'export_only':
      throw new FirmAccessEndedError();
    default: {
      const unhandled: never = state;
      throw new Error(
        `firm-authz has no rule for the access state ${String(unhandled)}.`,
      );
    }
  }
}
