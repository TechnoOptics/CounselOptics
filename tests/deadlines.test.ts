import { describe, it, expect } from 'vitest';
import { suggestSOL } from '../lib/deadlines-data';

describe('suggestSOL (statute-of-limitations deadline calculator)', () => {
  it('returns a deadline after the accrual date for a valid claim', () => {
    const r = suggestSOL('2020-06-15T00:00:00.000Z', 'CA', 'collection');
    expect(r).not.toBeNull();
    expect(r!.state).toBe('CA');
    expect(r!.claimType).toBe('collection');
    expect(new Date(r!.dueAt).getTime()).toBeGreaterThan(
      new Date('2020-06-15T00:00:00.000Z').getTime(),
    );
  });

  it('adds whole years from accrual', () => {
    const r = suggestSOL('2020-01-01T00:00:00.000Z', 'CA', 'collection');
    expect(r).not.toBeNull();
    // For an integer SOL the due year is accrual year + the SOL years.
    if (Number.isInteger(r!.yearsFromAccrual)) {
      expect(new Date(r!.dueAt).getUTCFullYear()).toBe(
        2020 + r!.yearsFromAccrual,
      );
    }
  });

  it('normalizes the state code (strips US- prefix, upper-cases)', () => {
    const r = suggestSOL('2021-03-10T00:00:00.000Z', 'us-tx', 'collection');
    expect(r).not.toBeNull();
    expect(r!.state).toBe('TX');
  });

  it('falls back to the default table for an unknown state', () => {
    const r = suggestSOL('2021-03-10T00:00:00.000Z', 'ZZ', 'collection');
    expect(r).not.toBeNull();
  });

  it('returns null for an invalid accrual date', () => {
    expect(suggestSOL('not-a-date', 'CA', 'collection')).toBeNull();
  });
});
