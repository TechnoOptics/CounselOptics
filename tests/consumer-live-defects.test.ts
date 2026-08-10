import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES } from '../lib/guides';
import { ES_GUIDES } from '../lib/es-guides';
import { isConsentDeferredPath } from '../lib/crisis-routes';
import { isPrerenderedRender } from '../lib/prerender';

/**
 * Regression tests for the consumer-side defects found in the 2026-08-01
 * live browser walkthrough (docs/audit/UX_AUDIT_CONSUMER_LIVE.md). Each
 * block names the thing a real visitor saw.
 */

const ROOT = join(__dirname, '..');
const GLOBALS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

/** WCAG 2.x relative luminance for an #rrggbb string. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const chan = (i: number) => {
    const v = parseInt(n.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(1) + 0.0722 * chan(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every individual selector in the "Contrast safety" block, whitespace and
 * line breaks normalised so reformatting the rules cannot silently empty the
 * assertion set. Comments are stripped first so prose cannot look like CSS.
 */
function contrastSafetySelectors(): string[] {
  const start = GLOBALS.indexOf('/* ---------------------------- Contrast safety');
  const end = GLOBALS.indexOf('/* Tile-on-tile contrast', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return GLOBALS.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((block) => block.split('{')[0])
    .join(',')
    .split(',')
    .map((sel) => sel.replace(/\s+/g, ' ').trim())
    .filter((sel) => sel.startsWith('html') && sel.includes('>'));
}

describe('the contrast guard never repaints text that sits on its own background', () => {
  // A user on /cases/{id}/timeline saw the paywall's only call to action
  // render as a blank dark-green pill: `bg-forest-900 text-cream-50` sitting
  // as a direct child of a `bg-white` card, so the light-on-light guard
  // repainted the label dark green onto a dark green button.
  const selectors = contrastSafetySelectors();

  it('finds the guard family in globals.css', () => {
    expect(selectors.length).toBeGreaterThan(10);
  });

  it('exempts any child that declares its own background utility', () => {
    const offenders = selectors.filter(
      (s) => !s.includes(':not([class^="bg-"]):not([class*=" bg-"])'),
    );
    expect(offenders).toEqual([]);
  });

  it('anchors the exemption so a variant-only background still gets the guard', () => {
    // `hover:bg-cream-50` paints nothing at rest, so an element whose only
    // background token is a variant is transparent and still needs rescuing.
    // A bare [class*="bg-"] would have exempted it.
    expect(GLOBALS).not.toMatch(/:not\(\[class\*="bg-"\]\)/);
  });

  it('exempts the component classes that paint a dark gradient themselves', () => {
    const creamGuards = selectors.filter((s) => s.includes('.text-cream'));
    expect(creamGuards.length).toBeGreaterThan(0);
    const offenders = creamGuards.filter(
      (s) => !s.includes(':not(.brand-mark):not(.hero-bg)'),
    );
    expect(offenders).toEqual([]);
  });
});

describe('.eyebrow passes WCAG AA on both of its grounds', () => {
  // Measured live at 3.32:1 with 89 failing nodes on /pricing alone.
  const declared = /\.eyebrow\s*\{[^}]*?color:\s*(#[0-9a-fA-F]{6})/.exec(GLOBALS);
  const dark = /:where\(\.dark, \.enterprise-shell\)\s+\.eyebrow\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/i.exec(
    GLOBALS,
  );

  it('declares an explicit colour rather than inheriting text-gold-700', () => {
    expect(declared).not.toBeNull();
  });

  it('clears 4.5:1 on white', () => {
    expect(contrast(declared![1], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('clears 4.5:1 on the darkest light surface it renders on (cream-200)', () => {
    expect(contrast(declared![1], '#f5edd6')).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the dark shells their own gold', () => {
    expect(dark).not.toBeNull();
    expect(dark![1].toLowerCase()).not.toBe(declared![1].toLowerCase());
  });

  it('clears 4.5:1 on the lightest surface a dark shell paints', () => {
    // The half that was wrong, and it was wrong because the override
    // reaches TWO repaint families. `.dark` turns the light utilities
    // GREEN on the consumer side and near-black under counsel, and the
    // green is three times the luminance: `.dark .bg-cream-200` is
    // #2a5a47. The shipped #a38a55 was tuned on the black one and
    // measured 2.38:1 on the green - it was not marginal there, it was
    // a fifth of the floor. Every solid surface either family paints is
    // swept in tests/accent-text.test.ts; this is its worst.
    expect(contrast('#a38a55', '#2a5a47')).toBeLessThan(2.5);
    expect(contrast(dark![1], '#2a5a47')).toBeGreaterThanOrEqual(4.5);
    // And the tightest counsel neutral, which it also missed.
    expect(contrast('#a38a55', '#2c2c31')).toBeLessThan(4.5);
    expect(contrast(dark![1], '#2c2c31')).toBeGreaterThanOrEqual(4.5);
  });

  it('covers .enterprise-shell, which paints near-black without a .dark class', () => {
    // /enterprise sets `class="enterprise-shell ..."` with no `.dark`, and
    // remaps --forest-950 to 10 10 11. The light-surface colour measures
    // 2.77:1 there, so it must fall under the dark-shell override instead.
    expect(contrast(declared![1], '#0a0a0b')).toBeLessThan(4.5);
    expect(contrast(dark![1], '#0a0a0b')).toBeGreaterThanOrEqual(4.5);
    const enterprise = readFileSync(join(ROOT, 'app/enterprise/page.tsx'), 'utf8');
    expect(enterprise).toMatch(/enterprise-shell/);
  });
});

describe('the cookie dialog never blocks crisis content', () => {
  // A visitor who may be in danger landed on the domestic-violence guide and
  // found the hotline numbers behind a blurred backdrop and a consent modal.
  it('defers on the English domestic-violence guide', () => {
    expect(isConsentDeferredPath('/guides/i-need-help-domestic-violence')).toBe(true);
  });

  it('defers on the Spanish domestic-violence guide', () => {
    expect(isConsentDeferredPath('/es/guias/ayuda-violencia-domestica')).toBe(true);
  });

  it('defers on the Safe Witness alert screen', () => {
    expect(isConsentDeferredPath('/safe')).toBe(true);
  });

  it('covers every guide the content marks as a crisis guide', () => {
    for (const g of GUIDES.filter((x) => x.crisis)) {
      expect(isConsentDeferredPath(`/guides/${g.slug}`)).toBe(true);
    }
    for (const g of ES_GUIDES.filter((x) => x.crisis)) {
      expect(isConsentDeferredPath(`/es/guias/${g.slug}`)).toBe(true);
    }
  });

  it('still blocks on ordinary pages, so consent is still asked for', () => {
    expect(isConsentDeferredPath('/')).toBe(false);
    expect(isConsentDeferredPath('/pricing')).toBe(false);
    expect(isConsentDeferredPath('/guides/my-landlord-is-evicting-me')).toBe(false);
  });
});

describe('statically rendered guides do not tell a signed-in user to sign in', () => {
  // /guides/* and /es/* are `dynamic = 'force-static'`, so cookies() returns
  // nothing at build time and the layout renders the anonymous shell - a
  // signed-in reader looks up from a guide and the app says "Sign in".
  // Middleware sets x-pathname on every real request, so its absence is how
  // a server component knows it is being prerendered and must let the client
  // settle the session.
  it('treats a request with no x-pathname header as a prerender', () => {
    expect(isPrerenderedRender(null)).toBe(true);
    expect(isPrerenderedRender('')).toBe(true);
  });

  it('treats a real request as a live render', () => {
    expect(isPrerenderedRender('/guides/i-need-help-domestic-violence')).toBe(false);
    expect(isPrerenderedRender('/')).toBe(false);
  });

  it('hands the signed-out header to the client probe when prerendered', () => {
    const src = readFileSync(join(ROOT, 'components/UserMenu.tsx'), 'utf8');
    expect(src).toMatch(/isPrerenderedRender\(/);
    expect(src).toMatch(/<HeaderAuthProbe\b/);
  });

  it('keeps the guide routes statically rendered', () => {
    const guide = readFileSync(join(ROOT, 'app/guides/[slug]/page.tsx'), 'utf8');
    expect(guide).toMatch(/dynamic = 'force-static'/);
  });
});

describe('the homepage hero is not clipped on a narrow phone', () => {
  // At 375px and 390px the 44px display headline set the grid item's
  // min-content width to 380px inside a 339px container, and overflow-x:clip
  // meant the right edge of the H1, the CTA row and the trust row were lost
  // with no scrollbar to recover them.
  const HOME = readFileSync(join(ROOT, 'app/page.tsx'), 'utf8');

  const BAND = readFileSync(join(ROOT, 'components/marketing/ProductShowcaseBand.tsx'), 'utf8');

  function gridChildClasses(src: string, marker: string): string {
    const at = src.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return /className="([^"]*)"/.exec(src.slice(at))![1];
  }

  it('lets the hero copy column shrink below its min-content width', () => {
    const cls = gridChildClasses(HOME, 'Left: editorial copy block');
    expect(cls.split(/\s+/)).toContain('min-w-0');
    expect(cls).toMatch(/lg:col-span-7/);
  });

  it('lets both product-showcase columns shrink too', () => {
    for (const marker of ['{/* Personal */}', '{/* Firm */}']) {
      expect(gridChildClasses(BAND, marker).split(/\s+/)).toContain('min-w-0');
    }
  });
});
