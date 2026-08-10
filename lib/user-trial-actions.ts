'use server';

import { revalidatePath } from 'next/cache';
import { getRealCurrentUser, isCurrentUserAdmin } from './supabase/server';
import { logSecurityEvent } from './security-audit';
import { applyUserTrialAction, readUserTrialSnapshot } from './user-trials';
import { ENTITLEMENT_TIER_SLUGS, isEntitlementTierSlug } from './entitlements';

/**
 * The five HQ trial levers for an INDIVIDUAL user, and the only place the
 * browser can reach lib/user-trials.ts. The organization equivalent is
 * lib/firm-trial-actions.ts; this mirrors it deliberately, including the three
 * rules it exists to hold.
 *
 * THE FIRST RULE: every export below is a public HTTP endpoint. Next compiles
 * each one into a POST route with a stable id, and any signed-in visitor can
 * call it directly with a hand-written request. They do not have to load
 * /admin, so the gate at app/admin/layout.tsx protects the PAGE and protects
 * nothing here. This codebase has shipped the "gate in the UI, action still
 * callable" defect before. So every action's first statement resolves the
 * caller itself through hqActor(), which runs the same isCurrentUserAdmin()
 * check the layout runs, and nothing below reads an identity, a role or an
 * admin claim out of its arguments, because an argument is whatever the caller
 * typed.
 *
 * THE SECOND RULE: days, never dates. Every trial length here is a COUNT of
 * days. An <input type="date"> yields '2026-08-01' and an
 * <input type="datetime-local"> yields '2026-08-01T12:00'; the timestamp
 * parser accepts both and misreads both, the first as UTC midnight and the
 * second as the server's local time. A count has no zone to lose.
 *
 * THE THIRD RULE: an action named after a precondition checks it HERE. Grant
 * starts a clock on an account that has none, and extend moves a date that
 * already exists. Both are claims about stored state, and a control the
 * browser declines to render is not a check.
 *
 * WHAT THESE LEVERS CANNOT DO, said plainly because it is the money question:
 * none of them can change what a PAYING customer is entitled to. The trial and
 * the subscription are separate stored facts, and lib/trial-entitlement.ts
 * resolves the paid one ahead of the trial, structurally. A trial set on an
 * account that pays is inert until the payment stops.
 *
 * WHAT THEY ALSO CANNOT DO: remove anybody's data. A trial ending ends access
 * on a date. Nothing on this path deletes anything.
 */

/**
 * `notice` is a change that LANDED and will not do what the operator expects.
 *
 * It is not an error and not a warning about what might happen. It is the
 * second half of a true success: the date moved, and the person will see
 * nothing, because profiles.is_blocked outranks every trial date. An HQ admin
 * is usually mid-conversation with the customer when they touch this, so it
 * exists to stop them saying "you're back on" when nobody is.
 *
 * Optional rather than always present, so an ordinary extension carries no
 * sentence at all and the presence of one means something.
 */
export type UserTrialActionResult =
  | { ok: true; notice?: string }
  | { ok: false; error: string };

/**
 * WHY THIS COMPLETES AND REPORTS RATHER THAN REFUSING. Same argument as
 * lib/firm-trial-actions.ts, and it should stay the same argument: the end date
 * is the record of what was agreed, so declining to store it loses the
 * agreement, and refusing would make unblocking the only route to extending a
 * blocked account, which pressures an operator into readmitting somebody who
 * was closed on purpose.
 *
 * The remedy names the Active toggle on this same page, because a sentence that
 * says only "this did nothing" sends the operator hunting.
 */
const BLOCKED_NOTICE =
  'The end date was saved, but this account is blocked, so it stays locked out and this person will not see a change. Set the account back to active to let them in.';

/**
 * Grant, extend and restart all take a length in days. The ceiling is a typo
 * guard rather than a policy: it is what stops a stray keystroke turning a 14
 * day pilot into a 14000 day one, which no later screen would flag because a
 * far-future end date looks exactly like a paying account.
 *
 * These bounds are not exported. A 'use server' module may only export async
 * functions, and the numbers are repeated in the controls purely to set the
 * input's min and max. The copy of the check that decides anything is this
 * one, because the browser's is a hint and a direct caller never sees it.
 */
const MIN_TRIAL_DAYS = 1;
const MAX_TRIAL_DAYS = 365;
const MAX_NOTE_LENGTH = 500;

/**
 * Resolves the acting admin, or refuses. Identical in every respect to the
 * organization one, including reading the actor from the REAL session rather
 * than the effective one: HQ has an "act as" overlay, and an audit row naming
 * the account someone was looking at instead of the person at the keyboard is
 * worse than no row.
 *
 * A REFUSAL LEAVES A TRACE. These are public POST endpoints on commercial
 * levers, and this surface exists to answer "who did that, and when". A
 * rejected attempt is part of that answer. `lever` is a fixed string from the
 * call site and never anything the caller sent.
 */
async function hqActor(lever: string): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; error: string }
> {
  if (!(await isCurrentUserAdmin())) {
    const attempted = await getRealCurrentUser();
    console.warn(
      'user-trial-actions: refused a non-admin call on an HQ trial lever',
      JSON.stringify({ lever, userId: attempted?.id ?? null }),
    );
    await logSecurityEvent({
      kind: 'hq_trial_action_denied',
      // `low` is auto-acknowledged by the writer, which would file this
      // straight into the closed pile. A refused attempt on a commercial
      // control is exactly what should stay open for triage.
      severity: 'medium',
      userId: attempted?.id ?? null,
      details: { lever, surface: 'user' },
    });
    return { ok: false, error: 'Admin access is required for this change.' };
  }
  const user = await getRealCurrentUser();
  if (!user) {
    return {
      ok: false,
      error: 'Could not confirm who is signed in. Sign in again and retry.',
    };
  }
  return { ok: true, userId: user.id, email: user.email ?? null };
}

/**
 * Whole days only, inside the bounds. Number.isInteger rejects NaN, Infinity
 * and a fractional day, so nothing downstream has to reason about a partial
 * date.
 */
function readDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_TRIAL_DAYS || value > MAX_TRIAL_DAYS) return null;
  return value;
}

/** Trimmed to null when empty, and capped so one paste cannot fill the table. */
function readNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : null;
}

/**
 * A trial's plan level, or null for no particular level.
 *
 * The vocabulary is ENTITLEMENT_TIER_SLUGS, derived in lib/entitlements.ts
 * from the same price table every paid entitlement is read from. It is not
 * re-listed here, because a second list of what a tier means is a second place
 * to get entitlement wrong.
 *
 * The refusal is a REFUSAL and not a fallback. Silently storing null for an
 * unrecognised level would tell the operator the change landed while the
 * account ran at no level at all.
 */
function readTierSlug(
  value: unknown,
): { ok: true; slug: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, slug: null };
  }
  if (!isEntitlementTierSlug(value)) return { ok: false };
  return { ok: true, slug: value };
}

const DAYS_ERROR = `Enter a whole number of days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`;
const TIER_ERROR = `Choose one of the plan levels this product sells: ${ENTITLEMENT_TIER_SLUGS.join(', ')}.`;

/**
 * Starts a trial on a user who has none. Sets the end date to today plus the
 * given number of days.
 *
 * Refuses when there is already an end date. Without that check a stale page
 * records action='granted' for what was in fact a replacement, and a 200 day
 * trial silently becomes a 14 day one.
 */
export async function grantUserTrialAction(input: {
  userId: string;
  days: number;
  note?: string | null;
}): Promise<UserTrialActionResult> {
  const actor = await hqActor('grant');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const snapshot = await readUserTrialSnapshot(input.userId);
  if (!snapshot.ok) return snapshot;
  if (snapshot.trialEndsAt !== null) {
    return {
      ok: false,
      error:
        'This user is already on a trial clock. Use Extend to add days to the date on file, or Restart to replace it.',
    };
  }

  const result = await applyUserTrialAction({
    userId: input.userId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'granted', days },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/users');
  return result;
}

/**
 * Moves the EXISTING end date forward by the given number of days.
 *
 * Extend and restart are separate actions, and the difference is money. A user
 * whose trial lapsed a week ago gets seven fewer usable days from an extension
 * than from a restart, which is the intent: the operator agreed to add days to
 * a trial, not to begin a new one. Do not fold these two into one action with
 * a flag.
 *
 * There has to BE a date to move, and that is checked here rather than only in
 * the browser. applyUserTrialAction falls back to now when trial_ends_at is
 * null, so without this a hand-written call on an account with no trial starts
 * a fresh one from today and files it as action='extended' with
 * previous_value=null, an extension of nothing.
 */
export async function extendUserTrialAction(input: {
  userId: string;
  days: number;
  note?: string | null;
}): Promise<UserTrialActionResult> {
  const actor = await hqActor('extend');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const snapshot = await readUserTrialSnapshot(input.userId);
  if (!snapshot.ok) return snapshot;
  if (snapshot.trialEndsAt === null) {
    return {
      ok: false,
      error:
        'This user has no trial end date to extend. Use Restart the trial to put them on a clock.',
    };
  }

  const result = await applyUserTrialAction({
    userId: input.userId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'extended', days },
    note: readNote(input.note),
  });
  if (!result.ok) return result;
  revalidatePath('/admin/users');
  // See BLOCKED_NOTICE. The flag is read from the row applyUserTrialAction
  // wrote, so it is the state after this change rather than a second read.
  if (result.blocked) return { ok: true, notice: BLOCKED_NOTICE };
  return { ok: true };
}

/**
 * Restarts the clock: sets the end date to today plus the given number of
 * days, whatever it was before. See extendUserTrialAction for why this is not
 * the same action.
 */
export async function resetUserTrialAction(input: {
  userId: string;
  days: number;
  note?: string | null;
}): Promise<UserTrialActionResult> {
  const actor = await hqActor('restart');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const result = await applyUserTrialAction({
    userId: input.userId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'reset', days },
    note: readNote(input.note),
  });
  if (!result.ok) return result;
  revalidatePath('/admin/users');
  // Restart is the other date lever and lands in exactly the same place, so it
  // owes the same sentence.
  if (result.blocked) return { ok: true, notice: BLOCKED_NOTICE };
  return { ok: true };
}

/**
 * Sets the plan level the trial runs at, or clears it with null.
 *
 * A level with no end date has no window, so the resolver grants nothing for
 * it and an action that quietly stored one would report success for a change
 * with no effect. Clearing is exempt, because clearing a level off an account
 * with no trial is already what the operator asked for.
 */
export async function setUserTrialTierAction(input: {
  userId: string;
  tierSlug: string | null;
  note?: string | null;
}): Promise<UserTrialActionResult> {
  const actor = await hqActor('plan level');
  if (!actor.ok) return actor;

  const tier = readTierSlug(input.tierSlug);
  if (!tier.ok) return { ok: false, error: TIER_ERROR };

  if (tier.slug !== null) {
    const snapshot = await readUserTrialSnapshot(input.userId);
    if (!snapshot.ok) return snapshot;
    if (snapshot.trialEndsAt === null) {
      return {
        ok: false,
        error:
          'This user is not on a trial clock, so a plan level would have no window to apply in. Start or restart the trial first.',
      };
    }
  }

  const result = await applyUserTrialAction({
    userId: input.userId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'tier_changed', tierSlug: tier.slug },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/users');
  return result;
}

/**
 * Takes the account off the trial clock entirely, clearing both the end date
 * and the plan level.
 *
 * This is the undo for a trial granted to the wrong account, and it is the
 * fifth lever rather than a suspension because an individual already has one:
 * the Active toggle, which is setUserBlockedAction. Two lockout flags would be
 * two answers to the same question.
 *
 * Clearing removes NO DATA. It ends the trial's access on the spot, and
 * everything the person has put into the product stays exactly where it is.
 */
export async function clearUserTrialAction(input: {
  userId: string;
  note?: string | null;
}): Promise<UserTrialActionResult> {
  const actor = await hqActor('clear');
  if (!actor.ok) return actor;

  const result = await applyUserTrialAction({
    userId: input.userId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'cleared' },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/users');
  return result;
}
