/**
 * An hourly billing rate, as an integer number of cents.
 *
 * This module is pure and has no directive, so the same rules run in the
 * browser input, in the server action that writes the rate, and in the tests.
 * A rate is money, so nothing here ever touches a float: the parser reads the
 * dollar digits and the cent digits as two separate integers and combines them
 * with integer arithmetic.
 *
 * Being precise about why, because the obvious alternative is not as wrong as
 * it first looks. `Number('150.55') * 100` really is 15055.000000000002 and
 * `Number('1.15') * 100` really is 114.99999999999999, so a bare multiply
 * produces a non-integer that the storage check below then refuses - a valid
 * rate rejected. Wrapping it in `Math.round` repairs every one- and two-decimal
 * case at these magnitudes, so that variant is not a live bug and no test here
 * distinguishes it. The integer path is kept anyway because it does not depend
 * on that argument being true: it cannot drift, it needs no reasoning about
 * doubles to review, and it does not quietly become wrong if the accepted
 * format ever grows a third decimal.
 *
 * Every rule below refuses rather than corrects. The two directions are not
 * symmetric: a refused rate costs an owner one retype, while a coerced rate
 * goes onto a client's invoice and nobody finds out until the client reads it.
 */

/**
 * The largest rate that can be stored: $10,000.00 per hour.
 *
 * Well above any real hourly rate, and low enough that the usual typos - a
 * stray extra digit, a pasted figure that was really an account number or an
 * amount in cents - are refused instead of billed. It is a sanity bound, not a
 * commercial policy.
 */
export const MAX_RATE_CENTS = 1_000_000;

export type RateParse =
  | { ok: true; cents: number | null }
  | { ok: false; error: string };

/**
 * Dollars, with an optional decimal part of one or two digits, and an optional
 * leading `$` because people type the symbol they can see. Deliberately narrow:
 * no thousands separators, no exponent, no sign, no third decimal. Each of
 * those would have to be interpreted, and interpreting money is guessing.
 */
const RATE_PATTERN = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/;

const RATE_SHAPE_ERROR =
  'Enter an hourly rate in dollars, like 450 or 450.50.';

/**
 * Is this a value the rate column may hold?
 *
 * `null` means the member has no rate. Anything else must be a whole number of
 * cents, strictly above zero and within the bound above.
 *
 * Zero is refused on purpose. The invoice drafter treats `rate_cents` of 0 and
 * of null identically as "this hour has no price" (lib/invoicing.ts), so a
 * stored 0 would be a rate the product cannot tell apart from having none.
 * Work that is genuinely not being charged for is recorded by marking the time
 * entry non-billable, which keeps the hours on the file without pretending
 * they were priced at nothing.
 *
 * `Number.isSafeInteger` is doing four jobs at once: it refuses NaN, refuses
 * Infinity, refuses a fractional cent, and refuses a magnitude past exact
 * integer arithmetic. This is the check the server action runs on its incoming
 * argument, and the server action is a public HTTP endpoint, so it must not
 * assume the value came from the input below.
 */
export function isStorableRateCents(value: unknown): value is number | null {
  if (value === null) return true;
  if (typeof value !== 'number') return false;
  if (!Number.isSafeInteger(value)) return false;
  return value > 0 && value <= MAX_RATE_CENTS;
}

/** The refusal shown when a rate is out of range, as one sentence. */
export function rateRangeError(): string {
  return `Enter an hourly rate above $0.00 and no more than ${formatRateCents(
    MAX_RATE_CENTS,
  )}, or leave it blank for no rate.`;
}

/**
 * Read what a person typed into an integer number of cents.
 *
 * Blank is the one input that is accepted rather than refused, and it clears
 * the rate. That is the permissive-looking branch but it is still the safe
 * direction: the result is that no rate is stored, so the hours it governs are
 * held back from being priced rather than priced wrongly. There has to be some
 * way to undo a rate, and an empty field is the one people reach for.
 */
export function parseRateInput(raw: string): RateParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, cents: null };

  const match = RATE_PATTERN.exec(trimmed);
  if (!match) return { ok: false, error: RATE_SHAPE_ERROR };

  // Both halves are pure digit runs from the pattern above, so each is an
  // exact integer, and dollars is at most 9,999,999 - the product below stays
  // far inside the safe-integer range.
  const dollars = Number(match[1]);
  const cents = dollars * 100 + Number((match[2] ?? '').padEnd(2, '0'));

  if (!isStorableRateCents(cents)) {
    return { ok: false, error: rateRangeError() };
  }
  return { ok: true, cents };
}

/**
 * Render cents as dollars without dividing. `cents / 100` is close enough for
 * display at these magnitudes, but building the string from the integer parts
 * means there is no float anywhere on the path from the column to the screen.
 */
export function formatRateCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${rest}`;
}

/** What the rate input shows for a stored value. Blank means no rate. */
export function rateCentsToInputValue(cents: number | null): string {
  if (cents === null) return '';
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, '0');
  return `${whole}.${rest}`;
}
