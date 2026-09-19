import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Band,
  BUTTON_INK,
  BUTTON_OUTLINE_CREAM,
  Definitions,
  Entry,
  FilePage,
  FOCUS,
  LINK,
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

describe('Band', () => {
  it("bleeds to the viewport and carries FilePage's own column inside it", () => {
    const out = html(createElement(Band, { className: 'bg-paper' }, 'x'));
    expect(out).toContain('mx-[calc(50%_-_50vw)]');
    expect(out).toContain('bg-paper');
    // Spelled exactly as FilePage's inner column, so a band's content shares
    // a left edge with the sections above and below it at every width.
    const filePage = html(createElement(FilePage, null, 'x'));
    const column = /<div class="(mx-auto max-w-\[1200px\][^"]*)">/.exec(filePage)?.[1];
    expect(column, 'FilePage no longer centres a named column').toBeTruthy();
    expect(out).toContain(column!);
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
  it('names itself with its label, so a section with no h2 is not anonymous', () => {
    // Several sections carry no heading at all (the home quotes, both pricing
    // schedules, the enterprise sectors), so without this they have no
    // accessible name and no entry in a screen reader's landmark list.
    const out = html(createElement(Section, { label: 'In their words' }, 'body'));
    const id = /<section aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(id, 'the section does not point at a name').toBeTruthy();
    expect(out).toContain(`<div id="${id}"`);
    expect(out).toContain('In their words');
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
  it('takes a dark tone, so a sheet on a dark ground is not paper-tuned ink', () => {
    // C2: `.enterprise-shell` redefines --sheet to the dark sheet AND remaps
    // --forest-900 to near-black, and there is no `.dark` ancestor in light
    // theme, so the `dark:` variant never fires. The cover's sheet rendered
    // #101012 ink on #0f2d24. The tone is an explicit choice, not a variant.
    const rows = [createElement(SheetRow, { key: 'a', mark: '1', text: 'Intake', right: 'Filed' })];
    const dark = html(createElement(Sheet, { tone: 'dark', kicker: 'Matter file', title: 'T' }, ...rows));
    expect(dark).toContain('text-cream-100');
    expect(dark).not.toContain('text-forest-900');
    expect(dark).not.toContain('text-ink-600');
    const paper = html(createElement(Sheet, { kicker: 'Matter file', title: 'T' }, ...rows));
    expect(paper).toContain('text-forest-900');
    expect(paper).toContain('dark:text-cream-100');
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
    expect(out.match(/<th\b/g)?.length).toBe(3);
    expect(out).toMatch(/<th scope="row"/);
    expect(out).toContain('tabular-nums');
  });
  it('puts exactly one stamp on the named column', () => {
    const out = html(createElement(Schedule, { columns, rows, stampOn: 'pro', stamp: { line1: 'Most', line2: 'chosen' } }));
    // The table (sm:block) and the phone list (sm:hidden) are mutually
    // exclusive by breakpoint, so a stamp in each is still only one stamp
    // a reader ever sees; a viewer must count exactly one per container.
    const table = out.match(/<div class="hidden overflow-x-auto sm:block">[\s\S]*?<\/table><\/div>/)?.[0] ?? '';
    const phone = out.match(/<div class="grid gap-4 sm:hidden">[\s\S]*$/)?.[0] ?? '';
    expect(table.match(/data-stamp/g)?.length).toBe(1);
    expect(phone.match(/data-stamp/g)?.length).toBe(1);
    expect(out).not.toMatch(/-top-\d/);
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

/**
 * C3. The site's only focus ring is scoped to `a, input, textarea, select,
 * [tabindex]` (app/globals.css), because every button used to carry `.btn`,
 * which brings its own. The redesign replaced `.btn` with raw class strings
 * and added native buttons and `<summary>` to marketing for the first time,
 * so a keyboard user had no visible focus anywhere on the four pages. The
 * treatment belongs to the shared roles so no page can forget it.
 */
describe('keyboard focus', () => {
  it('is carried by every exported control role', () => {
    for (const [name, cls] of Object.entries({ BUTTON_INK, BUTTON_OUTLINE_CREAM, LINK, FOCUS })) {
      expect(cls, `${name} has no focus-visible treatment`).toContain('focus-visible:');
    }
  });
  it("is carried by Schedule's own outline CTA, which is not one of the roles", () => {
    const out = html(
      createElement(Schedule, {
        columns: [
          { id: 'free', name: 'Free', price: '$0', cadence: 'forever', cta: { label: 'Sign up free', href: '/sign-in' } },
        ],
        rows: [],
      }),
    );
    const anchors = out.match(/<a[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a).toContain('focus-visible:');
  });
});
