import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Pricing is a schedule of fees: two ruled tables built from the tier
 * arrays that already existed, one stamp, the iOS branch untouched.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/pricing/page.tsx'), 'utf8'));

describe('the schedule', () => {
  it('renders both audiences through Schedule from the existing tier arrays', () => {
    expect(PAGE.match(/<Schedule\b/g)?.length).toBe(2);
    expect(PAGE).toMatch(/columns=\{CONSUMER_TIERS\.map\(tierToColumn\)\}/);
    expect(PAGE).toMatch(/columns=\{FIRM_TIERS\.map\(tierToColumn\)\}/);
  });
  it('puts the one stamp on Pro', () => {
    expect(PAGE.match(/stampOn=/g)?.length).toBe(1);
    expect(PAGE).toMatch(/stampOn="pro"/);
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border)-gold-|gold-metal|amber-/);
  });
  it('keeps the iOS branch that renders nothing purchasable', () => {
    expect(PAGE).toMatch(/serverPlatform === 'ios'/);
    expect(PAGE).toMatch(/href="\/gift"[^>]*data-hide-on-ios|data-hide-on-ios[^>]*href="\/gift"|hideOnIos: true/);
  });
  it('no longer ships cards, the partner strip or a gold button', () => {
    expect(PAGE).not.toMatch(/TechTrustStrip|TierCard|className="card|btn-primary|rounded-2xl|rounded-3xl/);
  });
});
