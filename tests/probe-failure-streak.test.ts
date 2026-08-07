import { describe, expect, it } from 'vitest';
import { consecutiveFailures } from '../lib/hq-metrics';

/**
 * The bella probe failed 25 of the last 30 daily runs on the same
 * Anthropic 400, "Your credit balance is too low", and the page showed
 * the latest run and a 24-hour pass rate. Against a once-a-day cron
 * those two readouts render a probe that has been down for a month and
 * a probe that blipped once identically: one rose tile, one rose bar.
 * The streak is the number that separates them.
 *
 * `skipped` is not a measurement, so it neither counts as a failure nor
 * clears one, matching how summarizeProbeUptime leaves skipped out of
 * the denominator rather than scoring it as down.
 */

describe('consecutiveFailures', () => {
  it('is zero when the newest run passed', () => {
    expect(consecutiveFailures(['pass', 'fail', 'fail', 'fail'])).toBe(0);
  });

  it('is zero for an empty history', () => {
    expect(consecutiveFailures([])).toBe(0);
  });

  it('counts the run of failures from the newest end', () => {
    expect(consecutiveFailures(['fail', 'fail', 'fail', 'pass', 'fail'])).toBe(3);
  });

  it('stops at the first pass rather than counting every failure', () => {
    expect(consecutiveFailures(['fail', 'pass', 'fail', 'fail', 'fail'])).toBe(1);
  });

  it('steps over a skipped run without counting or clearing it', () => {
    // The probe is only configured when its key is set. A gap in
    // configuration is not an outage, and it is not a recovery either.
    expect(consecutiveFailures(['fail', 'skipped', 'fail', 'pass'])).toBe(2);
  });

  it('reports nothing when every run was skipped', () => {
    expect(consecutiveFailures(['skipped', 'skipped'])).toBe(0);
  });

  it('counts the whole window when nothing in it passed', () => {
    // The caller compares this against the window length to decide
    // whether to render "25" or "25+".
    expect(consecutiveFailures(Array(25).fill('fail'))).toBe(25);
  });
});
