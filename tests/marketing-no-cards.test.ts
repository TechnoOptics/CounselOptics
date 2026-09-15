import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** The four pages carry no card grids, frames, photographs or marquee. */
const ROOT = join(__dirname, '..');
const PAGES = ['app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx', 'components/marketing/FeatureIndex.tsx'];
describe.each(PAGES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('has no card, frame, photo or marquee', () => {
    expect(src).not.toMatch(/rounded-(?:2xl|3xl|full)|className="card|BrowserFrame|SectionPhoto|TestimonialMarquee|FeatureGallery|<Image\b|<img\b/);
  });
});
