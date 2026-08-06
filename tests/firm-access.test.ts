import { describe, it, expect } from 'vitest';
import {
  toInstant,
  firmAccessState,
  seatCheck,
  type FirmAccessInput,
} from '../lib/firm-access';

const T0 = new Date('2026-08-01T12:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function firm(over: Partial<FirmAccessInput> = {}): FirmAccessInput {
  return { trialEndsAt: null, suspendedAt: null, ...over };
}

describe('toInstant', () => {
  it('accepts a Date unchanged', () => {
    expect(toInstant(T0).getTime()).toBe(T0.getTime());
  });

  it('accepts the ISO string shapes PostgREST actually returns', () => {
    for (const s of [
      '2026-08-01T12:00:00+00:00',
      '2026-08-01T12:00:00.123456+00:00',
      '2026-08-01 12:00:00+00',
    ]) {
      expect(Number.isNaN(toInstant(s).getTime())).toBe(false);
    }
  });

  // Every timestamp this repo WRITES goes through toISOString(), which produces
  // the trailing-Z shape, and any value that round-trips through JSON keeps it.
  it('accepts the trailing-Z shape that toISOString and JSON produce', () => {
    for (const s of ['2026-08-01T12:00:00Z', '2026-08-01T12:00:00.000Z']) {
      expect(toInstant(s).getTime()).toBe(T0.getTime());
    }
  });

  it('throws rather than failing open on an unparseable value', () => {
    expect(() => toInstant('garbage')).toThrow();
    expect(() => toInstant('')).toThrow();
  });

  // The guard has to cover the Date branch too. An Invalid Date object compares
  // false against everything, so letting one through reads as "not yet expired".
  it('throws on an Invalid Date object, not only on a bad string', () => {
    expect(() => toInstant(new Date('garbage'))).toThrow();
  });

  // new Date(null) is the epoch, which is a VALID Date, so the NaN guard alone
  // does not catch it. An epoch "now" is before every trial end, so coercing
  // instead of rejecting would report every expired organization as active.
  it('throws on null and undefined rather than coercing them to the epoch', () => {
    expect(() => toInstant(null as unknown as Date)).toThrow();
    expect(() => toInstant(undefined as unknown as Date)).toThrow();
  });

  // The guard has to reject by TYPE, not merely reject nullish values.
  // Narrowing it to `value == null` would let a number coerce again, and
  // new Date(0) is the epoch, which is the same fail-open through a second
  // door. A deliberate Date object at the epoch is still legitimate.
  it('throws on a number or an object rather than coercing them', () => {
    expect(() => toInstant(0 as unknown as Date)).toThrow();
    expect(() => toInstant({} as unknown as Date)).toThrow();
  });

  it('still accepts a Date deliberately constructed at the epoch', () => {
    expect(toInstant(new Date(0)).getTime()).toBe(0);
  });
});

describe('firmAccessState', () => {
  it('is active when the organization is not on a trial', () => {
    expect(firmAccessState(firm(), T0)).toBe('active');
  });

  it('is active while the trial is running', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(5) }), T0)).toBe('active');
  });

  it('is export_only once the trial end has passed', () => {
    expect(firmAccessState(firm({ trialEndsAt: days(-1) }), T0)).toBe('export_only');
  });

  it('is export_only exactly at the trial end', () => {
    expect(firmAccessState(firm({ trialEndsAt: T0 }), T0)).toBe('export_only');
  });

  it('is export_only when suspended, even with a trial still running', () => {
    const f = firm({ trialEndsAt: days(30), suspendedAt: days(-1) });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('is export_only when suspended and not on a trial at all', () => {
    expect(firmAccessState(firm({ suspendedAt: days(-1) }), T0)).toBe('export_only');
  });

  // Suspension is presence, not a date. Both suspension tests above use a PAST
  // suspendedAt, so without this one the check could be refactored into
  // `suspendedAt != null && toInstant(suspendedAt) <= at` and stay green,
  // silently turning the field into an effective-from date that leaves
  // scheduled organizations open until it arrives.
  it('is export_only the moment suspendedAt is set, even dated in the future', () => {
    expect(firmAccessState(firm({ suspendedAt: days(5) }), T0)).toBe('export_only');
  });

  // A MISSING field must not read as "not suspended". This is the same
  // fail-open as an unparseable value: the type system says it cannot happen,
  // and it arrives from a boundary the type system does not police, such as a
  // .select() that omits the column or a row round-tripped through JSON.
  it('rejects a firm missing suspendedAt instead of reporting active', () => {
    const noSuspended = { trialEndsAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(noSuspended, T0)).toThrow();
  });

  it('rejects a firm missing trialEndsAt instead of reporting active', () => {
    const noTrial = { suspendedAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(noTrial, T0)).toThrow();
  });

  // A key that is present but explicitly undefined is just as absent, and a
  // key-presence test would wave it through. A row mapper writing
  // `suspendedAt: row.suspended_at` off a row that lacks the column produces
  // exactly this, and the consequence is a suspended organization reading as
  // active.
  it('rejects a firm whose suspendedAt is present but undefined', () => {
    const f = { trialEndsAt: null, suspendedAt: undefined } as unknown as FirmAccessInput;
    expect(() => firmAccessState(f, T0)).toThrow();
  });

  it('rejects a firm whose trialEndsAt is present but undefined', () => {
    const f = { trialEndsAt: undefined, suspendedAt: null } as unknown as FirmAccessInput;
    expect(() => firmAccessState(f, T0)).toThrow();
  });

  // The other direction: a present null is the normal shape PostgREST returns
  // for a selected null column, and must stay perfectly acceptable.
  it('accepts explicit nulls for both fields, which is what PostgREST returns', () => {
    expect(firmAccessState({ trialEndsAt: null, suspendedAt: null }, T0)).toBe('active');
  });

  it('reads an expired trial supplied as an ISO STRING as export_only', () => {
    const f = firm({ trialEndsAt: '2026-07-31T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('export_only');
  });

  it('reads a running trial supplied as an ISO STRING as active', () => {
    const f = firm({ trialEndsAt: '2026-09-01T12:00:00+00:00' });
    expect(firmAccessState(f, T0)).toBe('active');
  });

  // The clock is injected, and it is a FirmTimestamp too. If `now` were used
  // raw, a string clock against a Date trial end would compare NaN, which is
  // false, which reads as active forever.
  it('normalises the injected clock when it arrives as an ISO STRING', () => {
    const nowText = '2026-08-01T12:00:00+00:00';
    expect(firmAccessState(firm({ trialEndsAt: days(-1) }), nowText)).toBe('export_only');
    expect(firmAccessState(firm({ trialEndsAt: days(5) }), nowText)).toBe('active');
  });

  it('rejects an unparseable clock instead of reporting active', () => {
    expect(() => firmAccessState(firm({ trialEndsAt: days(-1) }), 'garbage')).toThrow();
  });

  // The clock is validated unconditionally, before any early return. Suspended
  // is the one branch that never consults the clock, so it is the branch a
  // refactor would move the validation below. Pinning it keeps that decision
  // enforced rather than merely commented.
  it('rejects an unparseable clock even on the branch that never reads it', () => {
    expect(() => firmAccessState(firm({ suspendedAt: days(-1) }), 'garbage')).toThrow();
  });

  it('rejects an unparseable trial end instead of reporting active', () => {
    expect(() => firmAccessState(firm({ trialEndsAt: 'garbage' }), T0)).toThrow();
  });

  // Safe by construction, since both operands go through toInstant, but the
  // shape a real caller is most likely to produce: every timestamp a string.
  it('handles the clock and the trial end both arriving as ISO STRINGS', () => {
    const nowText = '2026-08-01T12:00:00+00:00';
    expect(firmAccessState(firm({ trialEndsAt: '2026-07-31T12:00:00+00:00' }), nowText)).toBe('export_only');
    expect(firmAccessState(firm({ trialEndsAt: '2026-09-01T12:00:00+00:00' }), nowText)).toBe('active');
  });
});

describe('seatCheck', () => {
  it('allows adding when there is no limit', () => {
    expect(seatCheck({ seatLimit: null, currentMembers: 99 }).ok).toBe(true);
  });

  it('allows adding below the limit', () => {
    expect(seatCheck({ seatLimit: 5, currentMembers: 4 }).ok).toBe(true);
  });

  it('refuses adding at the limit', () => {
    const r = seatCheck({ seatLimit: 5, currentMembers: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });

  it('refuses adding above the limit, and never reports an ejection', () => {
    const r = seatCheck({ seatLimit: 3, currentMembers: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });

  // A zero seat limit is a real limit, not an absent one. Testing the limit for
  // truthiness rather than for null would turn it into "unlimited".
  it('refuses adding when the limit is zero', () => {
    const r = seatCheck({ seatLimit: 0, currentMembers: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('seat_limit_reached');
  });
});
