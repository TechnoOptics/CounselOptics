/**
 * Exact dollars-to-cents parsing for the trust ledger.
 *
 * Deliberately NOT `server-only`: the counsel trust forms are client
 * components and must validate before they call the server action, so the
 * operator sees the problem next to the field rather than after a round trip.
 *
 * Why not `Math.round(Number(str) * 100)`, which is what this replaces:
 *
 *   Math.round(100.005 * 100) === 10000   // $100.00, not $100.01
 *
 * because `100.005 * 100` is 10000.499999999998 in binary floating point.
 * That silently loses half a cent of a client's money. The same expression
 * also absorbs any third decimal place without telling anyone. On an IOLTA
 * account, where a firm must be able to account for every cent it holds, both
 * behaviours are wrong. This parser works on the digits of the string, so the
 * result is exact, and refuses anything it cannot represent rather than
 * guessing.
 */

/** `firm_trust_transactions.amount_cents` is Postgres `integer` (int4). */
export const MAX_AMOUNT_CENTS = 2147483647;

export const US_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
] as const;

export type ParsedAmount =
  | { ok: true; cents: number }
  | { ok: false; error: string };

/**
 * Parse a typed dollar amount into exact cents.
 *
 * Accepts what a person actually types: currency symbols, thousands commas,
 * surrounding whitespace, a leading `.`, and one or two decimal places.
 * Rejects sub-cent precision, scientific notation, and anything past the
 * column's int4 ceiling.
 *
 * @param allowNegative permit a negative (and zero) result. True only for a
 *   bank statement ending balance, which can legitimately be overdrawn or
 *   empty. Ledger entries carry their sign in `kind`, so their magnitude must
 *   be strictly positive.
 */
export function parseAmountToCents(
  raw: string,
  opts?: { allowNegative?: boolean },
): ParsedAmount {
  const allowNegative = opts?.allowNegative ?? false;
  // Strip only presentational characters. Anything else left over is a typo
  // we must report rather than quietly discard.
  const cleaned = String(raw ?? '').trim().replace(/[$\s,]/g, '');
  if (cleaned === '') {
    return { ok: false, error: 'Enter an amount.' };
  }

  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  // Guards against '1.2.3', '1e5', '--5', 'abc', '.', and '1..2'.
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    return { ok: false, error: 'Enter an amount as digits, for example 2500.00.' };
  }

  const negative = m[1] === '-';
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';

  if (frac.length > 2) {
    return {
      ok: false,
      error: 'Enter the amount to the cent, for example 2500.00.',
    };
  }
  if (negative && !allowNegative) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  // Exact: build cents from the digit strings, never from a float multiply.
  const wholeCents = whole === '' ? 0 : Number(whole) * 100;
  const fracCents = frac === '' ? 0 : Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(wholeCents) || !Number.isSafeInteger(fracCents)) {
    return {
      ok: false,
      error: 'That amount is larger than a single entry can hold.',
    };
  }

  const magnitude = wholeCents + fracCents;
  if (magnitude > MAX_AMOUNT_CENTS) {
    return {
      ok: false,
      error: 'That amount is larger than a single entry can hold.',
    };
  }
  if (magnitude === 0 && !allowNegative) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  return { ok: true, cents: negative ? -magnitude : magnitude };
}
