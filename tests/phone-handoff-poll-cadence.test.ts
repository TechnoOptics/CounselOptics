import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The desk has to notice the phone finishing, fast enough that a person
 * believes it worked.
 *
 * Reported from a real signing attempt: "the signature did not show up in
 * realtime when signing". It was not lost. The desk polled every 4000ms AND
 * setInterval's first tick is a whole interval away, so the worst case was
 * close to eight seconds of nothing after the phone was done. The reasonable
 * conclusion for the person watching is that the handoff failed, so they scan
 * again or abandon it for the pad.
 *
 * Why polled at all, since a push would be better: the same card renders on
 * the public /sign/[token] page, which is UNAUTHENTICATED. A Supabase realtime
 * channel there subscribes successfully and then silently never fires, which
 * is a worse failure than a slow poll because it looks like it is working.
 * That reasoning is in the component and is why this is a cadence fix rather
 * than a realtime one.
 *
 * This is a SOURCE-READING guard and says so. The behaviour it protects lives
 * in a React effect, and vitest runs in the node environment with no DOM, so
 * the effect cannot be driven here. What it can do is stop the two specific
 * regressions that produced the report: the interval creeping back up, and
 * the immediate first check being dropped as redundant.
 */

const SOURCE = readFileSync(
  join(process.cwd(), 'components/signing/PhoneHandoffCard.tsx'),
  'utf8',
);

describe('the desk notices the phone quickly enough to be believed', () => {
  it('polls at most every 1500ms', () => {
    const m = /const POLL_MS = (\d+);/.exec(SOURCE);
    expect(m, 'POLL_MS is no longer a plain literal').not.toBeNull();
    const ms = Number(m![1]);
    expect(ms).toBeGreaterThan(0);
    // The ceiling, not the exact value: tuning down is fine, drifting back up
    // to the four seconds that caused the report is not.
    expect(
      ms,
      'POLL_MS above 1500 reproduces the "did not show up in realtime" report',
    ).toBeLessThanOrEqual(1500);
  });

  it('asks once immediately rather than waiting out the first interval', () => {
    // setInterval does not fire at t=0. Without this call the desk is deaf for
    // a full POLL_MS after the code goes up, which is precisely when somebody
    // who already had the phone in hand finishes.
    expect(SOURCE).toMatch(/void check\(\);\s*\n\s*const timer = setInterval\(check, POLL_MS\);/);
  });

  it('still stops polling when the card goes away', () => {
    // The leak this would become is a timer per code shown, each holding a
    // closure over a stale ref, on a page somebody may sit on for a while.
    expect(SOURCE).toContain('clearInterval(timer)');
    expect(SOURCE).toMatch(/stopped = true;/);
  });

  it('opens no realtime subscription', () => {
    // The signer surface is unauthenticated: a channel there subscribes
    // successfully and then silently never fires, which looks like it works.
    // The WORD realtime is expected in the component, because the comment has
    // to explain why there is no subscription. What must not appear is an
    // actual one. (This assertion started out forbidding the word too, and
    // failed on the very comment that documents the decision.)
    expect(SOURCE).not.toMatch(/\.channel\(|\.subscribe\(/);
  });
});
