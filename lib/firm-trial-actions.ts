'use server';

import { revalidatePath } from 'next/cache';
import { getRealCurrentUser, isCurrentUserAdmin } from './supabase/server';
import { logSecurityEvent } from './security-audit';
import { applyTrialAction, readTrialSnapshot } from './firm-trials';
import { ENTITLEMENT_TIER_SLUGS, isEntitlementTierSlug } from './entitlements';

/**
 * The five HQ trial levers, and the only place the browser can reach
 * lib/firm-trials.ts.
 *
 * THE RULE THIS FILE EXISTS TO HOLD: every export below is a public HTTP
 * endpoint. Next compiles each one into a POST route with a stable id, and any
 * signed-in visitor can call it directly with a hand-written request. They do
 * not have to load /admin, so the gate at app/admin/layout.tsx:90-91 protects
 * the PAGE and protects nothing here. This codebase has shipped the
 * "gate in the UI, action still callable" defect twice before, on the intake
 * form path and on document release, and both needed a fix round.
 *
 * So every action's first statement resolves the caller itself through
 * hqActor(), which runs the same isCurrentUserAdmin() check the layout runs.
 * Nothing below reads an identity, a role, or an admin claim out of its
 * arguments, because an argument is whatever the caller typed.
 *
 * THE SECOND RULE: days, never dates. Every trial length here is a COUNT of
 * days. An <input type="date"> yields '2026-08-01' and an
 * <input type="datetime-local"> yields '2026-08-01T12:00'; the timestamp
 * parser accepts both and misreads both, the first as UTC midnight and the
 * second as the server's local time. A count has no zone to lose. If a date
 * picker is ever added for the operator's convenience, it converts to a count
 * in the browser and sends the number.
 *
 * THE THIRD RULE: an action named after a precondition checks it HERE. Grant
 * starts a clock on an organization that has none, and extend moves a date
 * that already exists. Both of those are claims about stored state, and a
 * control the browser declines to render is not a check, for the same reason
 * the layout's admin gate is not one. Both read the row before calling
 * through, and both refuse rather than quietly doing the other action's job.
 */

/**
 * `notice` is a change that LANDED and will not do what the operator expects.
 *
 * It is not an error and it is not a warning about what might happen. It is the
 * second half of a true success: the date moved, and the firm will see nothing,
 * because a suspension outranks every date. An HQ admin extending a trial is
 * usually mid-conversation with a customer, so this exists to stop them saying
 * "you're back on" when nobody is.
 *
 * Optional rather than always present, so an ordinary extension carries no
 * sentence at all and the presence of one means something.
 */
export type TrialActionResult =
  | { ok: true; notice?: string }
  | { ok: false; error: string };

/**
 * WHY THIS COMPLETES AND REPORTS RATHER THAN REFUSING.
 *
 * Refusing was the other candidate, and it is worse in both directions. The end
 * date is the commercial record of what was agreed on the call, so declining to
 * store it loses the agreement rather than protecting anything. And it would
 * make "restore access first" the only route to extending a suspended
 * organization, which pressures an operator into reopening an account somebody
 * closed on purpose: the precedence in lib/firm-access.ts inverted through the
 * workflow instead of through the code.
 *
 * What was actually wrong was never the ordering. It was the silence.
 *
 * The remedy is named because a sentence that says only "this did nothing"
 * sends the operator hunting. The lever is Access, in the same panel.
 */
const SUSPENDED_NOTICE =
  'The end date was saved, but this organization is suspended, so it stays closed and nobody there will see a change. Restore access to reopen it.';

/**
 * Grant, extend and restart all take a length in days. The ceiling is a
 * typo guard rather than a policy: it is what stops a stray keystroke turning
 * a 14 day pilot into a 14000 day one, which no later screen would flag
 * because a far-future end date looks exactly like a paying organization.
 *
 * These bounds are not exported. A 'use server' module may only export async
 * functions, and the numbers are repeated in the controls purely to set the
 * input's min and max. The copy of the check that decides anything is this
 * one, because the browser's is a hint and a direct caller never sees it.
 */
const MIN_TRIAL_DAYS = 1;
const MAX_TRIAL_DAYS = 365;
/**
 * One seat, not zero. The database is the authority here:
 * supabase/migrations/20260801_firm_trials.sql carries
 * `check (seat_limit is null or seat_limit > 0)`, because a zero limit locks
 * an organization out of adding anybody at all, including its owner.
 *
 * Accepting zero above that constraint does not make zero work. It makes
 * Postgres raise 23514, which applyTrialAction reports as "Unavailable.
 * Please try again.", so the operator retries a permanent failure against a
 * message that says it is transient. If zero should ever mean "frozen", that
 * is a migration and a seatCheck change, not a looser bound here.
 */
const MIN_SEAT_LIMIT = 1;
const MAX_SEAT_LIMIT = 10_000;
const MAX_NOTE_LENGTH = 500;

/**
 * Resolves the acting admin, or refuses.
 *
 * The admin check runs first and is the same one the HQ layout runs, so an
 * account that could not open the page cannot call the action either.
 *
 * The actor is then read from the REAL session rather than the effective one.
 * HQ has an "act as" overlay, and under it getCurrentUser resolves the account
 * being viewed. An audit row naming the account someone was looking at instead
 * of the person at the keyboard is worse than no row, so this asks for the
 * operator.
 *
 * Both halves of the identity are returned because the audit table records
 * both: the uuid resolves only while that user row exists, and the email is
 * the half that survives the admin being deleted. A missing actor is a refusal
 * rather than a null, since a change with nobody's name on it is the exact
 * outcome the actor columns exist to prevent.
 *
 * A REFUSAL LEAVES A TRACE. These are public POST endpoints on commercial
 * levers, and this surface exists to answer "who did that, and when". A
 * rejected attempt is part of that answer, so it is recorded rather than
 * dropped. `lever` names which one was tried; it is a fixed string from the
 * call site and never anything the caller sent.
 */
async function hqActor(lever: string): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; error: string }
> {
  if (!(await isCurrentUserAdmin())) {
    // Read only to name who tried. This runs after the decision to refuse, it
    // cannot change that decision, and the refusal below is returned whatever
    // comes back. The console line is the trace that works today; the
    // security_events row is the durable one.
    const attempted = await getRealCurrentUser();
    console.warn(
      'firm-trial-actions: refused a non-admin call on an HQ trial lever',
      JSON.stringify({ lever, userId: attempted?.id ?? null }),
    );
    await logSecurityEvent({
      kind: 'hq_trial_action_denied',
      // `low` is auto-acknowledged by the writer, which would file this
      // straight into the closed pile. A refused attempt on a commercial
      // control is exactly what should stay open for triage.
      severity: 'medium',
      userId: attempted?.id ?? null,
      details: { lever },
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
 * date. lib/firm-trials.ts guards the arithmetic again; this guard exists so
 * the operator gets a sentence they can act on rather than a generic refusal.
 */
function readDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < MIN_TRIAL_DAYS || value > MAX_TRIAL_DAYS) return null;
  return value;
}

/**
 * A note is optional and free text. It is trimmed to null when empty so the
 * audit column holds either a sentence or nothing, never a row of spaces, and
 * capped so one paste cannot fill the table.
 */
function readNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed ? trimmed.slice(0, MAX_NOTE_LENGTH) : null;
}

const DAYS_ERROR = `Enter a whole number of days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`;

/**
 * A trial's plan level, or null to run it at no particular level.
 *
 * The vocabulary is ENTITLEMENT_TIER_SLUGS, derived in lib/entitlements.ts
 * from the same price table every paid entitlement is read from. It is not
 * re-listed here, because a second list of what a tier means is a second
 * place to get entitlement wrong.
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

const TIER_ERROR = `Choose one of the plan levels this product sells: ${ENTITLEMENT_TIER_SLUGS.join(', ')}.`;

/**
 * Starts a trial on an organization that has none. Sets the end date to today
 * plus the given number of days.
 *
 * Refuses when there is already an end date. Without that check a stale page
 * records action='granted' for what was in fact a replacement, and a 200 day
 * trial silently becomes a 14 day one.
 */
export async function grantTrialAction(input: {
  firmId: string;
  days: number;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('grant');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const snapshot = await readTrialSnapshot(input.firmId);
  if (!snapshot.ok) return snapshot;
  if (snapshot.trialEndsAt !== null) {
    return {
      ok: false,
      error:
        'This organization is already on a trial clock. Use Extend to add days to the date on file, or Restart to replace it.',
    };
  }

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'granted', days },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/firms');
  return result;
}

/**
 * Moves the EXISTING end date forward by the given number of days.
 *
 * Extend and restart are separate actions, and the difference is money. An
 * organization whose trial lapsed a week ago gets seven fewer usable days from
 * an extension than from a restart, which is the intent: the operator agreed
 * to add days to a trial, not to begin a new one. Do not fold these two into
 * one action with a flag.
 *
 * There has to BE a date to move, and that is checked here rather than only in
 * the browser. applyTrialAction falls back to now when trial_ends_at is null,
 * so without this a hand-written call on an organization with no trial starts
 * a fresh one from today and files it as action='extended' with
 * previous_value=null, an extension of nothing.
 */
export async function extendTrialAction(input: {
  firmId: string;
  days: number;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('extend');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const snapshot = await readTrialSnapshot(input.firmId);
  if (!snapshot.ok) return snapshot;
  if (snapshot.trialEndsAt === null) {
    return {
      ok: false,
      error:
        'This organization has no trial end date to extend. Use Restart the trial to put it on a clock.',
    };
  }

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'extended', days },
    note: readNote(input.note),
  });
  if (!result.ok) return result;
  revalidatePath('/admin/firms');
  // See SUSPENDED_NOTICE. The flag is read from the row applyTrialAction wrote,
  // so it is the state after this change rather than a second read of it.
  if (result.suspended) return { ok: true, notice: SUSPENDED_NOTICE };
  return { ok: true };
}

/**
 * Restarts the clock: sets the end date to today plus the given number of
 * days, whatever it was before. See extendTrialAction for why this is not the
 * same action.
 *
 * Like extend, it leaves a suspension alone. A suspended organization stays
 * closed until it is explicitly restored, so a fresh end date here does not
 * reopen anything on its own.
 */
export async function resetTrialAction(input: {
  firmId: string;
  days: number;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('restart');
  if (!actor.ok) return actor;

  const days = readDays(input.days);
  if (days === null) return { ok: false, error: DAYS_ERROR };

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'reset', days },
    note: readNote(input.note),
  });
  if (!result.ok) return result;
  revalidatePath('/admin/firms');
  // Restart is the other date lever and lands in exactly the same place, so it
  // owes the same sentence. The block's static copy already says a restart does
  // not reopen a suspended organization; this is the same fact told at the
  // moment it happens, against the state the write actually saw.
  if (result.suspended) return { ok: true, notice: SUSPENDED_NOTICE };
  return { ok: true };
}

/**
 * Sets the seat limit, or clears it with null for no limit.
 *
 * "No limit" is null and only null, which is why every check here is against
 * null rather than a truthiness test. lib/firm-access.ts reads it the same
 * way. The floor is one seat, matching the CHECK constraint on the column;
 * see MIN_SEAT_LIMIT for why zero is refused here rather than sent on to
 * Postgres.
 */
export async function setSeatLimitAction(input: {
  firmId: string;
  seatLimit: number | null;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('seat limit');
  if (!actor.ok) return actor;

  const seatLimit = input.seatLimit;
  if (seatLimit !== null) {
    if (
      typeof seatLimit !== 'number' ||
      !Number.isInteger(seatLimit) ||
      seatLimit < MIN_SEAT_LIMIT ||
      seatLimit > MAX_SEAT_LIMIT
    ) {
      return {
        ok: false,
        error: `Enter a whole number of seats between ${MIN_SEAT_LIMIT} and ${MAX_SEAT_LIMIT}, or remove the limit.`,
      };
    }
  }

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'seats_changed', seatLimit },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/firms');
  return result;
}

/**
 * Sets the plan level the trial runs at, or clears it with null.
 *
 * This is the lever that decides what a trial organization can actually DO.
 * Before it, a trial was a date and nothing else, so an organization on trial
 * got whatever tier it would have had anyway and a Growing Firm pilot could
 * not be run differently from a Solo one.
 *
 * IT CANNOT TOUCH A PAYING CUSTOMER'S ENTITLEMENT. That is not enforced here,
 * and deliberately not: lib/trial-entitlement.ts resolves a paid subscription
 * ahead of any trial, structurally, so a level set on an organization that
 * pays is inert until the payment stops. Putting a second copy of that rule in
 * this action would be a second place for it to be wrong.
 *
 * There has to BE a trial to set a level on, checked here for the same reason
 * extend checks it. A level with no end date has no window, so the resolver
 * grants nothing for it, and an action that quietly stored one would report
 * success for a change with no effect. Clearing is exempt, because clearing a
 * level off an organization with no trial is already what the operator asked
 * for.
 */
export async function setTrialTierAction(input: {
  firmId: string;
  tierSlug: string | null;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('plan level');
  if (!actor.ok) return actor;

  const tier = readTierSlug(input.tierSlug);
  if (!tier.ok) return { ok: false, error: TIER_ERROR };

  if (tier.slug !== null) {
    const snapshot = await readTrialSnapshot(input.firmId);
    if (!snapshot.ok) return snapshot;
    if (snapshot.trialEndsAt === null) {
      return {
        ok: false,
        error:
          'This organization is not on a trial clock, so a plan level would have no window to apply in. Use Restart the trial first.',
      };
    }
  }

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: { kind: 'tier_changed', tierSlug: tier.slug },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/firms');
  return result;
}

/**
 * Closes an organization, or reopens it.
 *
 * Suspension outranks every date. It is the manual override, so restoring is
 * the only thing that reverses it and a date change cannot reopen an
 * organization that was closed deliberately.
 *
 * A suspended organization keeps everything it has put into the product and
 * can still export it. Nothing on this path removes an organization's data.
 */
export async function setSuspendedAction(input: {
  firmId: string;
  suspended: boolean;
  note?: string | null;
}): Promise<TrialActionResult> {
  const actor = await hqActor('access');
  if (!actor.ok) return actor;

  const result = await applyTrialAction({
    firmId: input.firmId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: input.suspended ? { kind: 'suspended' } : { kind: 'restored' },
    note: readNote(input.note),
  });
  if (result.ok) revalidatePath('/admin/firms');
  return result;
}
