import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * The browser-drawn parts of a form: the select popup, the date picker
 * and the autofill wash. None of them inherit `.input`, each one breaks
 * in exactly one theme, and all three were missing until now.
 *
 * These are text assertions on app/globals.css, which is weaker than
 * measuring a paint. Vitest here is `environment: 'node'` with no DOM
 * and none may be added, so there is no rendering to measure. What this
 * catches is the realistic regression: someone tidying the stylesheet
 * and deleting rules whose purpose is not obvious from the declaration.
 * Nothing here can tell you the rules WORK in Chrome.
 */
const css = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8',
);

/** Strip comments, so a rule mentioned in prose does not count as present. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('native controls follow the app theme, not the OS', () => {
  it('pins color-scheme to the theme class rather than leaving it "light dark"', () => {
    // `light dark` means "ask the OS", and Advottic's theme is a class.
    // That mismatch is the whole bug: a light Mac gave a white date
    // picker on a near-black counsel field.
    expect(rules).not.toMatch(/color-scheme:\s*light\s+dark/);
    expect(rules).toMatch(/:root\s*\{[^}]*color-scheme:\s*light\s*;/);
    expect(rules).toMatch(/html\.dark\s*\{[^}]*color-scheme:\s*dark\s*;/);
  });

  it('marks the always-dark shells dark whatever the user chose', () => {
    // `.counsel-shell` is NOT on this list any more, and that is the
    // change rather than an omission: counsel has two themes now, so its
    // dark half is `.dark`, which this same block already declares.
    for (const shell of ['.enterprise-shell', '.hq-shell']) {
      const block = rules.match(
        new RegExp(`${shell.replace('.', '\\.')}[^{]*\\{[^}]*color-scheme:\\s*dark`),
      );
      expect(block, `${shell} should carry color-scheme: dark`).not.toBeNull();
    }
  });

  it('gives each counsel theme the scheme it actually paints', () => {
    // Both halves have to be stated. Inheriting from the root is what
    // the bug above WAS: a dark counsel under a light `html` got light
    // native chrome, and now a light counsel under a dark `html` would
    // get dark chrome for the mirror-image reason. Every counsel root
    // carries `.dark` when it is dark, so `.dark` covers that half.
    expect(rules).toMatch(/(?:^|[\s,])\.dark[\s,][^{]*\{[^}]*color-scheme:\s*dark/);
    expect(rules).toMatch(
      /\.counsel-shell:not\(\.dark\)\s*\{[^}]*color-scheme:\s*light\s*;/,
    );
  });

  it('lets the controls themselves inherit it', () => {
    // Defensive rather than load-bearing: color-scheme is an inherited
    // property, so a control picks its container's value up anyway.
    // Asserted because it is cheap and because deleting it is the sort
    // of tidy-up that would be made without checking.
    expect(rules).toMatch(
      /input,\s*select,\s*textarea\s*\{\s*color-scheme:\s*inherit\s*;?\s*\}/,
    );
  });
});

describe('the select popup is readable on a dark surface', () => {
  it('colours option explicitly, because Chrome ignores the parent', () => {
    expect(rules).toMatch(/\.counsel-shell option/);
    expect(rules).toMatch(/html\.dark option/);
  });

  it('takes the surface from the forest token, not a literal hex', () => {
    // The enterprise shells remap the forest ramp to neutral black, so
    // the token is what makes one declaration correct in both the green
    // consumer app and the black counsel one. A hardcoded hex here would
    // be right in one and wrong in the other.
    const optionRule = rules.match(/[^}]*option\s*\{[^}]*\}/);
    expect(optionRule).not.toBeNull();
    expect(optionRule?.[0]).toContain('rgb(var(--forest-800))');
  });

  it('takes the foreground from the palette too, not a literal hex', () => {
    // The background assertion above shipped alongside `color: #f5edd6`,
    // one property down, in the change whose whole thesis is never to
    // hardcode a colour for TEXT. The guard covered the property that
    // happened to be right. This is the other half.
    const optionRule = rules.match(/[^}]*option\s*\{[^}]*\}/)?.[0] ?? '';
    expect(optionRule).toContain("color: theme('colors.cream.100')");
    expect(
      optionRule,
      'the option foreground must come from the palette, not a hex',
    ).not.toMatch(/[^-]color:\s*#[0-9a-fA-F]{3,8}/);
  });

  it('leaves light mode to the browser default', () => {
    // A bare `option { }` rule would repaint the light select popup too,
    // which is how you fix dark mode and break light mode. Every option
    // selector must be scoped to a dark context.
    const selectors = rules.match(/^[^{}]*\boption\b[^{}]*(?=\{)/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const group of selectors) {
      for (const one of group.split(',')) {
        expect(
          one.trim(),
          `"${one.trim()}" is not scoped to a dark context`,
        ).toMatch(/\.dark|\.counsel-shell|\.enterprise-shell|\.hq-shell/);
      }
    }
  });
});

describe('autofill does not repaint the field', () => {
  /** The whole autofill rule, selectors included. */
  const autofillRule = rules.match(/input[^{}]*autofill[\s\S]*?\}/)?.[0] ?? '';

  it('matches both the prefixed and the standard pseudo-class', () => {
    // The rule named `:-webkit-autofill` nine times and `:autofill`
    // zero times. They cannot be comma-listed together: one unknown
    // pseudo-class invalidates a whole plain selector list, which on an
    // engine that lacks the prefixed form would delete the rule that
    // works. `:is()` parses forgivingly, so it is the safe way to say
    // "either of these".
    expect(autofillRule).toContain(':-webkit-autofill');
    expect(autofillRule).toContain(':autofill');
    // Split on top-level commas only: the commas inside `:is(...)` are
    // part of a selector, not separators between them.
    const selectors = autofillRule
      .slice(0, autofillRule.indexOf('{'))
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThanOrEqual(9);
    for (const one of selectors) {
      expect(one, `"${one}" names only one of the two spellings`).toMatch(
        /:is\(:-webkit-autofill,\s*:autofill\)/,
      );
    }
  });

  it('keeps the browser wash away and takes the text colour from the field', () => {
    expect(autofillRule).not.toBe('');
    const rule = autofillRule;
    // A duration long enough that the transition to the UA's yellow
    // never arrives. Anything short and the wash appears.
    expect(rule).toMatch(/background-color\s+9999s/);
    // The UA forces the text via -webkit-text-fill-color, so `color`
    // alone does nothing. currentColor means no token and no per-theme
    // variant: it resolves to whatever the field's own colour already is.
    expect(rule).toContain('-webkit-text-fill-color: currentColor');
    expect(rule).toContain('caret-color: currentColor');
  });

  it('does not cost the field its other transitions', () => {
    expect(autofillRule).toMatch(/border-color\s+0\.15s/);
    expect(autofillRule).toMatch(/color\s+0\.15s/);
  });
});
