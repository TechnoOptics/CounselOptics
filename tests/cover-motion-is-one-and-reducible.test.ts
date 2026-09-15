import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** One motion on the marketing site, and reduced motion removes it. */
const ROOT = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));
describe('the one motion', () => {
  it('is the home cover sheet, opted in exactly once across marketing', () => {
    const all = [
      'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
      'components/marketing/FeatureIndex.tsx', 'components/marketing/file/Schedule.tsx',
    ].map(read).join('\n');
    expect(all.match(/\bassemble\b/g)?.length).toBe(1);
    expect(all).not.toMatch(/animate-|stagger|gold-pan|shimmer|transition-transform/);
  });
  it('is removed, not reduced, under prefers-reduced-motion', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.file-assemble > \[data-row\],\s*\.file-assemble \[data-stamp\] \{([\s\S]*?)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/animation: none;/);
  });
});
