import { describe, expect, it } from 'vitest';
import { levelAppliesFrom } from '../lib/trial-entitlement';
import { FREE_TRIAL_DAYS, freeTrialWindowEnd } from '../lib/storage';

/**
 * The seam between the two trials in this product, and the copy that has to
 * tell an operator about it.
 *
 * The HQ trial carries a plan level. The AUTOMATIC signup trial is checked
 * first at every consumer gate and unlocks every feature for its window
 * regardless of any level. So an HQ level set on somebody in their first week
 * is recorded and not applied, and the HQ row says so with a date on it.
 *
 * Both halves are pinned here: the window arithmetic, which used to live
 * inline inside getEffectiveTrialState and is now shared so there is one
 * definition, and the decision the surface reads off it.
 */

const DAY_MS = 86_400_000;
const SIGNUP = '2026-08-01T00:00:00.000Z';
const EXPECTED_END = new Date(Date.parse(SIGNUP) + FREE_TRIAL_DAYS * DAY_MS).toISOString();

describe('the signup window has one definition', () => {
  it('counts the window from the anchor', () => {
    expect(freeTrialWindowEnd(SIGNUP, null)).toBe(EXPECTED_END);
    expect(freeTrialWindowEnd(null, SIGNUP)).toBe(EXPECTED_END);
  });

  it('takes the EARLIER of the two anchors', () => {
    // This is what defeats the delete-and-resign-up reset: a new email on a
    // device already seen must not buy a fresh week.
    const later = '2026-08-05T00:00:00.000Z';
    expect(freeTrialWindowEnd(later, SIGNUP)).toBe(EXPECTED_END);
    expect(freeTrialWindowEnd(SIGNUP, later)).toBe(EXPECTED_END);
  });

  it('has no window without an anchor', () => {
    expect(freeTrialWindowEnd(null, null)).toBeNull();
    expect(freeTrialWindowEnd(undefined, undefined)).toBeNull();
    expect(freeTrialWindowEnd('', '')).toBeNull();
  });

  it('returns null for an unparseable anchor rather than throwing', () => {
    // The inline version this replaced fed NaN to toISOString, which throws a
    // RangeError. Null resolves to no free trial, which is the same net access
    // answer once the caller's catch had run, and it does not take a page down.
    expect(freeTrialWindowEnd('garbage', null)).toBeNull();
    expect(freeTrialWindowEnd('garbage', 'nonsense')).toBeNull();
  });
});

describe('when an HQ plan level starts applying', () => {
  const NOW = new Date('2026-08-03T00:00:00.000Z');
  const OPEN = '2026-08-08T00:00:00.000Z';
  const CLOSED = '2026-08-01T00:00:00.000Z';

  it('names the date, for somebody still inside their signup week', () => {
    // MUTATION: delete the `at >= endsAt` comparison in levelAppliesFrom, or
    // have it return null unconditionally. This assertion goes red, and with
    // it the row's "Signup week" copy stops appearing for the one person it
    // is true of.
    expect(
      levelAppliesFrom({ source: 'trial', freeTrialEndsAt: OPEN }, NOW),
    ).toBe(new Date(OPEN).toISOString());
  });

  it('says nothing once the signup week has closed', () => {
    expect(levelAppliesFrom({ source: 'trial', freeTrialEndsAt: CLOSED }, NOW)).toBeNull();
    expect(
      levelAppliesFrom({ source: 'trial', freeTrialEndsAt: NOW.toISOString() }, NOW),
    ).toBeNull();
  });

  it('says nothing for somebody with no signup window at all', () => {
    expect(levelAppliesFrom({ source: 'none', freeTrialEndsAt: null }, NOW)).toBeNull();
  });

  it('says nothing for a payer, whose subscription already answers', () => {
    // MUTATION: drop the `source === 'paid'` branch. This goes red. A payer
    // would otherwise be given two competing explanations for one fact, one
    // of which points at the wrong reason.
    expect(levelAppliesFrom({ source: 'paid', freeTrialEndsAt: OPEN }, NOW)).toBeNull();
  });

  it('reads an unreadable window as applying already', () => {
    for (const bad of ['garbage', 0, {}, true]) {
      expect(
        levelAppliesFrom({ source: 'trial', freeTrialEndsAt: bad as never }, NOW),
      ).toBeNull();
    }
  });

  it('takes a Date and an ISO string the same way', () => {
    expect(levelAppliesFrom({ source: 'trial', freeTrialEndsAt: new Date(OPEN) }, NOW)).toBe(
      levelAppliesFrom({ source: 'trial', freeTrialEndsAt: OPEN }, NOW),
    );
  });

  it('refuses a clock it cannot read', () => {
    expect(() =>
      levelAppliesFrom({ source: 'trial', freeTrialEndsAt: OPEN }, 'garbage'),
    ).toThrow();
  });
});
