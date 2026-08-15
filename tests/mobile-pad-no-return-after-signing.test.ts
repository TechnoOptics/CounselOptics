import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { markHandoffRefusal, MARK_HANDOFF_REFUSAL_DONE } from '../lib/mark-handoff';

/**
 * After the mark has gone, the phone must not offer the pad again.
 *
 * Reported: "once signed on mobile, do not allow the user to click the back
 * button to the signature page, that goes away completely."
 *
 * Two layers answer this, and only one of them was missing.
 *
 * THE SERVER ALREADY HELD. A re-fetch of the pad page reads the row and, for a
 * spent handoff, renders MARK_HANDOFF_REFUSAL_DONE rather than a pad. Nothing
 * can be signed twice: lib/mark-handoff-queries.ts consumes conditionally on
 * `consumed_at IS NULL` and reads the row back. That half is asserted here so
 * a future edit cannot quietly collapse the done sentence into the generic
 * "no longer valid" one, which would tell somebody who just signed that their
 * signature failed.
 *
 * A comment on the pad page claims the refusal wording is "deliberately the
 * same sentence for a used code, an expired code and a different device". For
 * a used code it is NOT, and has not been: markHandoffRefusal branches. The
 * test encodes the code's behaviour, which is the correct one.
 *
 * THE CLIENT DID NOT. `done` is React state, so a back press restoring this
 * entry from the browser's cache showed a blank pad where the person had just
 * signed. Nothing was lost, but the only evidence they had said otherwise.
 * The component now pushes a history entry once the submit succeeds and
 * re-pushes it on popstate, holding a back press on the confirmation.
 *
 * The client half is a SOURCE assertion and says so: the behaviour is a React
 * effect against window.history, and vitest runs in the node environment with
 * no DOM here.
 */

const PAD = readFileSync(
  join(process.cwd(), 'app/sign/m/[handoff]/mobile-pad.tsx'),
  'utf8',
);

describe('a spent handoff tells the signer it worked', () => {
  it('says the signature arrived, not that the code is invalid', () => {
    expect(markHandoffRefusal('already-signed')).toBe(MARK_HANDOFF_REFUSAL_DONE);
    expect(MARK_HANDOFF_REFUSAL_DONE).toMatch(/already gone to your computer/i);
  });

  it('does not reuse the generic refusal for a signature that landed', () => {
    // The failure this prevents: somebody signs, taps back, and is told the
    // code is no longer valid. They then sign again on the desk pad, and the
    // document carries a mark they made twice.
    expect(markHandoffRefusal('already-signed')).not.toBe(
      markHandoffRefusal('expired'),
    );
  });
});

describe('the pad does not come back after the mark is sent', () => {
  it('holds a back press on the confirmation once signed', () => {
    // TWO pushes, and the count is the point. One seeds the entry that a back
    // press consumes; the one inside `hold` replaces it so the next press is
    // held too. An earlier version of this test matched /pushState/ once and
    // stayed green when the seeding push was deleted, because the push inside
    // `hold` satisfied it. With only the hold there is no entry to go back
    // FROM, so the first press leaves the page and the guard does nothing.
    expect(PAD.match(/window\.history\.pushState/g) ?? []).toHaveLength(2);
    expect(PAD).toMatch(
      /window\.history\.pushState\(null, '', window\.location\.href\);\s*\n\s*const hold/,
    );
    expect(PAD).toMatch(/addEventListener\('popstate', hold\)/);
  });

  it('arms the hold only after a successful submit', () => {
    // Trapping back for somebody who has NOT signed would strand them on a pad
    // they wanted to leave. The effect must be gated on `done`.
    expect(PAD).toMatch(/if \(!done \|\| typeof window === 'undefined'\) return;/);
    expect(PAD).toMatch(/\}, \[done\]\);/);
  });

  it('removes the listener when it unmounts', () => {
    expect(PAD).toMatch(/removeEventListener\('popstate', hold\)/);
  });
});
