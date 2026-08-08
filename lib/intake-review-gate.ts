/**
 * Whether an intake submission is held back until its attachment has
 * been through Advottic Review.
 *
 * Who is held back
 * ----------------
 * The legal team's own intake form requires it: a contract they are
 * asked to paper should have been read before it is filed, and a grade
 * below C means the review found something worth fixing first.
 *
 * An employee filing through the portal is not held back. The ordinary
 * case there is an employee attaching a counterparty's draft and asking
 * legal to look at it, and a counterparty's draft is exactly the kind of
 * document that grades badly. Blocking on the grade stopped them handing
 * over the very problem they opened the ticket about. The review is
 * still offered, and a grade they choose to run still reaches legal.
 *
 * Why this is a module and not an `if` in the component
 * ----------------------------------------------------
 * It was an `if` in the component, in the submit handler of
 * app/counsel/intake/create-intake-form.tsx. Vitest here runs with
 * `environment: 'node'` and no jsdom, so that client component cannot be
 * rendered in a test and this rule could not be exercised at all.
 * lib/signer-view.ts exists for the same reason. Anything that decides
 * whether a request can be filed belongs where a test can reach it.
 *
 * It also cannot live in lib/intake-uploads.ts, which carries a
 * `'use server'` directive: every export in such a file is a public
 * endpoint, so a synchronous helper there is either a directive
 * violation or a needlessly reachable one.
 */

import type { DocScorecard } from './doc-review';

export type IntakeReviewGateInput = {
  filesAttached: boolean;
  reviewRequired: boolean;
  scorecard: DocScorecard | null;
};

export type IntakeReviewGateDecision = {
  blocked: boolean;
  reason: 'not-run' | 'failing-grade' | null;
  attachReview: boolean;
};

export function resolveIntakeReviewGate(
  input: IntakeReviewGateInput,
): IntakeReviewGateDecision {
  const { filesAttached, reviewRequired, scorecard } = input;

  // Nothing attached, nothing to review. A scorecard can still be
  // sitting in form state here if the user ran the review and then
  // removed the file, and it must not ride along: it describes a
  // document that is no longer part of the request.
  if (!filesAttached) {
    return { blocked: false, reason: null, attachReview: false };
  }

  if (reviewRequired) {
    if (!scorecard) {
      return { blocked: true, reason: 'not-run', attachReview: false };
    }
    if (!scorecard.passes) {
      return { blocked: true, reason: 'failing-grade', attachReview: false };
    }
  }

  // Not blocked. Attach whatever grade exists, including a failing one:
  // a poor grade is information the legal team wants on the ticket, not
  // a reason to strip it back out.
  return { blocked: false, reason: null, attachReview: Boolean(scorecard) };
}
