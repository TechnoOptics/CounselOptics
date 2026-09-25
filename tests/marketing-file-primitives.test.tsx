import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fixtureManifest from './fixtures/screens-manifest.json';
import {
  Band,
  Definitions,
  Entry,
  FilePage,
  FOCUS,
  Memo,
  Prose,
  Schedule,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '../components/marketing/file';
// Screen is imported from its own module, not the barrel above: see the
// comment in components/marketing/file/index.ts for why (it reads
// node:fs/node:path, and the barrel is also imported by client components
// for their string roles alone).
import { Screen } from '../components/marketing/file/Screen';
// The type roles are imported as a namespace, not by name: the focus guard
// below holds every control role the module exports, including ones added
// after this test was written.
import * as roles from '../components/marketing/file/type';

/**
 * Screen (Task 4 of the screen-grabs plan) reads two things off disk at
 * build time: the manifest JSON (`readFileSync(path, 'utf8')`) and the PNG
 * bytes for the matched entry (`readFileSync(path)`, no encoding, so it
 * comes back a Buffer). `public/screens/manifest.json` does not exist yet -
 * Tasks 1 to 3, which would seed and capture it, are blocked on a schema
 * finding - so this test never touches the real manifest. It supplies its
 * own fixture instead (`tests/fixtures/screens-manifest.json` and
 * `tests/fixtures/case-file.png`, a real 4x3 PNG) through a `node:fs` module
 * mock keyed on that same encoding argument, which is the least intrusive
 * of the options the brief allows: Screen's own props (`id`, `caption`) are
 * exactly what tasks 5 and 6 call, untouched by any test-only prop or path
 * argument, and no env var is left in the production code for a stray
 * setting to mis-point in production.
 */
const FIXTURE_IMAGE_PATH = path.join(__dirname, 'fixtures', 'case-file.png');

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (target: Parameters<typeof actual.readFileSync>[0], encoding?: BufferEncoding) => {
      if (encoding === 'utf8') return JSON.stringify(fixtureManifest);
      return actual.readFileSync(FIXTURE_IMAGE_PATH);
    },
  };
});

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
  it('carries its own ground in dark theme, so a band is still a band', () => {
    // N6. In light a band is an inversion: forest on cream paper. In dark the
    // page ground is already that forest, so both bands sampled exactly the
    // page colour and stopped reading as bands at all. The lift belongs to
    // Band rather than to its two call sites, which pass different classes
    // (bg-forest-950 on home, bg-paper inside the enterprise shell) for the
    // same light-theme colour.
    const out = html(createElement(Band, { className: 'bg-forest-950' }, 'x'));
    expect(out).toContain('dark:bg-band');
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
  it('keeps the binder-tab glyph out of the accessible name', () => {
    // N10. The id sits on the div that wraps both the Caslon tab letter and
    // the Courier label, so without this the region announces as "A What
    // goes in". A letter or a numeral is a binder tab: decoration for the
    // eye and noise in the landmark list.
    for (const glyph of ['A', 'E', 'I', 'II']) {
      const out = html(createElement(Section, { tab: glyph, label: 'What goes in' }, 'body'));
      expect(out, `${glyph} should be hidden`).toMatch(
        new RegExp(`<span aria-hidden="true"[^>]*font-caslon[^>]*>${glyph}</span>`),
      );
    }
  });
  it('keeps a tab that is a word in the accessible name', () => {
    // N3-1. Hiding the tab unconditionally cost the five enterprise regions
    // their subject: they pass the word as `tab` and the ordinal as `label`
    // (app/enterprise/page.tsx), so "Intake Step 1 of 5" announced as
    // "Step 1 of 5". A word is the section's name, not a binder glyph.
    for (const word of ['Intake', 'Packet', 'With legal']) {
      const out = html(createElement(Section, { tab: word, label: 'Step 1 of 5' }, 'body'));
      expect(out, `${word} should be announced`).not.toMatch(/aria-hidden/);
      expect(out).toContain(`>${word}</span>`);
    }
  });
  it('leaves an unlabelled section plain, rather than a nameless region', () => {
    // Prose renders its body block as <Section label="">; a <section> with
    // aria-labelledby pointing at empty text is a region with no name.
    const out = html(createElement(Section, { label: '' }, 'body'));
    expect(out).not.toContain('aria-labelledby');
  });
  it('gives the body column min-w-0 so a long headline cannot widen the page', () => {
    const out = html(createElement(Section, { label: 'x' }, 'body'));
    expect(out).toMatch(/<div class="min-w-0[^"]*">body<\/div>/);
  });
});

describe('Prose', () => {
  /**
   * The body block's class list, with the entities React writes back out.
   * A Tailwind arbitrary variant is full of `&` and `>`, and both are
   * escaped in the rendered attribute, so a regex written the way the class
   * is spelled in the source matches nothing and the assertion reads as a
   * missing feature rather than as a missing unescape.
   */
  const proseBody = () => {
    const out = html(createElement(Prose, { label: 'About', title: 'x', children: 'body' }));
    const raw = /class="(max-w-\[72ch\][^"]*)"/.exec(out)?.[1] ?? '';
    return raw.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  };

  it('gives a heading more air above it than below it', () => {
    // N3-2. The body styles set the h2's face and size and no margin at all,
    // and the pages Prose wraps set none of their own, so a heading had 32px
    // above it (leading, at 1440) where two paragraphs of the same page had
    // 46px between them: the heading read as the tail of the block above it
    // rather than the head of the block below. Rendered rather than read off
    // the source, so the comment explaining the rule cannot satisfy it.
    const body = proseBody();
    expect(body, 'the Prose body block is gone').toBeTruthy();
    const top = /\[&_h2\]:mt-(\d+)/.exec(body)?.[1];
    expect(top, 'an h2 in Prose has no top margin').toBeTruthy();
    const bottom = /\[&_h2\]:mb-(\d+)/.exec(body)?.[1] ?? '0';
    expect(Number(top)).toBeGreaterThan(Number(bottom));
  });
  it('gives the kicker the block air and keeps it tight on the heading it names', () => {
    // N4-1. `[&_h2]:mt-12` is a blanket descendant rule, so on the four
    // pages whose h2 is introduced by its own kicker it put the 48px
    // BETWEEN the kicker and the heading: the caption was stranded against
    // the block above and read as that block's footer, which is a false
    // label rather than only loose spacing. The air moves to the kicker,
    // the heading it names sits tight beneath it, and the two list pages,
    // whose items carry their own `space-y`, take the rule back out.
    // `:has(+h2)` and not a bare `.eyebrow` because one kicker on /about
    // opens a card and would collect 48px of dead space inside it.
    const body = proseBody();
    expect(body).toContain('[&_.eyebrow:has(+h2)]:mt-12');
    expect(body).toContain('[&_.eyebrow+h2]:mt-0');
    expect(body).toContain('[&_li_h2]:mt-0');
  });
  it('keeps the first block tight to the headline above it', () => {
    // The same margin on a page that opens on a heading, or on a wrapper
    // whose own first child is one, would push the body away from the h1
    // Section; margin collapsing carries it out through the wrapper.
    const body = proseBody();
    expect(body).toContain('[&>*:first-child]:mt-0');
    expect(body).toContain('[&>*:first-child>h2:first-child]:mt-0');
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

describe('Screen', () => {
  it('renders alt text from the manifest and never the word screenshot', () => {
    const out = html(createElement(Screen, { id: 'case-file', caption: 'The case file' }));
    const img = /<img[^>]*>/.exec(out)?.[0];
    expect(img, 'no img rendered').toBeTruthy();
    const alt = /alt="([^"]*)"/.exec(img!)?.[1];
    expect(alt).toBeTruthy();
    expect(alt?.toLowerCase()).not.toContain('screenshot');
    expect(/width="(\d+)"/.exec(img!)?.[1]).toBeTruthy();
    expect(/height="(\d+)"/.exec(img!)?.[1]).toBeTruthy();
  });
  it('reads the intrinsic width and height off the real PNG, not a guess', () => {
    // The fixture is a genuine 4x3 PNG; these are its actual IHDR values,
    // not numbers invented for this test.
    const out = html(createElement(Screen, { id: 'case-file', caption: 'The case file' }));
    expect(out).toMatch(/<img[^>]*width="4"/);
    expect(out).toMatch(/<img[^>]*height="3"/);
  });
  it('throws at build time when the id is absent from the manifest, rather than rendering a hole', () => {
    expect(() => html(createElement(Screen, { id: 'not-a-real-id', caption: 'x' }))).toThrow(
      /not-a-real-id/,
    );
  });
  it('sits in a Sheet, puts the caption in Courier, and adds no gold', () => {
    const out = html(createElement(Screen, { id: 'case-file', caption: 'The case file' }));
    expect(out).toContain('bg-sheet');
    expect(out).toMatch(/font-courier[^>]*>The case file/);
    expect(out).not.toMatch(/bg-gold|text-gold|gold-metal|data-stamp/);
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
    // N3: this used to name four constants by hand, which left LINK_CREAM
    // (focused through LINK_SHAPE, by luck rather than by rule) unheld and
    // would leave any role added tomorrow unheld too. Controls are the
    // BUTTON_* and LINK_* roles; the type roles (H1, BODY, LABEL) are ink,
    // not controls, and carry no ring.
    const controls = Object.entries(roles).filter(([name]) => /^(?:BUTTON|LINK)/.test(name));
    expect(controls.map(([name]) => name).sort()).toEqual([
      'BUTTON_INK',
      'BUTTON_OUTLINE_CREAM',
      'LINK',
      'LINK_CREAM',
    ]);
    for (const [name, cls] of controls) {
      expect(cls, `${name} has no focus-visible treatment`).toContain('focus-visible:');
    }
    expect(FOCUS, 'the shared ring itself').toContain('focus-visible:');
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
