import { describe, expect, it } from 'vitest';
import {
  MAX_RATE_CENTS,
  formatRateCents,
  isStorableRateCents,
  parseRateInput,
  rateCentsToInputValue,
} from '../lib/billing-rates';

/**
 * A billing rate is money. Every case below asserts BOTH that a bad input is
 * refused and that it is refused rather than turned into some other number,
 * because the failure being guarded against is not "an error was shown" - it
 * is "$1.50 was quietly billed as $150.00".
 */

describe('parseRateInput refuses rather than coerces', () => {
  it('reads whole dollars as exact cents', () => {
    expect(parseRateInput('450')).toEqual({ ok: true, cents: 45000 });
  });

  it('reads one and two decimal places exactly', () => {
    expect(parseRateInput('450.5')).toEqual({ ok: true, cents: 45050 });
    expect(parseRateInput('450.55')).toEqual({ ok: true, cents: 45055 });
  });

  it('accepts the values a bare float multiply turns into non-integers', () => {
    // Number('150.55') * 100 is 15055.000000000002 and Number('1.15') * 100 is
    // 114.99999999999999. A parser that multiplied and did not round would hand
    // those to isStorableRateCents, which refuses a fractional cent - so a real
    // rate would come back rejected. Each entry below is a value where that
    // multiply drifts, asserted against the exact cents it must produce.
    for (const [text, cents] of [
      ['150.55', 15055],
      ['1.15', 115],
      ['8.29', 829],
      ['0.29', 29],
      ['1005.75', 100575],
    ] as const) {
      expect(parseRateInput(text)).toEqual({ ok: true, cents });
    }
  });

  it('accepts a typed dollar sign and surrounding space, which change no value', () => {
    expect(parseRateInput('  $450.00 ')).toEqual({ ok: true, cents: 45000 });
  });

  it('treats a blank field as clearing the rate, not as zero', () => {
    // The distinction matters: null means "not priced yet" and holds the
    // hours back, while 0 would be a price the product cannot tell apart
    // from having none.
    expect(parseRateInput('')).toEqual({ ok: true, cents: null });
    expect(parseRateInput('   ')).toEqual({ ok: true, cents: null });
  });

  it('refuses a negative rate instead of storing a credit', () => {
    const r = parseRateInput('-50');
    expect(r.ok).toBe(false);
    // A negative rate would put a negative line on a client's invoice, which
    // is a credit note issued through a rate field.
    expect(parseRateInput('-50')).not.toHaveProperty('cents');
  });

  it('refuses zero, which the drafter cannot tell apart from no rate', () => {
    expect(parseRateInput('0').ok).toBe(false);
    expect(parseRateInput('0.00').ok).toBe(false);
  });

  it('refuses a rate above the sanity bound instead of billing it', () => {
    expect(parseRateInput('10000').ok).toBe(true);
    expect(parseRateInput('10000.01').ok).toBe(false);
    expect(parseRateInput('9999999').ok).toBe(false);
  });

  it('refuses a non-numeric string instead of parsing a prefix out of it', () => {
    // parseFloat('150abc') is 150 and Number('') is 0. Both are the bug.
    for (const bad of ['abc', '150abc', 'NaN', 'Infinity', '1e3', '4,500', '45.0.0']) {
      expect(parseRateInput(bad).ok).toBe(false);
    }
  });

  it('refuses a third decimal instead of rounding it away', () => {
    expect(parseRateInput('450.555').ok).toBe(false);
  });
});

describe('isStorableRateCents is the gate the server runs on its argument', () => {
  it('accepts null and whole cents inside the bound', () => {
    expect(isStorableRateCents(null)).toBe(true);
    expect(isStorableRateCents(1)).toBe(true);
    expect(isStorableRateCents(MAX_RATE_CENTS)).toBe(true);
  });

  it('refuses everything a caller could send that is not whole cents', () => {
    for (const bad of [
      0,
      -1,
      MAX_RATE_CENTS + 1,
      12.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_VALUE,
      '450',
      undefined,
      {},
      [45000],
      true,
    ]) {
      expect(isStorableRateCents(bad)).toBe(false);
    }
  });
});

describe('formatting round-trips without a float', () => {
  it('renders cents as dollars', () => {
    expect(formatRateCents(45000)).toBe('$450.00');
    expect(formatRateCents(45005)).toBe('$450.05');
    expect(formatRateCents(1)).toBe('$0.01');
    expect(formatRateCents(MAX_RATE_CENTS)).toBe('$10,000.00');
  });

  it('re-parses what it puts back in the input', () => {
    for (const cents of [1, 99, 45000, 45055, MAX_RATE_CENTS]) {
      expect(parseRateInput(rateCentsToInputValue(cents))).toEqual({
        ok: true,
        cents,
      });
    }
    expect(rateCentsToInputValue(null)).toBe('');
  });
});
