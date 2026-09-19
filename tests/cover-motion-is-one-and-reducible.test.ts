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
  it('leaves no animation class on a marketing page outside the reduced-motion list', () => {
    // "Reduced motion means none, not less" is only true of a class the
    // media query actually names. The status page's live dot ran
    // .animate-ping forever, and .animate-ping was not in the list.
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)$/.exec(css);
    expect(reduced, 'the reduced-motion block is gone').not.toBeNull();
    const pages = [
      'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
      'app/about/page.tsx', 'app/what-is-advottic/page.tsx', 'app/security/page.tsx',
      'app/guides/page.tsx', 'app/glossary/page.tsx', 'app/compare/page.tsx', 'app/press/page.tsx',
      'app/changelog/page.tsx', 'app/status/page.tsx', 'app/accessibility/page.tsx',
      'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/cookies/page.tsx', 'app/dmca/page.tsx',
    ];
    const used = new Set<string>();
    for (const p of pages) for (const m of read(p).match(/\banimate-[a-z-]+/g) ?? []) used.add(m);
    expect(used.size, 'no marketing page animates anything any more').toBeGreaterThan(0);
    for (const cls of used) {
      expect(reduced![1], `.${cls} runs on a marketing page and reduced motion does not stop it`)
        .toMatch(new RegExp(`\\.${cls}\\s*[,{]`));
    }
  });
  it('is removed, not reduced, under prefers-reduced-motion', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.file-assemble > \[data-row\],\s*\.file-assemble \[data-stamp\] \{([\s\S]*?)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/animation: none;/);
  });
});
