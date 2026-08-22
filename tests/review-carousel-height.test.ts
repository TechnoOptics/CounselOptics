import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';
import { usableSlideHeight } from '../lib/carousel-height';

/**
 * THE DEFECT. The Advottic Review card is a horizontal track holding all four
 * sections side by side, so its natural height is the height of the tallest
 * section, not the one on screen. app/cases/[id]/review-panel.tsx pins the
 * track to the measured height of the active section to correct that.
 *
 * The measurement was taken once, on mount, and mount happens inside a
 * display:none subtree: components/Tabs.tsx renders every tab's content and
 * hides the inactive ones with the `hidden` attribute, and the case page opens
 * on Case rather than on Advottic Review. Everything in a display:none subtree
 * has offsetHeight 0, the pin was written as `height ? { height } : undefined`
 * so the 0 was discarded, and nothing measured again when the tab was opened.
 * The short Overview section was therefore shown in a card sized for Facts &
 * issues, leaving a large empty area under the classification.
 *
 * WHAT CAN AND CANNOT BE TESTED HERE. vitest runs in the node environment with
 * no DOM, and no DOM may be added, so the rendered result is not observable
 * from a test. What is observable is the rule that a 0 measurement is not a
 * height (usableSlideHeight, exercised directly below) and the fact that the
 * panel actually CALLS it and actually CONSTRUCTS a ResizeObserver, rather
 * than merely mentioning either. The source assertions run against
 * comment-stripped source so that this file's own explanation, and the
 * explanation in the panel, cannot satisfy them.
 */

const read = (rel: string) =>
  stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));

const PANEL = 'app/cases/[id]/review-panel.tsx';

describe('usableSlideHeight', () => {
  it('rejects the 0 a display:none subtree reports', () => {
    expect(usableSlideHeight(0)).toBeNull();
  });

  it('rejects a negative or non-finite measurement', () => {
    expect(usableSlideHeight(-1)).toBeNull();
    expect(usableSlideHeight(Number.NaN)).toBeNull();
    expect(usableSlideHeight(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('passes a real measurement through unchanged', () => {
    expect(usableSlideHeight(1)).toBe(1);
    expect(usableSlideHeight(412)).toBe(412);
    expect(usableSlideHeight(823.5)).toBe(823.5);
  });
});

describe('the review carousel measures the way the fix requires', () => {
  it('calls usableSlideHeight on the measured height', () => {
    const src = read(PANEL);
    expect(src).toMatch(/usableSlideHeight\(\s*el\.offsetHeight\s*\)/);
  });

  it('constructs a ResizeObserver, so a section hidden at mount is re-measured', () => {
    const src = read(PANEL);
    expect(src).toMatch(/new ResizeObserver\(/);
    expect(src).toMatch(/\bro\.observe\(/);
  });

  it('never writes a height straight from offsetHeight again', () => {
    const src = read(PANEL);
    expect(src).not.toMatch(/setHeight\(\s*el\.offsetHeight/);
  });
});
