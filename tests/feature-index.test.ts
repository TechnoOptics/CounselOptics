import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The features page is the table of contents of the file: lettered
 * entries for people, the four request states for firms, one Sheet where a
 * real screen matters, no browser frames, no gold.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/features/page.tsx'), 'utf8'));
const INDEX = stripComments(readFileSync(join(ROOT, 'components/marketing/FeatureIndex.tsx'), 'utf8'));

describe('the index', () => {
  it('letters the eight people entries A to H', () => {
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(INDEX, `tab="${letter}"`).toMatch(new RegExp(`tab="${letter}"`));
    }
  });
  it('keys the firm entries by the four request states, in order', () => {
    const order = ['Filed', 'With legal', 'Sent', 'Executed'].map((s) => INDEX.indexOf(`tab="${s}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('is a real toggle with tab semantics', () => {
    expect(INDEX).toMatch(/role="tablist"/);
    expect(INDEX).toMatch(/aria-selected=\{/);
    expect(INDEX).toMatch(/useState<'people' \| 'firm'>/);
  });
  it('gives the tab buttons a 44px touch target', () => {
    expect(INDEX).toMatch(/min-h-\[44px\]/);
  });
  it('ships no frames, cards or gold', () => {
    for (const s of [PAGE, INDEX]) {
      expect(s).not.toMatch(
        /BrowserFrame|FeatureSheet|ApprovalToExecuted|rounded-2xl|rounded-3xl|rounded-full|gold-|Stamp|italic|font-display|font-sans|font-mono|font-serif/,
      );
    }
  });
});
