import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatSignedOn } from '../lib/firm-template-placeholders';

/**
 * A signed document has to say WHEN it was signed, in a way two readers agree
 * on.
 *
 * Reported from a real signing: "I signed and still do not see a signature
 * time and signature date on the document." Both printers were date-only, in
 * two different ways: the template block used toLocaleDateString, and the
 * executed PDF caption used .toISOString().slice(0, 10), a string cut at ten
 * characters that also drops the time and prints ISO rather than US format.
 *
 * THE ZONE IS THE LOAD-BEARING PART. Adding a local-format time first made the
 * document render DIFFERENTLY in the two places Advottic renders it: the
 * employee's browser and the server that builds the PDF. On one instant that
 * is 12:00 PM UTC, 6:00 AM CST and 4:00 AM PST - and a late-evening signature
 * lands on two different calendar DAYS, which decides notice periods, cure
 * windows and priority. So the zone is pinned to UTC in the formatter rather
 * than inherited from wherever the code happens to run.
 *
 * That pinning is what makes the document pins in
 * tests/template-signature-line.test.ts stable on every machine. A test that
 * passes only in the zone its author sat in is not a pin.
 */

describe('what a signature line says', () => {
  const AT = new Date('2026-03-03T12:00:00.000Z');

  it('carries the date, the time and the zone', () => {
    expect(formatSignedOn(AT)).toBe('March 3, 2026 at 12:00 PM UTC');
  });

  it('is the same string wherever it is rendered', () => {
    // The defect this exists for. Not asserted by re-deriving the value, which
    // would just repeat the implementation: the expected string is written out
    // above, so a formatter that starts following the machine's zone fails
    // here on any machine that is not on UTC.
    expect(formatSignedOn(AT)).not.toMatch(/CST|CDT|PST|PDT|EST|EDT|GMT\+/);
    expect(formatSignedOn(AT)).toMatch(/UTC/);
  });

  it('is US format, not ISO', () => {
    expect(formatSignedOn(AT)).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(formatSignedOn(AT)).not.toBe(AT.toISOString().slice(0, 10));
  });

  it('is not date-only, which is what was reported', () => {
    const dateOnly = AT.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    expect(formatSignedOn(AT)).not.toBe(dateOnly);
    expect(formatSignedOn(AT)).toContain(dateOnly);
  });

  it('returns empty for an Invalid Date, never the words "Invalid Date"', () => {
    // A signed instrument must not print "Invalid Date" where a timestamp
    // belongs. An empty gap is noticed; that string looks deliberate.
    expect(formatSignedOn(new Date('garbage'))).toBe('');
  });
});

describe('both printers use the one formatter', () => {
  const RAW = readFileSync(join(process.cwd(), 'lib/signature-render.ts'), 'utf8');
  /**
   * Comments stripped before matching. The first version of the ban below
   * failed against CORRECT code, because the comment explaining the fix quotes
   * the expression it bans. A rule that cannot survive its own documentation
   * is a trap for whoever explains the next change.
   */
  const RENDER = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the executed PDF caption no longer slices an ISO string', () => {
    expect(RENDER).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });

  it('the caption calls the shared formatter', () => {
    expect(RENDER).toMatch(/formatSignedOn\(new Date\(s\.signed_at\)\)/);
  });

  it('the caption still reads the timestamp from the row', () => {
    // This path has the real instant and must keep using it. It is the
    // template path that recomputes its own, which formatSignedOn records as
    // an open limitation.
    expect(RENDER).toMatch(/s\.signed_at \?/);
  });
});
