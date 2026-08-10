import { describe, expect, it } from 'vitest';

import { formatDollars } from '../lib/gift';

/**
 * Money renders with US grouping separators.
 *
 * Cents are the storage unit everywhere in this codebase, and most display
 * helpers already divide once and hand the result to Intl with an explicit
 * en-US. Two did not: they built the string by hand with `.toFixed(2)`, which
 * produces `$1200.00` where a reader expects `$1,200.00`. A gift total is a
 * price someone is about to pay, so the separator is not decoration.
 */
describe('gift pricing', () => {
  it('groups thousands', () => {
    expect(formatDollars(120000)).toBe('$1,200.00');
  });

  it('still renders small amounts with cents', () => {
    expect(formatDollars(2900)).toBe('$29.00');
    expect(formatDollars(1999)).toBe('$19.99');
  });

  it('renders zero', () => {
    expect(formatDollars(0)).toBe('$0.00');
  });
});
