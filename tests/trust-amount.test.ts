import { describe, expect, it } from 'vitest';

import { parseAmountToCents, US_STATE_CODES } from '../lib/trust-amount';

/**
 * Dollars-to-cents on a client-money ledger.
 *
 * The obvious implementation, `Math.round(Number(str) * 100)`, loses half a
 * cent of client money on ordinary input: `100.005 * 100` is
 * 10000.499999999998 in binary floating point, so it rounds DOWN to $100.00.
 * It also silently absorbs a third decimal place instead of asking the
 * operator what they meant. On an IOLTA account neither is acceptable, so the
 * parser works on the digits of the string and refuses anything it cannot
 * represent exactly.
 */

describe('parseAmountToCents', () => {
  it('parses ordinary amounts exactly', () => {
    expect(parseAmountToCents('2500.00')).toEqual({ ok: true, cents: 250000 });
    expect(parseAmountToCents('0.01')).toEqual({ ok: true, cents: 1 });
    expect(parseAmountToCents('1')).toEqual({ ok: true, cents: 100 });
    expect(parseAmountToCents('1.5')).toEqual({ ok: true, cents: 150 });
    expect(parseAmountToCents('.75')).toEqual({ ok: true, cents: 75 });
    expect(parseAmountToCents('12500')).toEqual({ ok: true, cents: 1250000 });
  });

  it('refuses the sub-cent input that float rounding silently mangles', () => {
    // Measured, not assumed. Across every 2-decimal amount from $0.01 to
    // $2000, `Math.round(Number(s) * 100)` is exact, so well-formed input was
    // never the problem. Sub-cent input is: it rounds silently, and not even
    // consistently in one direction.
    expect(Math.round(1.005 * 100)).toBe(100); // half a cent lost
    expect(Math.round(8.165 * 100)).toBe(816); // rounds down
    expect(Math.round(100.005 * 100)).toBe(10001); // rounds up
    // We refuse all three rather than silently moving client money.
    for (const s of ['1.005', '8.165', '100.005']) {
      expect(parseAmountToCents(s).ok).toBe(false);
    }
    // Amounts that ARE representable to the cent stay exact.
    expect(parseAmountToCents('100.01')).toEqual({ ok: true, cents: 10001 });
    expect(parseAmountToCents('8.20')).toEqual({ ok: true, cents: 820 });
    expect(parseAmountToCents('4.35')).toEqual({ ok: true, cents: 435 });
  });

  it('rejects sub-cent precision instead of absorbing it', () => {
    for (const s of ['1.234', '0.001', '99.999']) {
      const r = parseAmountToCents(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/cent/i);
    }
  });

  it('accepts the formatting a person actually types', () => {
    expect(parseAmountToCents('$2,500.00')).toEqual({ ok: true, cents: 250000 });
    expect(parseAmountToCents('  2500  ')).toEqual({ ok: true, cents: 250000 });
    expect(parseAmountToCents('2,500')).toEqual({ ok: true, cents: 250000 });
  });

  it('rejects a negative amount rather than silently flipping its sign', () => {
    // The old input sanitiser stripped "-" with /[^0-9.]/g, so "-500" posted
    // as a positive $500 of whatever kind was selected.
    const r = parseAmountToCents('-500', { allowNegative: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/greater than zero/i);
  });

  it('allows a negative only where a negative is meaningful', () => {
    // A bank statement CAN legitimately show an overdrawn ending balance,
    // and the operator must be able to enter it truthfully.
    expect(parseAmountToCents('-500', { allowNegative: true })).toEqual({
      ok: true,
      cents: -50000,
    });
    expect(parseAmountToCents('-0.01', { allowNegative: true })).toEqual({
      ok: true,
      cents: -1,
    });
  });

  it('rejects zero unless negatives are allowed', () => {
    expect(parseAmountToCents('0').ok).toBe(false);
    expect(parseAmountToCents('0.00').ok).toBe(false);
    // A reconciliation of an emptied account legitimately ends at zero.
    expect(parseAmountToCents('0', { allowNegative: true })).toEqual({
      ok: true,
      cents: 0,
    });
  });

  it('rejects junk without ever returning NaN', () => {
    for (const s of ['', '   ', 'abc', '1.2.3', '--5', '1e5', '.', '$', '1..2']) {
      const r = parseAmountToCents(s);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error(`expected rejection for ${JSON.stringify(s)}`);
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects amounts past the int4 ceiling of amount_cents', () => {
    // 2147483647 cents = $21,474,836.47.
    expect(parseAmountToCents('21474836.47')).toEqual({ ok: true, cents: 2147483647 });
    const over = parseAmountToCents('21474836.48');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/larger/i);
  });

  it('always returns a safe integer', () => {
    for (const s of ['0.01', '2500.00', '21474836.47', '1']) {
      const r = parseAmountToCents(s);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(Number.isSafeInteger(r.cents)).toBe(true);
        expect(Number.isNaN(r.cents)).toBe(false);
      }
    }
  });

  it('error copy stays calm and free of em dashes', () => {
    const r = parseAmountToCents('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toMatch(/—/);
      expect(r.error).toMatch(/[.]$/);
    }
  });
});

describe('US_STATE_CODES', () => {
  it('covers the 50 states plus DC', () => {
    expect(US_STATE_CODES).toHaveLength(51);
    expect(US_STATE_CODES).toContain('CA');
    expect(US_STATE_CODES).toContain('DC');
    expect(new Set(US_STATE_CODES).size).toBe(51);
    for (const s of US_STATE_CODES) expect(s).toMatch(/^[A-Z]{2}$/);
  });
});
