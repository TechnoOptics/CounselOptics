import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Definitions,
  Entry,
  FilePage,
  Memo,
  Schedule,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '../components/marketing/file';

/**
 * The primitives every marketing page is built from. Rendered for real
 * with react-dom/server, so a class that is spelled wrong or a role that
 * is missing shows up here and not on the page.
 */
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('FilePage', () => {
  it('paints the paper ground full-bleed and centres a 1200px column', () => {
    const out = html(createElement(FilePage, null, 'x'));
    expect(out).toContain('bg-paper');
    expect(out).toContain('-mx-4');
    expect(out).toContain('max-w-[1200px]');
    expect(out).toContain('font-public');
  });
});

describe('Section', () => {
  it('renders the tab letter in Caslon and the label in Courier', () => {
    const out = html(createElement(Section, { tab: 'A', label: 'What goes in' }, 'body'));
    expect(out).toMatch(/<span[^>]*font-caslon[^>]*>A<\/span>/);
    expect(out).toMatch(/font-courier[^>]*>[\s\S]*What goes in/);
    expect(out).toContain('border-t');
  });
  it('drops the top rule on the first block', () => {
    const out = html(createElement(Section, { label: 'Cover', first: true }, 'body'));
    expect(out).not.toContain('border-t');
  });
  it('gives the body column min-w-0 so a long headline cannot widen the page', () => {
    const out = html(createElement(Section, { label: 'x' }, 'body'));
    expect(out).toMatch(/<div class="min-w-0[^"]*">body<\/div>/);
  });
});

describe('Sheet', () => {
  it('is a sheet with rule border, one shadow, and Courier inside', () => {
    const out = html(createElement(Sheet, { title: 'Ramirez v. Oakline Rentals' }, 'x'));
    expect(out).toContain('bg-sheet');
    expect(out).toContain('border-rule');
    expect(out).toContain('shadow-[0_30px_50px_-30px_rgba(16,40,31,0.35)]');
    expect(out).toContain('font-courier');
    expect(out).toMatch(/font-caslon-text[^>]*>Ramirez v\. Oakline Rentals/);
  });
  it('marks rows for the assemble animation only when asked', () => {
    const rows = [
      createElement(SheetRow, { key: 'a', mark: 'A', text: 'Lease.pdf', right: 'Jan 3, 2024' }),
      createElement(SheetRow, { key: 'b', mark: 'B', text: 'Photos.jpg', right: 'Mar 30, 2025' }),
    ];
    const still = html(createElement(Sheet, null, ...rows));
    expect(still).not.toContain('file-assemble');
    expect(still.match(/data-row/g)?.length).toBe(2);
    const moving = html(createElement(Sheet, { assemble: true }, ...rows));
    expect(moving).toContain('file-assemble');
  });
  it('the stamp is the only gold: accent border, accent-text ink, rotated, data-stamp', () => {
    const out = html(createElement(Stamp, { line1: 'Hearing', line2: 'Apr 18' }));
    expect(out).toContain('data-stamp');
    expect(out).toContain('border-accent');
    expect(out).toContain('text-accent-text');
    expect(out).toContain('rotate-[-6deg]');
    expect(out).not.toMatch(/bg-gold|text-gold|gold-metal/);
  });
});

describe('Definitions', () => {
  it('is a dl of Courier terms over Public Sans definitions', () => {
    const out = html(
      createElement(Definitions, {
        items: [
          { term: 'Lettered', def: 'A to Z' },
          { term: 'Dated', def: 'From the file' },
          { term: 'Kept', def: 'One room' },
        ],
      }),
    );
    expect(out.match(/<dt/g)?.length).toBe(3);
    expect(out.match(/<dd/g)?.length).toBe(3);
    expect(out).toMatch(/<dt class="[^"]*font-courier/);
    expect(out).toContain('sm:grid-cols-3');
  });
});

describe('Schedule', () => {
  const columns = [
    { id: 'free', name: 'Free', price: '$0', cadence: 'forever', cta: { label: 'Sign up free', href: '/sign-in' } },
    { id: 'pro', name: 'Pro', price: '$59', cadence: '/ month', cta: { label: 'Start trial', href: '/billing' }, emphasized: true },
  ];
  const rows = [{ label: 'Cases', cells: ['1', '15'] }];
  it('renders a ruled table that scrolls inside its own container', () => {
    const out = html(createElement(Schedule, { columns, rows, stampOn: 'pro', stamp: { line1: 'Most', line2: 'chosen' } }));
    expect(out).toContain('overflow-x-auto');
    expect(out).toMatch(/<table/);
    expect(out.match(/<th/g)?.length).toBe(3);
    expect(out).toContain('tabular-nums');
  });
  it('puts exactly one stamp on the named column', () => {
    const out = html(createElement(Schedule, { columns, rows, stampOn: 'pro', stamp: { line1: 'Most', line2: 'chosen' } }));
    expect(out.match(/data-stamp/g)?.length).toBe(1);
  });
  it('carries hideOnIos through to the link as data-hide-on-ios', () => {
    // next/link (v14) always appends its own `href` last when merging props,
    // so the attribute order inside the rendered <a> is not under this
    // component's control; assert presence on the right tag, not order,
    // matching how tests/dangling-purchase-sentences.test.ts already checks
    // this attribute elsewhere in the codebase.
    const gated = [{ ...columns[0], cta: { label: 'Send a gift', href: '/gift', hideOnIos: true } }];
    const out = html(createElement(Schedule, { columns: gated, rows: [] }));
    const anchor = out.match(/<a[^>]*href="\/gift"[^>]*>/)?.[0];
    expect(anchor).toBeDefined();
    expect(anchor).toMatch(/\bdata-hide-on-ios\b/);
  });
});

describe('Memo', () => {
  it('is a Courier label over a plain sentence', () => {
    const out = html(createElement(Memo, { label: 'Possible issue', text: 'Deductions may exceed limits.' }));
    expect(out).toMatch(/font-courier[^>]*>Possible issue<\/p>/);
    expect(out).toMatch(/font-public[^>]*>Deductions may exceed limits\.<\/p>/);
  });
});

describe('Entry', () => {
  it('is a Section with an h2, a paragraph and optional definitions', () => {
    const out = html(createElement(Entry, { tab: 'A', label: 'Exhibits', title: 'Lettered.', body: 'Body.', defs: [{ term: 'Dated', def: 'From the file' }] }));
    expect(out).toMatch(/<h2 class="[^"]*font-caslon[^"]*">Lettered\.<\/h2>/);
    expect(out).toContain('Body.');
    expect(out.match(/<dt/g)?.length).toBe(1);
    expect(out).not.toContain('lg:grid-cols-2');
  });
  it('lays the sheet beside the copy only when one is given', () => {
    const out = html(createElement(Entry, { label: 'x', title: 't', body: 'b', sheet: createElement('div', null, 'SHEET') }));
    expect(out).toContain('lg:grid-cols-2');
    expect(out).toContain('SHEET');
  });
});
