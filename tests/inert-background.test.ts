import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INERT_ATTR, nodesToInert } from '../lib/inert-background';

/**
 * Safe Witness's discreet mode has to conceal, not merely cover.
 *
 * When a person hides the recording UI, the screen goes black. Under that
 * black rectangle the site header, the mobile nav, the footer and the Safe
 * Witness panel itself all stayed in the document, in the tab order, and in
 * the accessibility tree. So a Tab press painted a focus ring through the
 * overlay, and a screen reader read "Advottic", "Safe Witness", "Stop
 * recording" while the display showed nothing. For the person this feature
 * exists for, that is the failure that matters.
 *
 * Two things are held here, and vitest runs in the node environment with no
 * DOM, which shapes both.
 *
 *   1. The DECISION, which is pure: given a container's children and the
 *      overlay to spare, which get marked inert. That is where an off-by-one
 *      would live, and it is tested directly.
 *   2. That the overlay actually CALLS it. A pure helper nothing invokes is
 *      the failure shape this repository keeps producing, so the component is
 *      read and checked for the wiring. It is a source assertion and says so.
 *
 * WHAT THE PLATFORM ACTUALLY DOES, measured rather than assumed. `inert` was
 * probed in the preview browser (WebKit) on 2026-08-15, against a real element
 * in a real document:
 *
 *      focusable before          true
 *      focusable while inert     FALSE      <- the whole point
 *      activeElement while inert BODY       <- focus fell out, did not stick
 *      focusable after removal   true       <- the undo restores
 *
 * The first attempt at that probe reported "still focusable" and was WRONG:
 * it focused the element, then set inert, then called focus() again on the
 * element that was already active, so it measured nothing. The numbers above
 * are from the corrected probe, which blurs to a known state before each
 * attempt. Worth writing down, because a green-looking probe that proves
 * nothing is the same failure as a green-looking test that proves nothing.
 */

describe('which nodes go inert behind an overlay', () => {
  it('marks every sibling and spares the overlay', () => {
    const header = 'header';
    const overlay = 'overlay';
    const footer = 'footer';
    expect(nodesToInert([header, overlay, footer], overlay)).toEqual([
      header,
      footer,
    ]);
  });

  it('spares nothing when the overlay is not known', () => {
    // Deliberate. A caller that has lost track of its own node must not
    // silently fall back to sparing everything: that is exactly the state
    // this module exists to prevent, and it would look identical to working.
    expect(nodesToInert(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('spares only the overlay, even when siblings are equal-looking', () => {
    // Identity, not equality. Two `<div class="x">` siblings are not the
    // overlay just because they resemble it.
    const overlay = { id: 'o' };
    const twin = { id: 'o' };
    expect(nodesToInert([twin, overlay], overlay)).toEqual([twin]);
  });

  it('handles an overlay that is the only child', () => {
    const overlay = 'only';
    expect(nodesToInert([overlay], overlay)).toEqual([]);
  });

  it('returns only nodes it was given', () => {
    const children = ['a', 'b', 'c'];
    for (const n of nodesToInert(children, 'b')) {
      expect(children).toContain(n);
    }
  });
});

describe('the discreet overlay is wired to it', () => {
  const source = readFileSync(
    join(process.cwd(), 'components/SafeWitness.tsx'),
    'utf8',
  );

  it('calls inertBackground and returns its undo as the cleanup', () => {
    expect(source).toContain('inertBackground');
    // Returning the function IS the cleanup: if the overlay unmounts for any
    // reason, including the recording stopping on its own, the page must come
    // back. A call whose result is dropped would leave the whole site inert.
    expect(source).toMatch(/const restore = inertBackground\([^)]*\);/);
    expect(source).toMatch(/return restore;/);
  });

  it('hands it the overlay node, so the overlay is what gets spared', () => {
    expect(source).toMatch(/inertBackground\(ref\.current\)/);
  });

  it('keeps the low-contrast hint, which is camouflage and not a defect', () => {
    // A contrast checker flags this, and correcting it would announce what the
    // screen is to the person the user is hiding it from. The whole viewport
    // is the reveal target, so nobody needs to read the word.
    expect(source).toContain('text-white/10');
  });

  it('does not paint text in the background colour', () => {
    // The overlay used to carry `bg-black text-black`. The child overrode the
    // colour so nothing was ever invisible-on-purpose-by-accident, but a
    // reader could not tell that, and the next child added would have been.
    expect(source).not.toContain('bg-black text-black');
  });
});

describe('the attribute is named in one place', () => {
  it('is the platform one', () => {
    // aria-hidden would be worse than nothing here: it hides an element from a
    // screen reader while leaving it focusable, so focus lands somewhere that
    // is now undescribable.
    expect(INERT_ATTR).toBe('inert');
  });
});
