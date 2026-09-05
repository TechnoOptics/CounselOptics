import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The shared header and footer, held to the case-file spec. Signed-out
 * visitors get a four-link nav and an outlined Sign in; signed-in visitors
 * keep today's header exactly. The footer is one rule and Courier-titled
 * columns, and it keeps the store row's in-app gate.
 */
const ROOT = join(__dirname, '..');
const LAYOUT = stripComments(readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8'));

describe('the signed-out header', () => {
  it('shows the four marketing links only when signed out', () => {
    const nav = /\{!signedIn && \(\s*<nav aria-label="Site"([\s\S]*?)<\/nav>\s*\)\}/.exec(LAYOUT);
    expect(nav, 'a signed-out <nav aria-label="Site"> is missing').not.toBeNull();
    for (const href of ['/pricing', '/features', '/enterprise', '/what-is-advottic']) {
      expect(nav![1]).toContain(`href="${href}"`);
    }
  });
  it('no longer blurs the bar', () => {
    const header = /<header className="sticky top-0 z-20">([\s\S]*?)<\/header>/.exec(LAYOUT)![1];
    expect(header).not.toMatch(/backdrop-blur/);
  });
});

describe('the footer', () => {
  const footer = /<footer([\s\S]*?)<\/footer>/.exec(LAYOUT)![1];
  it('sits on the paper with one ink rule', () => {
    expect(footer).toMatch(/border-t border-forest-900/);
    expect(footer).toContain('bg-paper');
    expect(footer).not.toMatch(/bg-white/);
  });
  it('titles its columns in Courier through the shared label role', () => {
    expect(LAYOUT).toMatch(/import \{ LABEL \} from '@\/components\/marketing\/file\/type'/);
    expect((footer.match(/\{LABEL\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('keeps the store row gated for the native app', () => {
    expect(footer).toMatch(/data-hide-in-app[\s\S]{0,400}<GetTheApp \/>/);
  });
  it('carries the disclaimer as a Courier line', () => {
    expect(footer).toMatch(/font-courier[^"]*"[^>]*>\s*Advottic is a service of Techno Optics LLC/);
  });
});
