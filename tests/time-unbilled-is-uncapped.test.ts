import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TIME_PAGE = 'app/counsel/time/page.tsx';
const BILLING_PAGE = 'app/counsel/billing/page.tsx';

/** The file with line comments and block comments removed. */
function code(rel: string): string {
  const raw = readFileSync(join(ROOT, rel), 'utf8');
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // A guard satisfied by the prose explaining it is not a guard. This repo
  // found three such false passes in one day, so the stripping is asserted
  // rather than assumed.
  expect(stripped.length, `${rel} produced no code after stripping comments`).toBeGreaterThan(500);
  expect(stripped).not.toContain('UNDER-REPORTED');
  return stripped;
}

/**
 * The firm's unbilled time is money it is owed, and it must not be computed
 * over a page of rows.
 *
 * /counsel/time read the 200 most recent entries and derived Unbilled from
 * that list. An entry stays unbilled for as long as nobody invoices it, so
 * the moment a firm passed its 200th entry the figure began under-reporting
 * its own unbilled work, silently, in the direction that costs it money. The
 * same firm could read two different totals on two screens, because
 * /counsel/billing had already been fixed to read every row.
 *
 * These assertions pin the SHAPE that makes the number honest: the predicate
 * is applied in the query, and the figure is summed over that query's own
 * result rather than over the capped display list.
 */
describe('unbilled time is summed over every entry, not over a page of them', () => {
  it('applies the unbilled predicate in the query rather than in JavaScript', () => {
    const src = code(TIME_PAGE);
    // billable + not invoiced + ended + non-zero, as filters on a read.
    expect(src).toMatch(/\.eq\(\s*['"]billable['"]\s*,\s*true\s*\)/);
    expect(src).toMatch(/\.is\(\s*['"]invoice_id['"]\s*,\s*null\s*\)/);
    expect(src).toMatch(/\.not\(\s*['"]ended_at['"]\s*,\s*['"]is['"]\s*,\s*null\s*\)/);
    expect(src).toMatch(/\.gt\(\s*['"]duration_seconds['"]\s*,\s*0\s*\)/);
  });

  it('does not derive the unbilled figure from the capped entries list', () => {
    const src = code(TIME_PAGE);
    // The defect exactly as it was: a filter over `entries` testing the
    // unbilled predicate. Written as one expression so that reinstating any
    // part of it fails, rather than matching a loose keyword.
    expect(src).not.toMatch(/const\s+unbilled\s*=\s*entries\s*\.filter/);
    expect(src).toMatch(/const\s+unbilled\s*=\s*\(\s*unbilledRaw/);
  });

  it('keeps the capped read for the table it actually renders', () => {
    const src = code(TIME_PAGE);
    // The 200-row cap is CORRECT for the list. Removing it would trade one
    // defect for a slower page and an unbounded render, so this asserts the
    // cap survives rather than that it is gone.
    expect(src).toMatch(/\.limit\(\s*200\s*\)/);
  });

  it('uses the same predicate the billing page already uses', () => {
    // One number, two screens. If these ever diverge a firm reads two
    // different figures for the same money, which is the defect this fix
    // exists to end rather than to relocate.
    const time = code(TIME_PAGE);
    const billing = code(BILLING_PAGE);
    for (const clause of [
      /\.eq\(\s*['"]billable['"]\s*,\s*true\s*\)/,
      /\.is\(\s*['"]invoice_id['"]\s*,\s*null\s*\)/,
      /\.not\(\s*['"]ended_at['"]\s*,\s*['"]is['"]\s*,\s*null\s*\)/,
      /\.gt\(\s*['"]duration_seconds['"]\s*,\s*0\s*\)/,
    ]) {
      expect(billing, 'the billing page no longer carries this clause').toMatch(clause);
      expect(time, 'the time page has drifted from billing').toMatch(clause);
    }
  });
});
