import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stripComments } from './support/strip-comments';
import { TrialBanner } from '../components/TrialBanner';

/**
 * A sentence must not outlive the control it points at.
 *
 * WHAT WENT WRONG. Four sentences told the reader to press a purchase control
 * ("Subscribe to keep using Bella", "top up below", "Top up here when the pool
 * runs low") while the control itself was hidden on iOS. The gate stopped
 * short of the sentence, so the iOS reader was pointed at a button that was
 * not on the page. Findings 11 to 14 of docs/IOS_3_1_1_REACHABILITY_SWEEP.md.
 *
 * HOW EACH VIEW IS MODELLED. globals.css hides `[data-hide-on-ios]` under
 * `.is-ios-app`, hides `[data-hide-in-app]` under `.is-native-app`, hides
 * `[data-show-in-app]` everywhere and reveals it under `.is-native-app`, and
 * hides `[data-hide-on-android]` under `.is-android-app`. Each view below
 * removes exactly the elements its rules hide from the rendered markup. It is
 * a model of the CSS, not the CSS, so the rule ORDER the Android view depends
 * on is pinned separately by reading globals.css.
 *
 * WHY ANDROID IS CHECKED AT ALL. The reveal rule for the paired iOS sentence
 * keys on `.is-native-app`, which Android carries too. Without the
 * `data-hide-on-android` attribute on that span, an Android reader would get
 * both sentences. The requirement is that Android sees exactly the web copy.
 *
 * The two server pages (firm token pool, consumer billing) read the request
 * and the database, so they are held to account by READING their source with
 * comments stripped, for one structural claim each: the sentence sits inside
 * an element carrying the same gate as the control it names.
 */

const ROOT = join(__dirname, '..');

function read(file: string): string {
  return stripComments(readFileSync(join(ROOT, file), 'utf8'));
}

/** Remove every element (span or a, non-nested) carrying the attribute. */
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

const PURCHASE = /subscribe|\/billing|upgrade|top[ -]?up|\/pricing/i;

function banner(props: Parameters<typeof TrialBanner>[0]): string {
  return renderToStaticMarkup(createElement(TrialBanner, props));
}

describe('TrialBanner: the iOS reader is never asked to press a hidden Subscribe', () => {
  const cases: Array<[string, Parameters<typeof TrialBanner>[0], string]> = [
    [
      'expired',
      { mode: 'expired', trialEndsAt: null, daysRemaining: 0, tier: 'pro' },
      'Subscribe to keep using Bella, Advottic Review, and create new cases.',
    ],
    [
      'free trial',
      { mode: 'free_trial', trialEndsAt: '2026-09-10T00:00:00Z', daysRemaining: 3, tier: null },
      'Subscribe before it ends to keep Bella, Advottic Review, and case creation.',
    ],
    [
      'Stripe trial',
      { mode: 'stripe_trialing', trialEndsAt: '2026-09-10T00:00:00Z', daysRemaining: 3, tier: 'standard' },
      'Subscribe before the trial ends to keep your access.',
    ],
  ];

  for (const [name, props, webSentence] of cases) {
    it(`${name}: web keeps its sentence and link (positive control)`, () => {
      const html = banner(props);
      expect(text(webView(html))).toContain(webSentence);
      if (props.mode === 'expired') expect(html).toMatch(/href="\/billing"/);
    });

    it(`${name}: the iOS view names no purchase, and the control-free sentence stands on its own`, () => {
      const ios = text(iosView(banner(props)));
      expect(ios).not.toMatch(PURCHASE);
      expect(ios).toMatch(/included with a subscription on your account|continues with the subscription on your account/);
    });

    it(`${name}: Android sees exactly the web copy`, () => {
      const html = banner(props);
      expect(text(androidView(html))).toBe(text(webView(html)));
    });
  }
});

describe('globals.css: the order the Android view relies on', () => {
  it('hides [data-hide-on-android] AFTER revealing [data-show-in-app], both !important, same specificity', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    const reveal = css.search(/\.is-native-app \[data-show-in-app\]\s*\{[^}]*display:\s*revert\s*!important/);
    const hide = css.search(/\.is-android-app \[data-hide-on-android\]\s*\{[^}]*display:\s*none\s*!important/);
    expect(reveal).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(reveal);
  });
});

describe('firm token pool page: "Top up here" is gated exactly like the button it names', () => {
  const page = read('app/counsel/billing/tokens/page.tsx');
  const sentence = 'Top up here when the pool runs low';

  it('the sentence is still there (positive control)', () => {
    expect(page).toContain(sentence);
  });

  it('sits inside an element carrying data-hide-in-app, the gate on TokenTopUpButton', () => {
    const at = page.indexOf(sentence);
    const open = page.lastIndexOf('<span', at);
    expect(open).toBeGreaterThan(-1);
    expect(page.slice(open, at)).toMatch(/\bdata-hide-in-app\b/);
    expect(read('app/counsel/billing/tokens/topup-button.tsx')).toMatch(/<span data-hide-in-app/);
  });

  it('the pool description before it is NOT inside that element', () => {
    const at = page.indexOf(sentence);
    const open = page.lastIndexOf('<span', at);
    expect(page.indexOf('One pool everyone on the firm draws from')).toBeLessThan(open);
  });
});

describe('consumer billing page: "top up below" is gated exactly like TopUpButtons', () => {
  const page = read('app/billing/page.tsx');
  const sentence = 'top up below at any time';

  it('the sentence is still there (positive control)', () => {
    expect(page).toContain(sentence);
  });

  it('sits inside a data-hide-on-ios span that is itself behind !isIos, the two gates on the buttons', () => {
    const at = page.indexOf(sentence);
    const open = page.lastIndexOf('<span', at);
    expect(page.slice(open, at)).toMatch(/\bdata-hide-on-ios\b/);
    const para = page.lastIndexOf('<p', open);
    expect(page.slice(para, open)).toMatch(/!isIos &&/);
    expect(page.slice(para, open)).toContain('Tokens are spent each time');
    expect(page).toMatch(/isIos && <TopUpButtons|serverPlatform !== 'ios' && <TopUpButtons/);
  });
});
