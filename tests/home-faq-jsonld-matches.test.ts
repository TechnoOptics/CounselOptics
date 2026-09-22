import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FaqJsonLd } from '../components/seo/JsonLd';
import { HOME_FAQ } from '../lib/home-faq';

/** The six questions on the page and the six in the JSON-LD are the same six. */
describe('the home FAQ', () => {
  it('has six entries with no dashes', () => {
    expect(HOME_FAQ.length).toBe(6);
    for (const { q, a } of HOME_FAQ) expect(`${q} ${a}`).not.toMatch(/[\u2013\u2014]/);
  });
  it('emits exactly those questions as FAQPage markup', () => {
    const html = renderToStaticMarkup(createElement(FaqJsonLd, { questions: HOME_FAQ }));
    const json = JSON.parse(/<script[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]);
    const names = json.mainEntity.map((e: { name: string }) => e.name);
    expect(names).toEqual(HOME_FAQ.map((f) => f.q));
  });
});
