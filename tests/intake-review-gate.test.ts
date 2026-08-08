import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveIntakeReviewGate } from '../lib/intake-review-gate';
import type { DocScorecard } from '../lib/doc-review';

/**
 * Whether an intake submission is held back until its attachment has
 * been through Advottic Review.
 *
 * This lives as a plain function because the decision it makes used to
 * be inline in app/counsel/intake/create-intake-form.tsx, a client
 * component. Vitest runs with environment: 'node' and no jsdom, so that
 * component cannot be rendered in a test and the rule inside it could
 * not be exercised at all.
 */

const passing = { grade: 'B', passes: true } as unknown as DocScorecard;
const failing = { grade: 'D', passes: false } as unknown as DocScorecard;

describe('resolveIntakeReviewGate: the legal team keeps the gate', () => {
  it('blocks when the review has not been run', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: true,
        scorecard: null,
      }),
    ).toEqual({ blocked: true, reason: 'not-run', attachReview: false });
  });

  it('blocks on a grade below the bar', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: true,
        scorecard: failing,
      }),
    ).toEqual({ blocked: true, reason: 'failing-grade', attachReview: false });
  });

  it('lets a passing grade through and attaches it', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: true,
        scorecard: passing,
      }),
    ).toEqual({ blocked: false, reason: null, attachReview: true });
  });
});

describe('resolveIntakeReviewGate: an employee is never held back', () => {
  it('submits with no review run at all', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: false,
        scorecard: null,
      }),
    ).toEqual({ blocked: false, reason: null, attachReview: false });
  });

  // The row this whole change exists for. An employee attaching a
  // counterparty's draft is the ordinary case, and that draft is exactly
  // what grades badly. The ticket goes through, and the bad grade still
  // reaches legal, because a poor grade is information they want rather
  // than a reason to withhold the request.
  it('submits on a failing grade AND still attaches the scorecard', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: false,
        scorecard: failing,
      }),
    ).toEqual({ blocked: false, reason: null, attachReview: true });
  });

  it('attaches a passing grade the same way', () => {
    expect(
      resolveIntakeReviewGate({
        filesAttached: true,
        reviewRequired: false,
        scorecard: passing,
      }),
    ).toEqual({ blocked: false, reason: null, attachReview: true });
  });
});

describe('resolveIntakeReviewGate: nothing attached', () => {
  it.each([true, false])(
    'never blocks and never attaches when reviewRequired is %s',
    (reviewRequired) => {
      expect(
        resolveIntakeReviewGate({
          filesAttached: false,
          reviewRequired,
          scorecard: null,
        }),
      ).toEqual({ blocked: false, reason: null, attachReview: false });
    },
  );

  it('does not attach a stale scorecard when the file is gone', () => {
    // The scorecard is state in the form. If the employee runs the
    // review and then removes the attachment, the grade describes a
    // document that is no longer part of the request, so it must not
    // ride along on the ticket.
    expect(
      resolveIntakeReviewGate({
        filesAttached: false,
        reviewRequired: false,
        scorecard: passing,
      }),
    ).toEqual({ blocked: false, reason: null, attachReview: false });
  });
});

/**
 * The form is a client component and vitest has no DOM, so the one line
 * that decides WHICH side of this rule a filer lands on cannot be
 * exercised by calling anything. Inverting it would hand the gate to
 * employees and hand a free pass to the legal team, and every test above
 * would still be green. These read the source instead, the same way
 * tests/signer-view.test.ts checks its own wiring.
 */
describe('the form is wired to the gate', () => {
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', rel), 'utf8');
  const form = () => read('app/counsel/intake/create-intake-form.tsx');

  it('asks the shared function rather than deciding inline', () => {
    expect(form()).toMatch(/resolveIntakeReviewGate\(\{/);
  });

  it('requires the review for everyone EXCEPT an employee', () => {
    expect(form()).toMatch(/reviewRequired:\s*!employeeMode/);
  });

  it('no longer carries the old inline block', () => {
    const src = form();
    // The two early returns that used to stop the submit handler.
    expect(src).not.toMatch(/if\s*\(!scorecard\)\s*\{[\s\S]{0,120}setError/);
    expect(src).not.toMatch(/if\s*\(!scorecard\.passes\)\s*\{[\s\S]{0,120}setError/);
  });

  it('does not tell an employee the review is required', () => {
    // The sentence is now branched on employeeMode. The "must pass"
    // wording may only appear on the branch that is still true.
    const src = form();
    expect(src).toMatch(/employeeMode \?/);
    expect(src).toMatch(/It is\s*\n?\s*optional/);
  });
});
