import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ARTICLES } from '../lib/articles';
import { CHANGELOG } from '../lib/changelog';
import { IOS_SELL_ROUTE_PREFIXES, isIosSellRoute } from '../lib/platform';

/**
 * The articles and the changelog are content people legitimately read inside
 * the iOS app, so they are NOT redirected there. What they must not do inside
 * the app is link to a sell-only route or name one of our own prices.
 * Findings 15 to 18 of docs/IOS_3_1_1_REACHABILITY_SWEEP.md.
 *
 * HOW. Both pages are static server components with no request or database
 * dependency, so they are RENDERED here with react-dom/server, and each
 * platform view is modelled by removing exactly the elements its globals.css
 * rules hide (the same model as tests/dangling-purchase-sentences.test.ts,
 * which also pins the rule order the Android view relies on).
 *
 * WHAT IS ASSERTED. In the iOS view: no anchor to a sell route survives, and
 * none of our own prices survives. Other vendors' prices are reporting, not an
 * offer, and stay; the three price shapes below are ours alone in this
 * content (lib/articles.ts names no other vendor at $19/mo, $59 or $99). The
 * web view keeps every link and price (positive control), and the Android view
 * equals the web view. Finally, lib/platform.ts and middleware.ts each keep
 * their own copy of the sell-route list, and this file reads middleware.ts so
 * that the two cannot drift apart unnoticed.
 */

const ROOT = join(__dirname, '..');

function without(html: string, attr: string): string {
  const re = new RegExp(`<(span|a)\\b[^>]*\\b${attr}\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'g');
  return html.replace(re, '');
}
const iosView = (html: string) => without(html, 'data-hide-on-ios');
const webView = (html: string) => without(html, 'data-show-in-app');
const androidView = (html: string) => without(html, 'data-hide-on-android');
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const hrefs = (html: string) =>
  Array.from(html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g), (m) => m[1]);

/** Our own price shapes in this content. */
const OUR_PRICES = /\$19\/mo|\$59\b|\$99\b/;

describe('the sell-route list is the one middleware.ts enforces', () => {
  it('lib/platform.ts and middleware.ts name the same prefixes', () => {
    const src = readFileSync(join(ROOT, 'middleware.ts'), 'utf8');
    const m = src.match(/const IOS_BLOCKED_PREFIXES = \[([^\]]*)\]/);
    expect(m, 'middleware.ts no longer declares IOS_BLOCKED_PREFIXES').not.toBeNull();
    const inMiddleware = Array.from(m![1].matchAll(/'([^']+)'/g), (x) => x[1]).sort();
    expect(inMiddleware).toEqual([...IOS_SELL_ROUTE_PREFIXES].sort());
    expect(src).toMatch(/pathname === '\/gift' \|\| pathname\.startsWith\('\/gift\/'\)/);
    expect(src).toMatch(/startsWith\('\/gift\/claim'\)/);
  });

  it('classifies routes the way the redirect does', () => {
    expect(isIosSellRoute('/pricing')).toBe(true);
    expect(isIosSellRoute('/pricing?plan=pro')).toBe(true);
    expect(isIosSellRoute('/gift')).toBe(true);
    expect(isIosSellRoute('/gift/claim/abc')).toBe(false);
    expect(isIosSellRoute('/resources')).toBe(false);
    expect(isIosSellRoute('/changelog')).toBe(false);
    expect(isIosSellRoute('/')).toBe(false);
  });
});

describe('/changelog inside the iOS app', () => {
  it('has entries that link to sell routes (positive control: there is something to gate)', () => {
    expect(CHANGELOG.filter((c) => c.link && isIosSellRoute(c.link)).length).toBeGreaterThan(0);
  });

  it('web keeps every link; iOS keeps no sell-route link but still shows the titles; Android equals web', async () => {
    const { default: ChangelogPage } = await import('../app/changelog/page');
    const html = renderToStaticMarkup(createElement(ChangelogPage));
    const sellTitles = CHANGELOG.filter((c) => c.link && isIosSellRoute(c.link)).map((c) => c.title);

    const web = webView(html);
    for (const c of CHANGELOG) if (c.link) expect(hrefs(web)).toContain(c.link);

    const ios = iosView(html);
    expect(hrefs(ios).filter(isIosSellRoute)).toEqual([]);
    for (const title of sellTitles) expect(text(ios)).toContain(title);

    expect(text(androidView(html))).toBe(text(web));
  });
});

describe('/resources/[slug] inside the iOS app', () => {
  it('the content has sell-route links and our prices to gate (positive control)', () => {
    const flat = JSON.stringify(ARTICLES);
    expect(flat).toContain('](/pricing)');
    expect(flat).toMatch(OUR_PRICES);
    expect(ARTICLES.filter((a) => a.cta && isIosSellRoute(a.cta.href)).length).toBeGreaterThanOrEqual(3);
  });

  for (const article of ARTICLES) {
    it(`${article.slug}: iOS view has no sell-route link and none of our prices; web keeps them; Android equals web`, async () => {
      const { default: ArticlePage } = await import('../app/resources/[slug]/page');
      const html = renderToStaticMarkup(
        createElement(ArticlePage, { params: { slug: article.slug } }),
      );

      const ios = iosView(html);
      expect(hrefs(ios).filter(isIosSellRoute)).toEqual([]);
      expect(text(ios)).not.toMatch(OUR_PRICES);

      const web = webView(html);
      const flat = JSON.stringify(article);
      if (flat.includes('](/pricing)') || (article.cta && isIosSellRoute(article.cta.href))) {
        expect(hrefs(web)).toContain('/pricing');
      }
      if (OUR_PRICES.test(flat)) expect(text(web)).toMatch(OUR_PRICES);

      expect(text(androidView(html))).toBe(text(web));
    });
  }
});
