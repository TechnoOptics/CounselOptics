import type { FirmAccessState } from './firm-access';
import {
  resolveAccountEntitlement,
  type PaidEntitlement,
  type ResolvedEntitlement,
  type TrialGrant,
  type TrialTimestamp,
} from './trial-entitlement';

/**
 * What an ORGANIZATION is entitled to, once its HQ-granted trial is taken into
 * account. Pure: no I/O and no clock of its own, so every rule below is unit
 * tested. lib/firm-trials.ts owns the database and lib/firm-storage.ts owns the
 * composition.
 *
 * This is the firm-side counterpart of the consumer path
 * (userTrialGrant -> resolveAccountEntitlement -> lib/tier.ts), and it exists
 * because `firms.trial_tier` previously had NO runtime consumer at all. HQ could
 * record a plan level against an organization, file an audit row for it, and
 * change nothing anybody experienced. An operator could not run a Growing Firm
 * pilot differently from a Solo one.
 *
 * THE RULE FROM lib/trial-entitlement.ts IS NOT RESTATED HERE. A paid
 * subscription beats a trial because this module DELEGATES to
 * resolveAccountEntitlement rather than deciding it again. There is deliberately
 * no comparison of a paid level against a trial level anywhere in this file: the
 * moment one appeared, this module would be a second answer to a money question
 * that already has one, and the two would drift.
 *
 * WHAT THIS MODULE ADDS, and it is exactly one thing: an organization can be
 * CLOSED, which an individual account cannot be. Suspension and a lapsed trial
 * clock are firm-level states with no consumer equivalent, and they outrank
 * both halves of the entitlement question.
 */

/**
 * A firm has no billing entity of its own, so "the organization's plan" means
 * its creator's personal subscription. That is not a decision this module
 * makes; it is the existing model, stated on firmAiGate in lib/firm-storage.ts
 * and relied on by assertOrganizerEligible in lib/community-actions.ts. It is
 * named here because the `paid` half below is meaningless without it.
 */
export type FirmEntitlementInput = {
  /** From firmAccessState: whether the organization is open at all. */
  access: FirmAccessState;
  /** From the CREATOR'S subscription row, via paidFromSubscription. */
  paid: PaidEntitlement;
  /** From `firms.trial_tier` and `firms.trial_ends_at`, as stored. */
  trial: TrialGrant;
};

const NO_ENTITLEMENT: ResolvedEntitlement = Object.freeze({
  source: 'none' as const,
  tier: null,
  tierSlug: null,
});

/**
 * The whole answer for one organization at one instant.
 *
 * A CLOSED ORGANIZATION IS ENTITLED TO NOTHING, INCLUDING ONE THAT PAYS, and
 * that is worth being explicit about because it is the one place this module
 * overrides a subscription.
 *
 * It is not a violation of the paid-beats-trial rule. That rule governs which
 * of two GRANTS wins, and nothing here grants anything: `export_only` is either
 * an operator suspension, which lib/firm-access.ts documents as the manual
 * override that outranks the dates, or a trial clock that has run out. Letting a
 * payer through a suspension would make the abuse-response lever advisory, and
 * letting a lapsed trial through would mean the clock never actually closed
 * anything.
 *
 * It is also the reason this function takes the access state at all rather than
 * reading `trial.trialEndsAt` twice. Suspension is invisible in a TrialGrant, so
 * a version of this that only looked at the trial dates would hand a suspended
 * organization a live entitlement.
 *
 * The switch is exhaustive on purpose. A third FirmAccessState added later has
 * to be a compile error here rather than a silent fall through to the granting
 * branch, which is what `if (access === 'export_only')` would quietly become.
 */
export function resolveFirmEntitlement(
  input: FirmEntitlementInput,
  now: TrialTimestamp,
): ResolvedEntitlement {
  switch (input.access) {
    case 'export_only':
      return NO_ENTITLEMENT;
    case 'active':
      // Delegated, not re-decided. See the note at the top of this file.
      return resolveAccountEntitlement(input.paid, input.trial, now);
    default: {
      const unhandled: never = input.access;
      throw new Error(
        `firm-entitlement has no rule for the access state ${String(unhandled)}.`,
      );
    }
  }
}

/**
 * Why an organization was refused, as an IDENTITY rather than a sentence.
 *
 * Three reasons and not one, because they are three different conversations
 * with the firm owner and a single "inactive" collapses them. The route that
 * refuses does not compose the copy either; see firmAiRefusalMessage.
 *
 *   'access_ended'  the organization is suspended, or its trial clock ran out
 *   'no_plan'       the organization is open, and nothing grants it a plan
 *   'undetermined'  access could not be established at all
 */
export type FirmAiRefusal = 'access_ended' | 'no_plan' | 'undetermined';

export type FirmAiGate =
  | { ok: true; entitlement: ResolvedEntitlement }
  | { ok: false; reason: FirmAiRefusal };

/**
 * The gate the paid AI routes ask, given an already-resolved entitlement.
 *
 * `source !== 'none'` and not a test for a particular level, which keeps this
 * change behaviour-preserving for every organization that pays. The previous
 * gate was "the creator's subscription is active or trialing", regardless of
 * which price it was on, so an organization on a price this build does not
 * recognise passed. paidFromSubscription reports exactly that state as
 * `{ kind: 'paid', tier: null, tierSlug: null }`, which resolves to
 * `source: 'paid'`, and it still passes. Requiring a known level here would
 * have cut those organizations off as a side effect of a trial feature.
 *
 * A TRIAL WITH NO LEVEL SET IS REFUSED, and that is deliberate rather than an
 * oversight. applyTrialToUnpaid grants nothing for a level that names no plan
 * this product sells, and null is such a level. An organization on a trial clock
 * with no recorded level therefore reaches this function as `source: 'none'` and
 * gets 'no_plan'. The alternative would be to invent a default level here, which
 * would be a plan the price table does not describe and a second answer to what
 * a trial includes. app/admin/firms/trial-controls.tsx says this out loud on the
 * lever, so the operator sets a level rather than discovering the gap through a
 * customer.
 */
export function firmAiGateFor(
  access: FirmAccessState,
  entitlement: ResolvedEntitlement,
): FirmAiGate {
  if (access === 'export_only') return { ok: false, reason: 'access_ended' };
  if (entitlement.source === 'none') return { ok: false, reason: 'no_plan' };
  return { ok: true, entitlement };
}

/**
 * What the person in front of the failure reads.
 *
 * Calm and specific, per the copy rule for this product: somebody hitting this
 * is mid-task on a legal matter, and the previous single message
 * ("This firm's subscription is inactive") was also wrong for two of the three
 * cases. It said billing to an organization that was suspended, and it said
 * billing to an organization whose transient read had failed.
 *
 * Nothing here mentions deletion, matching app/counsel/access-ended/page.tsx.
 * Under this design no data is removed, and an export stays reachable in every
 * one of these states.
 */
export function firmAiRefusalMessage(reason: FirmAiRefusal): string {
  switch (reason) {
    case 'access_ended':
      return 'This organization is in export only, so new drafting and analysis are paused. Everything already here can still be opened and downloaded.';
    case 'no_plan':
      return 'This organization does not have an active plan, so drafting and analysis are paused. A firm owner or admin can start one from billing.';
    case 'undetermined':
      return "We could not confirm this organization's plan just now. Please try again in a moment.";
    default: {
      const unhandled: never = reason;
      throw new Error(
        `firm-entitlement has no message for the refusal ${String(unhandled)}.`,
      );
    }
  }
}

/**
 * The status code that goes with it.
 *
 * 402 for both entitlement refusals, which is what these routes already
 * returned, so no client handling changes. 503 for 'undetermined', because that
 * one is the app's fault and is worth retrying; returning 402 for it would tell
 * a paying firm to go and look at their billing over a transient database read.
 */
export function firmAiRefusalStatus(reason: FirmAiRefusal): number {
  return reason === 'undetermined' ? 503 : 402;
}
