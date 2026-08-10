import { describe, expect, it } from 'vitest';
import { carriedShellClasses } from '../components/Dialog';

/**
 * A Dialog portals itself into <body>, which puts it OUTSIDE the element the
 * counsel and enterprise themes live on: `.counsel-shell` sits on a div inside
 * the route layout, never on <html>.
 *
 * `<html>` now follows the shell's theme (lib/counsel-theme-values.ts), so the
 * two no longer disagree about DARKNESS. That is not the same thing as being
 * in scope. `<html>` wears `surface-counsel`, and every light repaint in
 * app/globals.css is written `.counsel-shell:not(.dark) .text-cream-100`, so a
 * selector naming the shell still cannot reach a subtree that left it.
 * Measured on main with <html> already agreeing: the counsel customizer opens
 * at 1.04:1 in light, and its panel is consumer forest green rather than the
 * firm's neutral black in dark.
 *
 * The function under test is the whole decision. It is deliberately pure so it
 * can be held still here, where vitest runs in environment: 'node' with no DOM.
 */
describe('carriedShellClasses', () => {
  it('carries a dark counsel shell, so the panel paints the firm neutral', () => {
    expect(
      carriedShellClasses(['dark', 'counsel-shell', 'accent-scope']),
    ).toBe('counsel-shell accent-scope dark');
  });

  it('carries a light counsel shell, which is the reported defect', () => {
    // The reader who opened "Customize dashboard" and saw nothing.
    expect(carriedShellClasses(['counsel-shell', 'accent-scope'])).toBe(
      'counsel-shell accent-scope',
    );
  });

  it('carries the enterprise shell, which has one theme and no .dark', () => {
    // /enterprise is a consumer marketing route, so <html> there still
    // follows the READER's theme rather than the shell's. The shell must
    // travel anyway: `.enterprise-shell` is identity, not theme, and it is
    // what remaps the forest ramp to neutral. An earlier revision of this
    // function withheld the shell whenever <html> was dark and the shell was
    // not, which would have silently stripped it on exactly this route.
    expect(carriedShellClasses(['enterprise-shell'])).toBe('enterprise-shell');
  });

  it('adds nothing for a shell-less consumer surface', () => {
    expect(carriedShellClasses([])).toBe('');
    expect(carriedShellClasses(['some-page-class'])).toBe('');
  });
});
