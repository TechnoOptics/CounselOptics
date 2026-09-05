// tests/marketing-file-tokens.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The case-file type roles and paper tokens exist once, at the root.
 *
 * Reads comment-stripped source so a comment naming a font cannot satisfy
 * it, and asserts the CALL (next/font constructor) and the CLASS placement,
 * not a name in prose.
 */
const ROOT = join(__dirname, '..');
const src = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

describe('the four marketing faces', () => {
  const layout = src('app/layout.tsx');
  it('are constructed through next/font/google with their CSS variables', () => {
    expect(layout).toMatch(/Libre_Caslon_Display\(\{[\s\S]*?variable: '--font-caslon'/);
    expect(layout).toMatch(/Libre_Caslon_Text\(\{[\s\S]*?style: \['normal', 'italic'\][\s\S]*?variable: '--font-caslon-text'/);
    expect(layout).toMatch(/Public_Sans\(\{[\s\S]*?variable: '--font-public'/);
    expect(layout).toMatch(/Courier_Prime\(\{[\s\S]*?variable: '--font-courier'/);
  });
  it('put their variables on <html> next to the existing ones', () => {
    // [\s\S]*? after the closing backtick (rather than an immediate `}`)
    // tolerates the pre-existing `.trim()` call chained onto the template
    // literal; it still stops at the very next `}`, so it captures exactly
    // the template literal's own contents, nothing further.
    const html = /<html[\s\S]*?className=\{`([^`]*)`[\s\S]*?\}/.exec(layout);
    expect(html, '<html className={`...`}> not found').not.toBeNull();
    for (const v of ['caslon.variable', 'caslonText.variable', 'publicSans.variable', 'courier.variable']) {
      expect(html![1]).toContain(`\${${v}}`);
    }
  });
  it('are Tailwind families', () => {
    const tw = src('tailwind.config.ts');
    expect(tw).toMatch(/caslon: \['var\(--font-caslon\)'/);
    expect(tw).toMatch(/'caslon-text': \['var\(--font-caslon-text\)'/);
    expect(tw).toMatch(/public: \['var\(--font-public\)'/);
    expect(tw).toMatch(/courier: \['var\(--font-courier\)'/);
  });
});

describe('paper, sheet and rule', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const tw = src('tailwind.config.ts');
  it('are Tailwind colours backed by variables', () => {
    expect(tw).toMatch(/paper: 'var\(--paper\)'/);
    expect(tw).toMatch(/sheet: 'var\(--sheet\)'/);
    expect(tw).toMatch(/rule: 'var\(--rule\)'/);
  });
  it('are defined in the light block and redefined in the dark block', () => {
    // Anchored on the block that carries --muted (the semantic surface-token
    // block alongside --background/--surface/--foreground/--border), not the
    // first :root / first matching dark selector in the file - globals.css
    // has several of each, and a non-anchored regex would silently match an
    // unrelated block.
    const light = /:root \{([^}]*--muted: #5d5d68;[^}]*)\}/.exec(css)![1];
    const dark = /html\.dark,\s*\.dark,\s*\.enterprise-shell,\s*\.hq-shell \{([^}]*--muted: #9c9ca6;[^}]*)\}/.exec(css)![1];
    for (const block of [light, dark]) {
      expect(block).toMatch(/--paper:/);
      expect(block).toMatch(/--sheet:/);
      expect(block).toMatch(/--rule:/);
    }
    expect(/--paper:\s*([^;]+)/.exec(light)![1]).not.toBe(/--paper:\s*([^;]+)/.exec(dark)![1]);
  });
  it('ship the single assemble animation and remove it under reduced motion', () => {
    expect(css).toMatch(/@keyframes file-row/);
    expect(css).toMatch(/@keyframes file-stamp/);
    expect(css).toMatch(/\.file-assemble > \[data-row\] \{[\s\S]*?animation: file-row/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.file-assemble > \[data-row\],\s*\.file-assemble \[data-stamp\] \{\s*animation: none;/;
    expect(css).toMatch(reduced);
  });
});
