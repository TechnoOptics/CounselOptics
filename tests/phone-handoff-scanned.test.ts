import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A code that has been scanned must stop looking like a code that can be
 * scanned.
 *
 * Reported from the same signing attempt that lost a mark: "the QR code stays
 * on screen instead of deactivating". The server had recorded consumed_at
 * eighteen seconds after minting, so it knew perfectly well that a phone was
 * holding the code, and the desk had no state to put that in. The card knew
 * only idle, minting, showing, expired and unavailable, so between the scan
 * and the signature the screen kept offering a code that no second phone could
 * claim and that the person in front of it had already used.
 *
 * The transition is a pure function so it can be driven here. The effect that
 * calls it cannot: vitest runs in the node environment with no DOM, which is
 * why the sibling cadence guard reads the source instead. What the source can
 * still be asked is where the QR markup lives, and it is asked below with the
 * comments stripped out first.
 */

const { nextHandoffPhase } = await import('../components/signing/PhoneHandoffCard');

const EXPIRES = 1_760_000_000_000;
const showing = {
  kind: 'showing' as const,
  svg: '<svg id="the-code"></svg>',
  expiresAtMs: EXPIRES,
  ref: 'h1',
};

describe('the card leaves the showing phase when a phone takes the code', () => {
  it('drops the QR the moment the server reports a scan', () => {
    const next = nextHandoffPhase(showing, 'scanned');
    expect(next.kind).toBe('scanned');
    // Not merely a different label over the same picture. The scanned phase
    // carries no svg at all, so there is nothing for the render branch to put
    // on screen even if somebody rewrote it.
    expect(next).not.toHaveProperty('svg');
    expect(JSON.stringify(next)).not.toContain('the-code');
  });

  it('keeps the handoff it was polling about', () => {
    // The desk still has to collect the picture, and the signer still has to
    // hear that the phone finished. Losing the ref here would strand both.
    expect(nextHandoffPhase(showing, 'scanned')).toMatchObject({
      kind: 'scanned',
      ref: 'h1',
    });
  });

  it('carries the original deadline rather than starting a new one', () => {
    // The expiry is an absolute instant, so moving phase cannot hand the
    // signer a fresh fifteen minutes on a row that dies at its own time.
    expect(nextHandoffPhase(showing, 'scanned')).toMatchObject({
      kind: 'scanned',
      expiresAtMs: EXPIRES,
    });
  });

  it('leaves the code up while nothing has happened', () => {
    expect(nextHandoffPhase(showing, 'waiting')).toBe(showing);
  });

  it('never puts a scanned code back on screen', () => {
    // The desk polls on after the scan, and those polls answer 'waiting' until
    // the phone is done. If waiting sent the card back to showing, the QR
    // would flicker back up over somebody mid-signature.
    const scanned = nextHandoffPhase(showing, 'scanned');
    expect(scanned.kind).toBe('scanned');
    expect(nextHandoffPhase(scanned, 'waiting')).toBe(scanned);
    expect(nextHandoffPhase(scanned, 'scanned')).toBe(scanned);
  });

  it('does not resurrect the code when the phone finishes', () => {
    // Both callers unmount the card on 'done', so this is the frame before it
    // disappears. It must not be the QR.
    expect(nextHandoffPhase(showing, 'done').kind).toBe('scanned');
    expect(nextHandoffPhase(nextHandoffPhase(showing, 'scanned'), 'done').kind).toBe(
      'scanned',
    );
  });

  it('ignores a poll that arrives after the code expired', () => {
    const expired = { kind: 'expired' as const };
    expect(nextHandoffPhase(expired, 'scanned')).toBe(expired);
  });
});

describe('the card renders the code in one place only', () => {
  /**
   * Comments stripped before matching. The comment above the QR div explains
   * what dangerouslySetInnerHTML is doing and why it is safe, so a guard run
   * over the raw file finds the string it is looking for inside the
   * explanation. Two guards in this repository have already passed that way.
   */
  const SOURCE = readFileSync(
    join(process.cwd(), 'components/signing/PhoneHandoffCard.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('puts the QR behind the showing phase and nothing else', () => {
    const uses = SOURCE.split('dangerouslySetInnerHTML').length - 1;
    expect(uses, 'the QR is drawn in more than one place now').toBe(1);
    const before = SOURCE.slice(0, SOURCE.indexOf('dangerouslySetInnerHTML'));
    expect(before).toContain("phase.kind === 'showing'");
    // And the nearest phase test above the QR is that one, so it is not
    // nested under a branch a scanned phase also satisfies.
    expect(before.lastIndexOf("phase.kind === 'showing'")).toBeGreaterThan(
      before.lastIndexOf("phase.kind === 'scanned'"),
    );
  });

  it('keeps polling while the phone is being signed on', () => {
    // The effect used to run only while showing. If it still did, moving to
    // scanned would tear the poll down and the desk would never learn that the
    // signature arrived: the exact bug, one state later.
    expect(SOURCE).toMatch(/phase\.kind === 'scanned'/);
    const effect = /const polling =([\s\S]*?);/.exec(SOURCE);
    expect(effect, 'the poll no longer has a single named condition').not.toBeNull();
    expect(effect![1]).toContain("'showing'");
    expect(effect![1]).toContain("'scanned'");
  });

  it('says something calm in place of the code', () => {
    expect(SOURCE).toContain('copy.scanned');
  });
});
