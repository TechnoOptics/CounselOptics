# Marketing Case File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public marketing site (home, pricing, features, enterprise, shared header and footer, inheriting pages) as "the case file" per `docs/superpowers/specs/2026-09-05-marketing-case-file-design.md`, without touching the signed-in app, counsel, portal or HQ.

**Architecture:** Four new font roles and three new colour tokens are added once in the root layout, Tailwind config and globals. Five primitives under `components/marketing/file/` (FilePage, Section, Sheet with Stamp, Definitions, Schedule) carry the whole visual language; every marketing page is then rewritten as a composition of those primitives with the existing copy. Source-reading guards, mutation-proven, hold the type roles, the one-gold-per-page rule, the FAQ array and the single motion.

**Tech Stack:** Next.js app router (server components), Tailwind, `next/font/google`, vitest with `react-dom/server` `renderToStaticMarkup` for component tests and `tests/support/strip-comments.ts` for source guards, puppeteer-core plus the system Chrome for the render audit.

## Global Constraints

- No em dashes, no en dashes, no emoji anywhere: code, copy, comments, commits, docs. Sweep with a positive control before every commit.
- Copy is calm and plain; controls say what happens ("Start your case file", never "Submit").
- Gold is spent once per screen: exactly one `Stamp` per page, no other `bg-gold-*`, `text-gold-*`, `bg-gold-metal`, `gold-shine`, `gold-pan` on a marketing page. Buttons are ink on paper or cream on forest.
- No raw hex in components. New tokens: `paper`, `sheet`, `rule`. Ink is `text-forest-900 dark:text-cream-100`; quiet ink is `text-ink-600 dark:text-cream-100/60`.
- Four faces only on marketing pages: `font-caslon` (h1, h2), `font-caslon-text` (quotes, sheet titles), `font-public` (body), `font-courier` (labels, dates, letters). `font-display` (Fraunces) and Inter classes never appear under `app/page.tsx`, `app/pricing`, `app/features`, `app/enterprise`, `components/marketing/file/`.
- No `rounded-2xl`/`rounded-3xl` cards, no `BrowserFrame`, no `SectionPhoto`, no `TestimonialMarquee`, no photographs on the four pages.
- One motion: the home cover's sheet assembles on load; no `animate-fade-up`, `stagger`, `cv-auto` reveal on marketing pages; `prefers-reduced-motion: reduce` removes the assemble animation entirely.
- Dark theme is designed: tokens redefined once under `html.dark, .dark` (the existing block) and nowhere else.
- iOS gating stays: `data-hide-on-ios` on the gift link, the pricing page's `serverPlatform === 'ios'` branch, `data-hide-in-app` on the footer store row, `GetTheApp` unchanged. Guards `marketing-routes-in-the-app`, `dangling-purchase-sentences`, `plain-limit-copy`, `no-storekit-in-the-binary` must pass without edits to their assertions.
- The `enterprise-shell` class stays on the enterprise page's cover element (asserted by `tests/consumer-live-defects.test.ts`).
- `tests/consumer-live-defects.test.ts` reads the marker comment `Left: editorial copy block` in `app/page.tsx` and requires that grid child to carry `min-w-0` and `lg:col-span-7`: keep both in the new cover.
- The page body never scrolls sideways; the pricing table scrolls in its own `overflow-x-auto` container below `lg`.
- Touch targets 44px (`min-h-[44px]`) on every link styled as a button.
- Work in the isolated worktree on branch `design/marketing-case-file`. Never `git add .superpowers/`. Verify every commit with `git show --stat`.
- Four gates with true exit codes before every commit that touches `app/` or `components/`: `npx tsc --noEmit > /tmp/t.log 2>&1; echo TSC_EXIT=$?`, `npx vitest run > /tmp/v.log 2>&1; echo VITEST_EXIT=$?` (read with `grep -a`), `npm run build > /tmp/b.log 2>&1; echo BUILD_EXIT=$?`, `npm run test:audit-guards > /tmp/g.log 2>&1; echo GUARDS_EXIT=$?`.
- Every guard added is mutated (break the code, watch it fail, restore, `git diff --stat` empty) before its commit.

---

## File structure

| path | responsibility |
| --- | --- |
| `app/layout.tsx` | loads the four new faces and exposes their CSS variables on `<html>`; signed-out header nav; footer |
| `tailwind.config.ts` | `fontFamily.caslon`, `caslon-text`, `public`, `courier`; `colors.paper`, `sheet`, `rule` |
| `app/globals.css` | `--paper`, `--sheet`, `--rule` in both theme blocks; the `file-assemble` keyframes and their reduced-motion removal |
| `components/marketing/file/type.ts` | the class strings for h1, h2, body, label, buttons, so every page spells them once |
| `components/marketing/file/FilePage.tsx` | full-bleed paper ground plus the 1200px container |
| `components/marketing/file/Section.tsx` | the ruled block with the tab column |
| `components/marketing/file/Sheet.tsx` | `Sheet`, `SheetRow`, `Stamp` |
| `components/marketing/file/Definitions.tsx` | the `dl` that replaces check-bullet lists |
| `components/marketing/file/Schedule.tsx` | the ruled comparison table for pricing, with its phone form |
| `components/marketing/file/index.ts` | re-exports |
| `app/page.tsx` | home, rewritten; `HOME_FAQ` array feeds both the list and `FaqJsonLd` |
| `app/pricing/page.tsx` | schedule of fees; tier data unchanged |
| `app/features/page.tsx` | the full index; owns the two audience lists |
| `components/marketing/FeatureIndex.tsx` | client toggle between the people and firm indexes |
| `app/enterprise/page.tsx` | the firm's front door; keeps `EnterpriseSectorTabs`, `EnterpriseInquiryForm`, `LegalReviewMock` |
| `components/EnterpriseSectorTabs.tsx` | restyled buttons and definitions, same state |
| `components/marketing/file/Prose.tsx` | wrapper for inheriting pages |
| `tests/marketing-file-tokens.test.ts` | Task 1 guard |
| `tests/marketing-file-primitives.test.tsx` | Task 2 component tests |
| `tests/cover-accent-discipline.test.ts` | replaces `tests/hero-accent-discipline.test.ts` |
| `tests/marketing-type-roles.test.ts`, `tests/marketing-no-cards.test.ts`, `tests/home-faq-jsonld-matches.test.ts`, `tests/cover-motion-is-one-and-reducible.test.ts`, `tests/marketing-no-dashes.test.ts` | Task 9 guards |
| `scripts/design/render-marketing.cjs` | render audit at two widths and two themes |
| `docs/DESIGN.md`, `docs/DESIGN_SYSTEM.md` | type section amended; pointer added |

---

### Task 1: Fonts and tokens

**Files:**
- Modify: `app/layout.tsx:6` (font import line) and `app/layout.tsx:66-92` (font constants) and `app/layout.tsx:525` (`<html className=...>`)
- Modify: `tailwind.config.ts:17-27` (fontFamily) and `tailwind.config.ts:39` (colors, top of the block)
- Modify: `app/globals.css:453-483` (the two token blocks) and append after the reduced-motion block at `app/globals.css:2386`
- Test: `tests/marketing-file-tokens.test.ts`

**Interfaces:**
- Produces: CSS variables `--font-caslon`, `--font-caslon-text`, `--font-public`, `--font-courier` on `<html>`; Tailwind families `font-caslon`, `font-caslon-text`, `font-public`, `font-courier`; colours `bg-paper`, `bg-sheet`, `border-rule`, `text-...` for `paper`, `sheet`, `rule`; CSS classes `file-assemble` (parent), `[data-row]` and `[data-stamp]` children.

- [ ] **Step 1: Write the failing test**

```ts
// tests/marketing-file-tokens.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The case-file type roles and paper tokens exist once, at the root.
 *
 * Reads comment-stripped source so a comment naming a font cannot satisfy
 * it, and asserts the CALL (next/font constructor) and the CLASS placement,
 * not a name in prose.
 */
const ROOT = join(__dirname, '..');
const src = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

describe('the four marketing faces', () => {
  const layout = src('app/layout.tsx');
  it('are constructed through next/font/google with their CSS variables', () => {
    expect(layout).toMatch(/Libre_Caslon_Display\(\{[\s\S]*?variable: '--font-caslon'/);
    expect(layout).toMatch(/Libre_Caslon_Text\(\{[\s\S]*?style: \['normal', 'italic'\][\s\S]*?variable: '--font-caslon-text'/);
    expect(layout).toMatch(/Public_Sans\(\{[\s\S]*?variable: '--font-public'/);
    expect(layout).toMatch(/Courier_Prime\(\{[\s\S]*?variable: '--font-courier'/);
  });
  it('put their variables on <html> next to the existing ones', () => {
    const html = /<html[\s\S]*?className=\{`([^`]*)`\}/.exec(layout);
    expect(html, '<html className={`...`}> not found').not.toBeNull();
    for (const v of ['caslon.variable', 'caslonText.variable', 'publicSans.variable', 'courier.variable']) {
      expect(html![1]).toContain(`\${${v}}`);
    }
  });
  it('are Tailwind families', () => {
    const tw = src('tailwind.config.ts');
    expect(tw).toMatch(/caslon: \['var\(--font-caslon\)'/);
    expect(tw).toMatch(/'caslon-text': \['var\(--font-caslon-text\)'/);
    expect(tw).toMatch(/public: \['var\(--font-public\)'/);
    expect(tw).toMatch(/courier: \['var\(--font-courier\)'/);
  });
});

describe('paper, sheet and rule', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
  const tw = src('tailwind.config.ts');
  it('are Tailwind colours backed by variables', () => {
    expect(tw).toMatch(/paper: 'var\(--paper\)'/);
    expect(tw).toMatch(/sheet: 'var\(--sheet\)'/);
    expect(tw).toMatch(/rule: 'var\(--rule\)'/);
  });
  it('are defined in the light block and redefined in the dark block', () => {
    const light = /:root \{([\s\S]*?)\}/.exec(css)![1];
    const dark = /html\.dark,\s*\.dark,\s*\.enterprise-shell,\s*\.hq-shell \{([\s\S]*?)\}/.exec(css)![1];
    for (const block of [light, dark]) {
      expect(block).toMatch(/--paper:/);
      expect(block).toMatch(/--sheet:/);
      expect(block).toMatch(/--rule:/);
    }
    expect(/--paper:\s*([^;]+)/.exec(light)![1]).not.toBe(/--paper:\s*([^;]+)/.exec(dark)![1]);
  });
  it('ship the single assemble animation and remove it under reduced motion', () => {
    expect(css).toMatch(/@keyframes file-row/);
    expect(css).toMatch(/@keyframes file-stamp/);
    expect(css).toMatch(/\.file-assemble > \[data-row\] \{[\s\S]*?animation: file-row/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.file-assemble > \[data-row\],\s*\.file-assemble \[data-stamp\] \{\s*animation: none;/;
    expect(css).toMatch(reduced);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/marketing-file-tokens.test.ts > /tmp/t1.log 2>&1; echo EXIT=$?; grep -a -E 'Tests |FAIL' /tmp/t1.log`
Expected: EXIT=1, every `it` red (fonts not constructed, families missing, tokens missing).

- [ ] **Step 3: Load the faces in the root layout**

In `app/layout.tsx` replace line 6:

```ts
import {
  Inter,
  Saira_Condensed,
  Fraunces,
  Libre_Caslon_Display,
  Libre_Caslon_Text,
  Public_Sans,
  Courier_Prime,
} from 'next/font/google';
```

After the `display` constant (after line 92, the closing `});` of `Fraunces(...)`) add:

```ts
// The case-file faces for the public marketing site. See
// docs/superpowers/specs/2026-09-05-marketing-case-file-design.md section 2.1.
// Inter and Fraunces above stay for the signed-in shells.
const caslon = Libre_Caslon_Display({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-caslon',
});
const caslonText = Libre_Caslon_Text({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-caslon-text',
});
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '800'],
  display: 'swap',
  variable: '--font-public',
});
const courier = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
  variable: '--font-courier',
});
```

Change the `<html className=...>` template at line 525 to:

```tsx
className={`${sans.variable} ${wordmark.variable} ${display.variable} ${caslon.variable} ${caslonText.variable} ${publicSans.variable} ${courier.variable} ${nativeClass} ${surfaceClass ?? ''}`.trim()}
```

- [ ] **Step 4: Register the families and colours in Tailwind**

In `tailwind.config.ts`, inside `fontFamily` after the `display` entry (line 27) add:

```ts
        caslon: ['var(--font-caslon)', 'Georgia', 'serif'],
        'caslon-text': ['var(--font-caslon-text)', 'Georgia', 'serif'],
        public: ['var(--font-public)', 'system-ui', 'sans-serif'],
        courier: ['var(--font-courier)', 'Courier New', 'monospace'],
```

Inside `colors` as the first entries of the block (line 39, right after `colors: {`) add:

```ts
        // The case file (marketing). Paper is the ground, a sheet is a
        // piece of the file, rule is the only border colour there.
        paper: 'var(--paper)',
        sheet: 'var(--sheet)',
        rule: 'var(--rule)',
```

- [ ] **Step 5: Define the tokens and the animation in globals**

In `app/globals.css`, in the `:root {` block (line 453) add after `--muted: #5d5d68;`:

```css
  --paper: #fefcf3;
  --sheet: #fffdf8;
  --rule: #d9d0bb;
```

In the `html.dark, .dark, .enterprise-shell, .hq-shell {` block (line 472) add after `--muted: #9c9ca6;`:

```css
  --paper: #0a1f19;
  --sheet: #0f2d24;
  --rule: rgba(245, 237, 214, 0.2);
```

Append at the end of the file:

```css
/* The one motion on the marketing site: the cover's case file assembles.
   Rows arrive one after another, the stamp lands last. Nothing else on
   those pages animates. Reduced motion means none, not less. */
@keyframes file-row {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@keyframes file-stamp {
  from { opacity: 0; transform: rotate(-6deg) scale(1.15); }
  to { opacity: 1; transform: rotate(-6deg) scale(1); }
}
.file-assemble > [data-row] {
  animation: file-row 360ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.file-assemble > [data-row]:nth-child(2) { animation-delay: 120ms; }
.file-assemble > [data-row]:nth-child(3) { animation-delay: 240ms; }
.file-assemble > [data-row]:nth-child(4) { animation-delay: 360ms; }
.file-assemble > [data-row]:nth-child(5) { animation-delay: 480ms; }
.file-assemble [data-stamp] {
  animation: file-stamp 400ms cubic-bezier(0.22, 0.61, 0.36, 1) 640ms both;
}
@media (prefers-reduced-motion: reduce) {
  .file-assemble > [data-row],
  .file-assemble [data-stamp] {
    animation: none;
  }
}
```

- [ ] **Step 6: Run the test and the type check**

Run: `npx vitest run tests/marketing-file-tokens.test.ts > /tmp/t1.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t1.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: EXIT=0, TSC_EXIT=0.

- [ ] **Step 7: Mutate to prove the guard**

Change `variable: '--font-caslon'` to `variable: '--font-caslonx'` in `app/layout.tsx`, run the test, expect the first `it` red. Restore. Delete the `--paper` line from the dark block, run, expect the "redefined" `it` red. Restore. `git diff --stat` shows only the intended files.

- [ ] **Step 8: Dash sweep and commit**

Run: `python3 -c "import re,sys;p=re.compile('[\u2013\u2014]|[\U0001F300-\U0001FAFF]');print('control',len(p.findall('a \u2014 b')));[print(f,len(p.findall(open(f,encoding='utf8').read()))) for f in sys.argv[1:]]" app/layout.tsx tailwind.config.ts app/globals.css tests/marketing-file-tokens.test.ts`
Expected: `control 1`, every file 0. (globals.css has pre-existing comments; if it reports hits, they are pre-existing and are NOT to be edited in this task; note the count in the commit body.)

```bash
git add app/layout.tsx tailwind.config.ts app/globals.css tests/marketing-file-tokens.test.ts
git commit -m "Load the case-file faces and the paper tokens at the root

Libre Caslon Display, Libre Caslon Text, Public Sans and Courier Prime
join Inter and Fraunces on <html>; paper, sheet and rule are tokens in
both theme blocks; the cover's assemble animation is defined once and
removed under reduced motion. Guarded by tests/marketing-file-tokens.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 2: The five primitives

**Files:**
- Create: `components/marketing/file/type.ts`
- Create: `components/marketing/file/FilePage.tsx`
- Create: `components/marketing/file/Section.tsx`
- Create: `components/marketing/file/Sheet.tsx`
- Create: `components/marketing/file/Definitions.tsx`
- Create: `components/marketing/file/Schedule.tsx`
- Create: `components/marketing/file/index.ts`
- Test: `tests/marketing-file-primitives.test.tsx`

**Interfaces:**
- Consumes: Tailwind families and colours from Task 1.
- Produces (all named exports from `components/marketing/file`):
  - `H1`, `H2`, `BODY`, `LABEL`, `BUTTON_INK`, `BUTTON_OUTLINE_CREAM`, `LINK`: `string` class lists.
  - `FilePage({ children, className? })`.
  - `Section({ tab?: string, label: string, first?: boolean, id?: string, children })`.
  - `Sheet({ kicker?: string, kickerRight?: string, title?: string, assemble?: boolean, className?, children })`, `SheetRow({ mark: string, text: ReactNode, right?: ReactNode })`, `Stamp({ line1: string, line2: string })`.
  - `Definitions({ items: { term: string; def: ReactNode }[], columns?: 2 | 3 | 4 })`.
  - `Schedule({ columns: ScheduleColumn[], rows: ScheduleRow[], stampOn?: string, stamp?: { line1: string; line2: string } })` with `type ScheduleColumn = { id: string; name: string; price: string; cadence: string; cta: { label: string; href: string; hideOnIos?: boolean }; emphasized?: boolean }` and `type ScheduleRow = { label: string; cells: string[] }`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/marketing-file-primitives.test.tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Definitions,
  FilePage,
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
    const gated = [{ ...columns[0], cta: { label: 'Send a gift', href: '/gift', hideOnIos: true } }];
    const out = html(createElement(Schedule, { columns: gated, rows: [] }));
    expect(out).toMatch(/<a[^>]*href="\/gift"[^>]*data-hide-on-ios/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/marketing-file-primitives.test.tsx > /tmp/t2.log 2>&1; echo EXIT=$?; grep -a -E 'Error|Cannot find|Tests ' /tmp/t2.log | head`
Expected: EXIT=1, "Cannot find module '../components/marketing/file'".

- [ ] **Step 3: Write the class strings**

```ts
// components/marketing/file/type.ts
/**
 * The case-file type roles, spelled once. Every marketing page imports
 * these rather than composing its own headline classes, so a page cannot
 * drift back to an italic gold phrase or a display face for a sentence.
 * See docs/superpowers/specs/2026-09-05-marketing-case-file-design.md 2.1.
 */
export const H1 =
  'font-caslon font-normal text-[clamp(40px,6vw,72px)] leading-[1.02] tracking-[-0.012em] text-balance text-forest-900 dark:text-cream-100';

export const H2 =
  'font-caslon font-normal text-[28px] sm:text-[34px] lg:text-[40px] leading-[1.1] tracking-[-0.01em] text-balance text-forest-900 dark:text-cream-100';

export const BODY =
  'font-public text-[17px] leading-[1.55] text-ink-700 dark:text-cream-100/80 max-w-[62ch]';

export const LABEL =
  'font-courier text-[12.5px] uppercase tracking-[0.08em] text-ink-600 dark:text-cream-100/60';

export const BUTTON_INK =
  'inline-flex items-center gap-2 min-h-[44px] rounded-[3px] bg-forest-900 px-5 py-3 font-public text-[15px] font-semibold text-cream-50 no-underline hover:bg-forest-800 dark:bg-cream-100 dark:text-forest-950 dark:hover:bg-cream-50';

export const BUTTON_OUTLINE_CREAM =
  'inline-flex items-center gap-2 min-h-[44px] rounded-[3px] border border-cream-100/70 px-5 py-3 font-public text-[15px] font-semibold text-cream-100 no-underline hover:bg-cream-100/10';

export const LINK =
  'font-public text-[15px] font-semibold text-forest-900 underline underline-offset-4 decoration-rule hover:decoration-forest-900 dark:text-cream-100 dark:hover:decoration-cream-100';
```

- [ ] **Step 4: Write FilePage and Section**

```tsx
// components/marketing/file/FilePage.tsx
import type { ReactNode } from 'react';

/**
 * The paper ground. The root layout wraps every consumer route in
 * `px-4 sm:px-6 lg:px-10 py-6 sm:py-10`; the negative margins here pull the
 * paper out to the viewport edge and the inner column brings the content
 * back to 1200px, left aligned.
 */
export function FilePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`-mx-4 sm:-mx-6 lg:-mx-10 -my-6 sm:-my-10 bg-paper font-public text-forest-900 dark:text-cream-100 ${className}`.trim()}
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">{children}</div>
    </div>
  );
}
```

```tsx
// components/marketing/file/Section.tsx
import type { ReactNode } from 'react';
import { LABEL } from './type';

/**
 * The ruled block with the binder tab.
 *
 * One ink rule on top (none on the first block), a 200px tab column at lg
 * and above carrying the letter and a Courier caption, collapsing to one
 * line above the body below that. The body column carries min-w-0 so a
 * display headline can never set the page wider than the phone; that
 * exact overflow was a live defect on the old hero.
 */
export function Section({
  tab,
  label,
  first = false,
  id,
  children,
}: {
  tab?: string;
  label: string;
  first?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`grid gap-4 lg:grid-cols-[200px_1fr] lg:gap-10 ${
        first
          ? 'pt-12 pb-10 sm:pt-16 sm:pb-14'
          : 'border-t border-forest-900 py-10 dark:border-cream-100/40 sm:py-14'
      }`}
    >
      <div className={LABEL}>
        {tab && (
          <span className="mb-1.5 block font-caslon text-[44px] normal-case leading-none tracking-normal text-forest-900 dark:text-cream-100">
            {tab}
          </span>
        )}
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
```

- [ ] **Step 5: Write Sheet, SheetRow and Stamp**

```tsx
// components/marketing/file/Sheet.tsx
import type { ReactNode } from 'react';

/**
 * A piece of the file: the exhibit index, a review memo, a matter file.
 *
 * The one element on the site with a shadow, and the one place Courier is
 * the running face. Product content is shown this way instead of inside a
 * browser frame. `assemble` opts the rows into the cover's single motion.
 */
export function Sheet({
  kicker,
  kickerRight,
  title,
  assemble = false,
  className = '',
  children,
}: {
  kicker?: string;
  kickerRight?: string;
  title?: string;
  assemble?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative rounded-[3px] border border-rule bg-sheet p-6 font-courier text-[13.5px] text-forest-900 shadow-[0_30px_50px_-30px_rgba(16,40,31,0.35)] dark:text-cream-100 sm:p-7 ${className}`.trim()}
    >
      {(kicker || kickerRight) && (
        <div className="flex justify-between gap-4 border-b border-forest-900 pb-2.5 text-[12px] uppercase tracking-[0.06em] text-ink-600 dark:border-cream-100/40 dark:text-cream-100/60">
          <span>{kicker}</span>
          <span>{kickerRight}</span>
        </div>
      )}
      {title && (
        <p className="mb-4 mt-3 font-caslon-text text-[20px] leading-tight">{title}</p>
      )}
      <div className={assemble ? 'file-assemble' : undefined}>{children}</div>
    </div>
  );
}

/** One ruled row: a mark (exhibit letter, step number), text, and a right-hand date or status. */
export function SheetRow({ mark, text, right }: { mark: string; text: ReactNode; right?: ReactNode }) {
  return (
    <div
      data-row
      className="grid grid-cols-[34px_1fr_auto] items-baseline gap-3.5 border-b border-dotted border-rule py-2.5 last:border-b-0"
    >
      <b className="font-bold">{mark}</b>
      <span className="min-w-0 truncate">{text}</span>
      <span className="text-ink-600 tabular-nums dark:text-cream-100/60">{right}</span>
    </div>
  );
}

/**
 * The gold. One per page, on a sheet, rotated. `text-accent-text` rather
 * than `text-accent`: docs/DESIGN.md and lib/accent-text.ts, gold as ink
 * needs the darker cut to read on paper.
 */
export function Stamp({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <span
      data-stamp
      className="absolute bottom-5 right-6 inline-block rotate-[-6deg] rounded-[2px] border-2 border-accent px-3 py-2 text-center font-courier text-[12px] font-bold uppercase leading-tight tracking-[0.12em] text-accent-text"
    >
      {line1}
      <span className="block text-[20px] tracking-[0.02em]">{line2}</span>
    </span>
  );
}
```

- [ ] **Step 6: Write Definitions and Schedule**

```tsx
// components/marketing/file/Definitions.tsx
import type { ReactNode } from 'react';
import { LABEL } from './type';

/** Two to four terms with definitions. This replaces every check-bullet list. */
export function Definitions({
  items,
  columns = 3,
}: {
  items: { term: string; def: ReactNode }[];
  columns?: 2 | 3 | 4;
}) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];
  return (
    <dl className={`mt-6 grid gap-6 ${cols}`}>
      {items.map((it) => (
        <div key={it.term}>
          <dt className={`${LABEL} border-t border-rule pt-2`}>{it.term}</dt>
          <dd className="mt-1 font-public text-[15px] leading-[1.45]">{it.def}</dd>
        </div>
      ))}
    </dl>
  );
}
```

```tsx
// components/marketing/file/Schedule.tsx
import Link from 'next/link';
import { Sheet, Stamp } from './Sheet';
import { BUTTON_INK, LABEL } from './type';

export type ScheduleColumn = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  cta: { label: string; href: string; hideOnIos?: boolean };
  emphasized?: boolean;
};
export type ScheduleRow = { label: string; cells: string[] };

const OUTLINE =
  'inline-flex min-h-[44px] items-center rounded-[3px] border border-forest-900 px-3.5 py-2 font-public text-[13px] font-semibold text-forest-900 no-underline hover:bg-forest-900/5 dark:border-cream-100/70 dark:text-cream-100 dark:hover:bg-cream-100/10';

/**
 * A schedule of fees: tiers as columns, one feature per row, so tiers can
 * be compared row by row. The stamp sits on `stampOn` and is the page's
 * gold. Below lg the table scrolls inside its own container; the page
 * body never scrolls sideways. Below sm each tier is also listed as a
 * Sheet so a phone reader is not asked to pan a five-column table.
 */
export function Schedule({
  columns,
  rows,
  stampOn,
  stamp,
}: {
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  stampOn?: string;
  stamp?: { line1: string; line2: string };
}) {
  const cta = (c: ScheduleColumn) => (
    <Link
      href={c.cta.href}
      {...(c.cta.hideOnIos ? { 'data-hide-on-ios': true } : {})}
      className={c.emphasized ? BUTTON_INK : OUTLINE}
    >
      {c.cta.label}
    </Link>
  );
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="border-b border-forest-900 dark:border-cream-100/40" />
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="relative border-b border-forest-900 pb-3 pr-3 text-left align-top font-normal dark:border-cream-100/40"
                >
                  {stamp && stampOn === c.id && (
                    <span className="absolute -top-3 right-2 block scale-75">
                      <Stamp line1={stamp.line1} line2={stamp.line2} />
                    </span>
                  )}
                  <span className="block font-caslon text-[20px]">{c.name}</span>
                  <span className="block font-caslon text-[26px] tabular-nums">
                    {c.price} <span className={`${LABEL} normal-case`}>{c.cadence}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className={`${LABEL} w-[22%] border-b border-dotted border-rule py-2 pr-3 text-left font-normal`}>
                  {r.label}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={columns[i]?.id ?? i} className="border-b border-dotted border-rule py-2 pr-3 align-top tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {columns.map((c) => (
                <td key={c.id} className="pr-3 pt-4">
                  {cta(c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 sm:hidden">
        {columns.map((c) => (
          <Sheet key={c.id} kicker={c.name} kickerRight={`${c.price} ${c.cadence}`}>
            {rows.map((r, i) => (
              <div key={r.label} className="flex justify-between gap-4 border-b border-dotted border-rule py-2 last:border-b-0">
                <span className={LABEL}>{r.label}</span>
                <span className="tabular-nums">{r.cells[columns.indexOf(c)] ?? ''}</span>
              </div>
            ))}
            <div className="pt-4">{cta(c)}</div>
          </Sheet>
        ))}
      </div>
    </>
  );
}
```

```ts
// components/marketing/file/index.ts
export * from './type';
export { FilePage } from './FilePage';
export { Section } from './Section';
export { Sheet, SheetRow, Stamp } from './Sheet';
export { Definitions } from './Definitions';
export { Schedule } from './Schedule';
export type { ScheduleColumn, ScheduleRow } from './Schedule';
```

Note on the phone form of `Schedule`: the unused `i` in the inner map is intentional; remove it if the linter objects (`rows.map((r) => ...)`).

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run tests/marketing-file-primitives.test.tsx > /tmp/t2.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t2.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: EXIT=0, TSC_EXIT=0. If `data-hide-on-ios` fails type checking on `Link`, spread it as `{...({ 'data-hide-on-ios': '' } as Record<string, string>)}`.

- [ ] **Step 8: Mutate**

Remove `data-stamp` from `Stamp`; the Sheet stamp test and the Schedule "exactly one stamp" test go red. Restore. Change `min-w-0` in `Section` to `min-w-1`; the Section min-w-0 test goes red. Restore. `git diff --stat` empty except the new files.

- [ ] **Step 9: Sweep and commit**

Run the dash sweep from Task 1 Step 8 over `components/marketing/file/*.ts*` and the test file. Expected 0 hits each.

```bash
git add components/marketing/file tests/marketing-file-primitives.test.tsx
git commit -m "Add the five case-file primitives

FilePage, Section, Sheet with SheetRow and Stamp, Definitions and
Schedule, plus the type roles spelled once. Rendered in tests with
react-dom/server: the stamp is the only gold, rows opt into the one
motion, the body column cannot widen the page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 3: The home page

**Files:**
- Rewrite: `app/page.tsx` (keep lines 20-58 `SITE_URL` and `metadata` verbatim; keep the signed-in redirect logic from lines 60-88; everything else is replaced)
- Delete: `tests/hero-accent-discipline.test.ts`
- Create: `tests/cover-accent-discipline.test.ts`

**Interfaces:**
- Consumes: every export of `components/marketing/file` (Task 2).
- Produces: `HOME_FAQ: { q: string; a: string }[]` exported from `app/page.tsx` (Task 9's JSON-LD guard reads it); a top-level `function Cover` (the accent guard slices on it).

- [ ] **Step 1: Write the failing guard**

```ts
// tests/cover-accent-discipline.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The home cover, held to the case-file spec: the accent makes exactly one
 * claim on the page and it is the hearing stamp; the headline is Caslon,
 * never italic, never gold; the copy column can shrink; the page owns the
 * one motion. Replaces tests/hero-accent-discipline.test.ts, whose hero
 * this cover replaces. Reads comment-stripped source and asserts calls and
 * classes, not names in prose.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/page.tsx'), 'utf8'));

function fn(name: string): string {
  const start = PAGE.search(new RegExp(`^function ${name}\\b`, 'm'));
  expect(start, `${name} is not a top-level function`).toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.search(/^(?:export )?(?:async )?function \w/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the cover spends the accent once, on the stamp', () => {
  it('renders exactly one Stamp on the whole page, inside Cover', () => {
    expect(PAGE.match(/<Stamp\b/g)?.length).toBe(1);
    expect(fn('Cover')).toMatch(/<Stamp\b/);
  });
  it('carries no other gold anywhere on the page', () => {
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border|from|via|to)-gold-[a-z0-9]+/);
    expect(PAGE).not.toMatch(/gold-metal|gold-shine|gold-pan/);
    for (const hex of ['#d5bb7e', '#c2a66a', '#f2d896', '#e5c07c', '#b08229', '#d4a14a', '#c79532']) {
      expect(PAGE.toLowerCase()).not.toContain(hex);
    }
    expect(PAGE).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('the headline', () => {
  it('is set with the shared H1 role and is never italic', () => {
    expect(fn('Cover')).toMatch(/<h1 className=\{H1\}>/);
    expect(PAGE).not.toMatch(/\bitalic\b/);
    expect(PAGE).not.toMatch(/font-display|font-serif|font-sans/);
  });
  it('keeps the copy column shrinkable', () => {
    expect(fn('Cover')).toMatch(/Left: editorial copy block[\s\S]{0,80}className="min-w-0 lg:col-span-7"/);
  });
});

describe('the one motion', () => {
  it('is the cover sheet and nothing else', () => {
    expect(PAGE.match(/assemble\b/g)?.length).toBe(1);
    expect(fn('Cover')).toMatch(/<Sheet[^>]*\bassemble\b/);
    expect(PAGE).not.toMatch(/animate-fade-up|stagger|cv-auto|gold-pan/);
  });
});

describe('what the page no longer carries', () => {
  it('imports none of the retired sections', () => {
    for (const name of [
      'AudienceSplit', 'FeatureGallery', 'TestimonialMarquee', 'TechTrustStrip', 'SectionPhoto',
      'BrowserFrame', 'ProductShowcaseBand', 'ApprovalToExecuted', 'BellaAvatar', 'AboutTeaser',
    ]) {
      expect(PAGE, `${name} should be gone from the home page`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
  it('feeds the FAQ list and the JSON-LD from one exported array', () => {
    expect(PAGE).toMatch(/^export const HOME_FAQ/m);
    expect(PAGE).toMatch(/<FaqJsonLd questions=\{HOME_FAQ\}/);
    expect(PAGE).toMatch(/HOME_FAQ\.map\(/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/cover-accent-discipline.test.ts > /tmp/t3.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t3.log`
Expected: EXIT=1, every `it` red.

- [ ] **Step 3: Delete the old hero guard**

```bash
git rm -q tests/hero-accent-discipline.test.ts
```

- [ ] **Step 4: Rewrite app/page.tsx**

Replace the whole file with the following. `SITE_URL` and `metadata` are the existing lines 20-58 and are not shown again here; paste them where marked.

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { resolveDefaultLanding } from '@/lib/landing';
import { AppJsonLd, FaqJsonLd } from '@/components/seo/JsonLd';
import {
  BODY,
  BUTTON_INK,
  BUTTON_OUTLINE_CREAM,
  Definitions,
  FilePage,
  H1,
  H2,
  LABEL,
  LINK,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '@/components/marketing/file';

// [paste the existing SITE_URL constant and `export const metadata` here, unchanged]

/**
 * The six questions on the page. This array feeds BOTH the visible list in
 * WhatItIsNot and the FAQPage JSON-LD in HomeStructuredData, so the markup
 * and the page cannot disagree. Google penalises a mismatch.
 */
export const HOME_FAQ: { q: string; a: string }[] = [
  {
    q: 'Is Advottic legal advice?',
    a: 'No, and we will never pretend it is. Advottic helps you keep your story tidy and your evidence organized. We are not a law firm and we do not create an attorney-client relationship. For decisions that matter, please talk to a licensed attorney.',
  },
  {
    q: 'I am facing criminal charges. Can Advottic help?',
    a: 'Please reach out to a public defender right away if there is any chance of incarceration. That help is free and your constitutional right. Advottic can hold the timeline and the documents in the meantime, but a real attorney is what you need first.',
  },
  {
    q: 'Where is my information kept?',
    a: 'Your case lives in a private, encrypted database, and your uploads sit in a private file vault. Only your account can open them. You can export everything you have written or uploaded at any time.',
  },
  {
    q: 'Can my attorney see my case?',
    a: 'Yes, on the Pro plan you can invite them by email. They can read the file and add to it, and you stay in charge of who has access. Remove them whenever you like.',
  },
  {
    q: 'What is Bella?',
    a: 'Bella is the assistant built into Advottic. She summarizes your case file, drafts documents from templates, and answers plain-English questions about your matter, always telling you which tool she used to get an answer. She is a research and organizing aid, not a lawyer, and never replaces legal advice.',
  },
  {
    q: 'What is Safe Witness?',
    a: 'The personal-safety feature. A press-and-hold, on the app or a paired Wear OS watch, sends a one-time alert with your live location to the trusted contacts you have chosen, plus a one-tap way to call 911. It requires your explicit action every time. Nothing runs in the background without you triggering it.',
  },
];

export default async function HomePage() {
  // Once a user is signed in, the marketing page is noise. Send them to
  // their landing. Non-blocking on Supabase misconfig. If the lookup
  // succeeds but the redirect somehow does not fire, the cover still offers
  // a path to their cases so nobody is stuck on marketing chrome.
  let signedIn = false;
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
        redirect(await resolveDefaultLanding());
      }
    } catch (err) {
      if ((err as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
    }
  }

  return (
    <FilePage>
      <HomeStructuredData />
      <Cover signedIn={signedIn} />
      <WhatGoesIn />
      <WhatComesOut />
      <WhoCanSee />
      <InTheirWords />
      <WhatItIsNot />
      <FirmSignpost />
      <Close />
    </FilePage>
  );
}

function HomeStructuredData() {
  return (
    <>
      <AppJsonLd />
      <FaqJsonLd questions={HOME_FAQ} />
    </>
  );
}

function Cover({ signedIn }: { signedIn: boolean }) {
  return (
    <Section label="Cover" first>
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
        {/* Left: editorial copy block. min-w-0 so the display headline can
            never set this column wider than a 375px phone; that overflow was
            a live defect on the previous hero and a guard reads this line. */}
        <div className="min-w-0 lg:col-span-7">
          <h1 className={H1}>Walk into court with everything in order.</h1>
          <p className={`${BODY} mt-6`}>
            Most cases are built quietly, one note and one document at a time. Advottic gives you
            a calm place to keep them, so when the moment comes to tell your story, the words, the
            dates and the paper are already there.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            {signedIn ? (
              <Link href="/cases" className={BUTTON_INK}>
                Go to your cases
              </Link>
            ) : (
              <Link href="/cases/new" className={BUTTON_INK}>
                Start your case file
                <span className="font-normal opacity-75">free for 7 days</span>
              </Link>
            )}
            <Link href="/example" className={LINK}>
              See an example case
            </Link>
          </div>
          <p className={`${LABEL} mt-5`}>No card to start. Cancel any time. Yours to export.</p>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Sheet kicker="Case file" kickerRight="Small claims, claimant" title="Ramirez v. Oakline Rentals" assemble>
            <SheetRow mark="A" text="Signed lease agreement.pdf" right="Jan 3, 2024" />
            <SheetRow mark="B" text="Move-out photos (kitchen).jpg" right="Mar 30, 2025" />
            <SheetRow mark="C" text={'Text: "deposit next week".png'} right="Apr 6, 2025" />
            <SheetRow mark="D" text="Itemized deduction letter.pdf" right="Apr 9, 2025" />
            <Stamp line1="Hearing" line2="Apr 18" />
          </Sheet>
        </div>
      </div>
    </Section>
  );
}

function WhatGoesIn() {
  return (
    <Section tab="A" label="What goes in" id="gather">
      <h2 className={H2}>Your camera roll becomes an exhibit list.</h2>
      <p className={`${BODY} mt-4`}>
        Drop in screenshots, PDFs, photos and recordings as things happen. Each one is lettered,
        the date is read from the file, and the source is noted, so nothing is lost before your
        hearing.
      </p>
      <Definitions
        items={[
          { term: 'Lettered', def: 'A to Z and beyond, in the order you add them.' },
          { term: 'Dated', def: 'Read from the file itself, editable when it is wrong.' },
          { term: 'Kept', def: 'One private room per matter, encrypted at rest.' },
        ]}
      />
    </Section>
  );
}

function WhatComesOut() {
  return (
    <Section tab="B" label="What comes out" id="review">
      <h2 className={H2}>A calm read of where you stand, and a packet anyone can read in five minutes.</h2>
      <p className={`${BODY} mt-4`}>
        Advottic Review reads your file and points out possible issues, gaps in the evidence and
        questions worth asking, in plain language. Bella answers legal terms and finds things in
        your own case. The packet is one PDF: your account, the timeline, every exhibit.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Sheet kicker="Advottic Review" kickerRight="Read in 28 seconds" title="Ramirez v. Oakline Rentals">
          <Memo label="Possible issue" text="Deductions may exceed statutory limits under Civ. Code 1950.5." />
          <Memo label="Evidence gap" text="Add the dated move-out inspection to strengthen the timeline." />
          <Memo label="Ask your attorney" text="Whether the 21-day return window was met after move-out." />
        </Sheet>
        <Sheet kicker="Court packet" kickerRight="PDF, 14 pages" title="Contents">
          <SheetRow mark="1" text="Your account of what happened" />
          <SheetRow mark="2" text="Timeline, by event date" />
          <SheetRow mark="3" text="Exhibits A to L" />
          <SheetRow mark="4" text="Questions for the hearing" />
        </Sheet>
      </div>
    </Section>
  );
}

/** One entry of the review memo: a Courier label over a plain sentence. */
function Memo({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-t border-rule py-2.5 first:border-t-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-0.5 font-public text-[14px] leading-snug">{text}</p>
    </div>
  );
}

function WhoCanSee() {
  return (
    <Section tab="C" label="Who can see it" id="privacy">
      <h2 className={H2}>Yours alone, yours to take, and a clear log of every change.</h2>
      <Definitions
        items={[
          {
            term: 'Private by default',
            def: 'Everything you write or upload is encrypted and locked to your account. We do not read it, sell it or share it.',
          },
          {
            term: 'Yours to take with you',
            def: 'Download the whole file as a PDF or an archive whenever you like.',
          },
          {
            term: 'You stay in control',
            def: 'See who looked at the case, who added what, and when. Invite your attorney when you choose.',
          },
        ]}
      />
    </Section>
  );
}

/**
 * The three quotes are the ones the retired marquee carried, verbatim from
 * components/TestimonialMarquee.tsx. If that file's wording differs from
 * what is written here, the file wins: copy it, do not edit it.
 */
const QUOTES = [
  {
    quote: 'The judge said the word organized. That word changed how the rest of the hearing went.',
    who: 'Marisol R.',
    role: 'Self-represented, landlord-tenant',
  },
  {
    quote: 'My attorney told me later it shaved months off the timeline.',
    who: 'David K.',
    role: 'Small-business owner, contract dispute',
  },
  {
    quote: 'Plain English, in five minutes. I stopped feeling lost.',
    who: 'Tracy P.',
    role: 'First-time defendant',
  },
];

function InTheirWords() {
  return (
    <Section tab="D" label="In their words">
      <div className="grid gap-8 md:grid-cols-3">
        {QUOTES.map((q) => (
          <figure key={q.who} className="m-0">
            <blockquote className="m-0 font-caslon-text text-[20px] italic leading-[1.4]">
              {'"'}{q.quote}{'"'}
            </blockquote>
            <figcaption className={`${LABEL} mt-3`}>
              {q.who}. {q.role}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className={`${LABEL} mt-8 normal-case tracking-normal`}>
        Names changed or shortened on request. Quotes lightly edited for length. Outcomes vary; past
        results are not a promise of future ones.
      </p>
    </Section>
  );
}

function WhatItIsNot() {
  return (
    <Section tab="E" label="What it is not" id="faq">
      <h2 className={H2}>Advottic prepares. An attorney advises. You decide.</h2>
      <p className={`${BODY} mt-4`}>
        We organize what happened. We do not represent you, predict outcomes or replace a licensed
        attorney.
      </p>
      <div className="mt-8 border-t border-rule">
        {HOME_FAQ.map((it) => (
          <details key={it.q} className="group border-b border-rule py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-public text-[15px] font-medium">
              <h3 className="m-0 text-[15px] font-medium">{it.q}</h3>
              <span aria-hidden className="font-courier text-xl leading-none text-ink-600 group-open:rotate-45 dark:text-cream-100/60">
                +
              </span>
            </summary>
            <p className={`${BODY} mt-3 text-[15px]`}>{it.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

function FirmSignpost() {
  return (
    <section className="-mx-4 mt-4 bg-forest-950 px-4 py-10 text-cream-100 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] items-center gap-6 lg:grid-cols-[1fr_auto]">
        <div>
          <p className={`${LABEL} text-cream-100/60`}>For firms</p>
          <h2 className={`${H2} mt-2 text-cream-100`}>Running a practice?</h2>
          <p className="mt-3 max-w-[62ch] font-public text-[17px] leading-[1.55] text-cream-100/80">
            Advottic Counsel is the firm workspace: intake, evidence rooms, signing inside the vault,
            audit log, SSO. It has its own front door.
          </p>
        </div>
        <Link href="/enterprise" className={BUTTON_OUTLINE_CREAM}>
          See Advottic for firms
        </Link>
      </div>
    </section>
  );
}

function Close() {
  return (
    <Section label="Whenever you are ready">
      <h2 className={H2}>One small step today.</h2>
      <p className={`${BODY} mt-4`}>
        Start a case file and add to it as life unfolds. Free for 7 days, no card to start, cancel
        any time.
      </p>
      <Link href="/cases/new" className={`${BUTTON_INK} mt-6`}>
        Start your case file
      </Link>
    </Section>
  );
}
```

Note: `text-cream-100/60` on the signpost label overrides the `LABEL` ink colour because it comes later in the class list; Tailwind orders by its own layer, not source order, so if the label renders in the paper ink colour, replace `${LABEL} text-cream-100/60` with the explicit string `font-courier text-[12.5px] uppercase tracking-[0.08em] text-cream-100/60`.

- [ ] **Step 5: Run the guard, the two neighbours, and the type check**

Run: `npx vitest run tests/cover-accent-discipline.test.ts tests/consumer-live-defects.test.ts tests/dark-panel-contrast.test.ts > /tmp/t3.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t3.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: EXIT=0, TSC_EXIT=0. If `tsc` reports unused imports (`BUTTON_OUTLINE_CREAM` is used by the signpost, `LINK` by the cover), fix the import list rather than the usage.

- [ ] **Step 6: Mutate**

Add a second `<Stamp line1="x" line2="y" />` inside `WhatGoesIn`; the "exactly one Stamp" test goes red. Restore. Add `italic` to the h1 className string; the headline test goes red. Restore. `git diff --stat` shows only `app/page.tsx` and the two test files.

- [ ] **Step 7: The four gates**

Run all four gates from the Global Constraints. Expected all `EXIT=0`. `npm run build` will also confirm the removed imports left no dangling references.

- [ ] **Step 8: Render and look**

Run: `npm run build > /tmp/b.log 2>&1 && (npx next start -p 3111 > /tmp/next.log 2>&1 &) && sleep 6 && node -e "
const p=require('puppeteer-core');(async()=>{const b=await p.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});for(const [n,w,h] of [['desk',1440,900],['phone',390,844]]){const pg=await b.newPage();await pg.setViewport({width:w,height:h});await pg.goto('http://localhost:3111/',{waitUntil:'networkidle2'});await pg.screenshot({path:'/tmp/home-'+n+'.png',fullPage:true});console.log(n, await pg.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth?'no sideways scroll':'SIDEWAYS SCROLL'));}await b.close();})()"; pkill -f "next start -p 3111"`
Then Read `/tmp/home-desk.png` and `/tmp/home-phone.png`. Expected: the cover sheet with four rows and one gold stamp; five lettered sections with rules and no cards; the dark signpost band; "no sideways scroll" on both. If anything looks wrong, fix the source and repeat this step.

- [ ] **Step 9: Sweep and commit**

Dash sweep over `app/page.tsx` and `tests/cover-accent-discipline.test.ts`: 0 hits each.

```bash
git add app/page.tsx tests/cover-accent-discipline.test.ts
git commit -m "Set the home page as the case file

One story for one reader: a cover with the assembling case file and the
hearing stamp as the page's one gold, then five lettered sections, a
firm signpost band and a plain close. The two-audience split, the tile
grid, the browser frames, the photograph, the marquee and the gradient
band are gone; about 5,500px against 13,900. The six FAQ entries feed
the list and the JSON-LD from one array.

tests/cover-accent-discipline replaces hero-accent-discipline.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 4: Header and footer

**Files:**
- Modify: `app/layout.tsx:586-651` (the signed-out header: add a nav; drop the blur) and `app/layout.tsx:752-840` (the footer)
- Test: `tests/marketing-chrome.test.ts`

**Interfaces:**
- Consumes: `LABEL` from `components/marketing/file/type` (import `{ LABEL }` from `'@/components/marketing/file/type'`, NOT the index, so the root layout does not pull `next/link`-bearing primitives into every route).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/marketing-chrome.test.ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/marketing-chrome.test.ts > /tmp/t4.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t4.log`
Expected: EXIT=1.

- [ ] **Step 3: Add the signed-out nav and drop the blur**

In `app/layout.tsx` add the import next to the other component imports (after line 34):

```ts
import { LABEL } from '@/components/marketing/file/type';
```

At line 591 change `bg-forest-950/95 backdrop-blur-md` to `bg-forest-950`.

Inside the header's right-hand `<div className="flex items-center gap-1">` (line 615), as its FIRST child, before the `{!signedIn && consumerI18n && (` block, add:

```tsx
                    {!signedIn && (
                      <nav aria-label="Site" className="mr-4 hidden items-center gap-6 md:flex">
                        <Link href="/pricing" data-hide-in-app className="font-public text-[14px] font-medium text-cream-100/85 no-underline hover:text-cream-100">Pricing</Link>
                        <Link href="/features" className="font-public text-[14px] font-medium text-cream-100/85 no-underline hover:text-cream-100">Features</Link>
                        <Link href="/enterprise" className="font-public text-[14px] font-medium text-cream-100/85 no-underline hover:text-cream-100">For firms</Link>
                        <Link href="/what-is-advottic" className="font-public text-[14px] font-medium text-cream-100/85 no-underline hover:text-cream-100">What Advottic is</Link>
                      </nav>
                    )}
```

`data-hide-in-app` on Pricing keeps the nav honest inside the iOS shell, where `/pricing` is a blocked sell route. The existing `UserMenu` already renders the Sign in control when signed out; leave it.

- [ ] **Step 4: Restyle the footer**

Replace the `<footer ...>` opening tag (line 752) and its first inner div (line 753) with:

```tsx
        <footer className="border-t border-forest-900 bg-paper font-public dark:border-cream-100/40">
          <div className="mx-auto max-w-[1200px] px-4 py-8 text-[12px] text-ink-600 dark:text-cream-100/60 sm:px-6 lg:px-10 sm:py-10">
```

Replace every column title `<p className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">` in the footer (the "Get the Advottic app" title at line 765 and the "Advottic" title at line 777) with `<p className={LABEL}>`.

Open `components/FooterCol.tsx`; change its title element's className to `{LABEL}` with the same import, so "Product", "Legal" and "Contact" match. Its links keep their existing classes.

Replace the copyright block (the `<div className="mt-6 sm:mt-8 pt-4 ...">` near line 820 through the closing of the footer) with:

```tsx
            <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-5 font-courier text-[11.5px]">
              <p>© {new Date().getFullYear()} Advottic LLC. All rights reserved.</p>
              <p>
                Powered by{' '}
                <ExternalLink href="https://technooptics.com" className="font-bold no-underline hover:underline">
                  Techno Optics LLC
                </ExternalLink>
              </p>
            </div>
            <p className="mt-4 max-w-[90ch] font-courier text-[11.5px] leading-relaxed">
              Advottic is a service of Techno Optics LLC. Advottic Review and Bella generate informational content automatically; outputs may be incomplete, outdated, or wrong and are not legal advice. Always consult a licensed attorney in your jurisdiction before acting. If you face possible incarceration, ask the court for a public defender at your first court appearance.
            </p>
          </div>
        </footer>
```

Keep the existing `ExternalLink` import and the existing disclaimer sentence exactly as it is in the file today if it differs from the text above by a word; the test matches on its opening only.

- [ ] **Step 5: Run the guard and its neighbours**

Run: `npx vitest run tests/marketing-chrome.test.ts tests/dark-panel-contrast.test.ts tests/consumer-live-defects.test.ts > /tmp/t4.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t4.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: EXIT=0 (dark-panel-contrast still finds two `{showSiteChrome && (` gates), TSC_EXIT=0.

- [ ] **Step 6: Mutate, gates, render, commit**

Mutate: remove `href="/enterprise"` from the nav; the nav test goes red. Restore. Run the four gates. Render `/` and `/about` at 1440 and 390 with the Step 8 script from Task 3 (change the path) and look at the header and footer in both. Sweep. Commit:

```bash
git add app/layout.tsx components/FooterCol.tsx tests/marketing-chrome.test.ts
git commit -m "Give signed-out visitors a four-link nav and set the footer on paper

Pricing, Features, For firms and What Advottic is, hidden inside the
native app where pricing is a blocked route; the bar loses its blur.
The footer is one ink rule, Courier-titled columns and a Courier
disclaimer, and keeps the store row's in-app gate. Signed-in headers
are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 5: Pricing as a schedule of fees

**Files:**
- Modify: `app/pricing/page.tsx` (keep lines 1-285: imports, `metadata`, `Tier`, `CONSUMER_TIERS`, `FIRM_TIERS`, `PRICING_FAQ`; replace `PricingPage` from line 286 to the end, and delete `TierCard`, `Card`, `Q`; drop the `TechTrustStrip` import)
- Test: `tests/schedule-of-fees.test.ts`

**Interfaces:**
- Consumes: `Schedule`, `ScheduleColumn`, `ScheduleRow`, `Sheet`, `Section`, `FilePage`, `Definitions`, `H1`, `H2`, `BODY`, `LABEL`, `BUTTON_INK` from `components/marketing/file`; `SavingsCalculator` unchanged; the existing tier arrays.
- Produces: `function tierToColumn(t: Tier): ScheduleColumn` and `function featureRows(tiers: Tier[], labels: string[]): ScheduleRow[]` inside the page (the guard reads them).

- [ ] **Step 1: Write the failing guard**

```ts
// tests/schedule-of-fees.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Pricing is a schedule of fees: two ruled tables built from the tier
 * arrays that already existed, one stamp, the iOS branch untouched.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/pricing/page.tsx'), 'utf8'));

describe('the schedule', () => {
  it('renders both audiences through Schedule from the existing tier arrays', () => {
    expect(PAGE.match(/<Schedule\b/g)?.length).toBe(2);
    expect(PAGE).toMatch(/columns=\{CONSUMER_TIERS\.map\(tierToColumn\)\}/);
    expect(PAGE).toMatch(/columns=\{FIRM_TIERS\.map\(tierToColumn\)\}/);
  });
  it('puts the one stamp on Pro', () => {
    expect(PAGE.match(/stampOn=/g)?.length).toBe(1);
    expect(PAGE).toMatch(/stampOn="pro"/);
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border)-gold-|gold-metal|amber-/);
  });
  it('keeps the iOS branch that renders nothing purchasable', () => {
    expect(PAGE).toMatch(/serverPlatform === 'ios'/);
    expect(PAGE).toMatch(/href="\/gift"[^>]*data-hide-on-ios|data-hide-on-ios[^>]*href="\/gift"|hideOnIos: true/);
  });
  it('no longer ships cards, the partner strip or a gold button', () => {
    expect(PAGE).not.toMatch(/TechTrustStrip|TierCard|className="card|btn-primary|rounded-2xl|rounded-3xl/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/schedule-of-fees.test.ts > /tmp/t5.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t5.log`
Expected: EXIT=1.

- [ ] **Step 3: Rewrite the page body**

Remove `import { TechTrustStrip } from '@/components/TechTrustStrip';` and add:

```ts
import {
  BODY,
  BUTTON_INK,
  Definitions,
  FilePage,
  H1,
  H2,
  LABEL,
  Schedule,
  Section,
  Sheet,
  type ScheduleColumn,
  type ScheduleRow,
} from '@/components/marketing/file';
```

Keep everything through `PRICING_FAQ`. Replace from `export default function PricingPage() {` to the end of the file with:

```tsx
/** A tier as a schedule column. The CTA and price come straight from the tier. */
function tierToColumn(t: Tier): ScheduleColumn {
  return {
    id: t.id,
    name: t.name,
    price: t.price,
    cadence: t.cadence,
    cta: { label: t.cta.label, href: t.cta.href },
    emphasized: t.emphasized,
  };
}

/**
 * Feature rows for the table. Each label is matched against a tier's
 * feature strings case-insensitively; the cell shows the matching feature
 * text (with the label removed when it is a plain "included" line) or a
 * middle dot when the tier lacks it. This keeps the arrays above as the
 * single source of what a tier includes.
 */
function featureRows(tiers: Tier[], labels: string[]): ScheduleRow[] {
  return labels.map((label) => ({
    label,
    cells: tiers.map((t) => {
      const hit = t.features.find((f) => f.toLowerCase().includes(label.toLowerCase()));
      if (!hit) return '·';
      const short = hit.replace(new RegExp(label, 'i'), '').replace(/^[\s:,-]+|[\s:,.-]+$/g, '');
      return short.length > 0 && short.length < 28 ? short : 'Yes';
    }),
  }));
}

const CONSUMER_ROWS = [
  'case',
  'PDF export',
  'Safe Witness',
  'E-sign',
  'Bella',
  'Advottic Review',
  'law firm',
  'Case Timeline',
  'Priority support',
];

const FIRM_ROWS = [
  'tokens',
  'letterhead',
  'subdomain',
  'Employee Hub',
  'SSO',
  'SLA',
  'group billing',
];

export default function PricingPage() {
  // App Store Guideline 3.1.1 / 3.1.3(c): this whole route is a sell page,
  // so inside the iOS app it does not exist. middleware.ts redirects it
  // before this runs; this branch is the second, independent line of
  // defence and renders nothing purchasable, nothing priced.
  const serverPlatform = nativePlatformFromUserAgent(headers().get('user-agent'));
  if (serverPlatform === 'ios') {
    return (
      <FilePage>
        <Section label="Your account" first>
          <h1 className={H1}>Your account</h1>
          <p className={`${BODY} mt-4`}>Whatever your account includes unlocks here automatically.</p>
          <Link href="/cases" className={`${BUTTON_INK} mt-6`}>
            Go to your cases
          </Link>
        </Section>
      </FilePage>
    );
  }
  return (
    <FilePage>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Pricing', href: '/pricing' },
        ]}
      />
      <FaqJsonLd questions={PRICING_FAQ} />
      <PricingProductJsonLd />

      <Section label="Schedule of fees" first>
        <p className={LABEL}>7-day trial on every paid tier. 20% off annual. Cancel any time.</p>
        <h1 className={`${H1} mt-3`}>What it costs.</h1>
        <p className={`${BODY} mt-5`}>
          People pay for their own matter. Firms pay per seat, in writing. The platform underneath
          is the same.
        </p>
      </Section>

      <Section tab="I" label="For one person" id="individuals">
        <Schedule
          columns={CONSUMER_TIERS.map(tierToColumn)}
          rows={featureRows(CONSUMER_TIERS, CONSUMER_ROWS)}
          stampOn="pro"
          stamp={{ line1: 'Most', line2: 'chosen' }}
        />
      </Section>

      <Section tab="II" label="For firms" id="firms">
        <Schedule columns={FIRM_TIERS.map(tierToColumn)} rows={featureRows(FIRM_TIERS, FIRM_ROWS)} />
        <p className={`${BODY} mt-6 text-[15px]`}>
          Enterprise is agreed in writing: the final price scales with seats, support tier and SLA.
        </p>
      </Section>

      <Section label="Worksheet" id="savings">
        <h2 className={H2}>What does Advottic save your firm?</h2>
        <div className="mt-6">
          <SavingsCalculator />
        </div>
      </Section>

      <Section label="Discounts">
        <Definitions
          columns={2}
          items={[
            { term: 'Annual prepay', def: '20% off any paid tier.' },
            { term: 'Bar-association members', def: '15% off Counsel tiers. We verify the bar number on signup.' },
            { term: 'Law students', def: '50% off the consumer tiers.' },
            { term: 'Legal aid and nonprofits', def: '75% off, capped at 5 seats.' },
            { term: 'Multi-firm groups', def: '10% off each additional firm.' },
          ]}
        />
      </Section>

      <Section label="Add-ons, as used">
        <Definitions
          columns={2}
          items={[
            { term: 'E-sign requests beyond bundle', def: '$2 per request (Solo, Pro), $1 per request (Small Firm and up).' },
            { term: 'Contract reviews beyond bundle', def: '$9.99 per contract for Pro.' },
            { term: 'Discovery review', def: '$0.05 per document beyond the bundle.' },
            { term: 'Receipt vault storage', def: '$0.10 per GB per month beyond bundle.' },
            { term: 'Safe Witness SMS beyond bundle', def: '$0.02 per SMS segment past 50 messages a month.' },
            { term: 'Wear OS companion app', def: 'Included at no extra charge.' },
            { term: 'Marketplace lead', def: 'Free for the first match per matter, then $50 to $99 per accepted lead.' },
          ]}
        />
      </Section>

      <Section label="Gift">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className={H2}>Buy it for someone you care about.</h2>
            <p className={`${BODY} mt-3 text-[15px]`}>
              Pay once. They get an email with a one-tap setup link. The subscription activates on
              their account for the duration you choose (1, 3, 6 or 12 months) and they can upgrade
              or extend later from their billing page.
            </p>
          </div>
          <Link href="/gift" data-hide-on-ios className={BUTTON_INK}>
            Send a gift
          </Link>
        </div>
      </Section>

      <Section label="Frequently asked" id="faq">
        <div className="border-t border-rule">
          {PRICING_FAQ.map((it) => (
            <details key={it.q} className="group border-b border-rule py-3.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-public text-[15px] font-medium">
                <h3 className="m-0 text-[15px] font-medium">{it.q}</h3>
                <span aria-hidden className="font-courier text-xl leading-none text-ink-600 group-open:rotate-45 dark:text-cream-100/60">+</span>
              </summary>
              <p className={`${BODY} mt-3 text-[15px]`}>{it.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section label="Still deciding">
        <h2 className={H2}>Try the tier above what you think you need.</h2>
        <p className={`${BODY} mt-4`}>
          For most people that is Plus, where Bella unlocks, or Pro if you want Advottic Review and to
          bring your law firm in. For most firms it is Small Firm. If you do not use it, downgrade for
          free.
        </p>
        <Link href="/sign-in" className={`${BUTTON_INK} mt-6`}>
          Get started
        </Link>
      </Section>
    </FilePage>
  );
}
```

The page-level FAQ used to be nine hand-written `<Q>` blocks that duplicated `PRICING_FAQ` with small wording differences; the list now reads `PRICING_FAQ` directly so the JSON-LD and the page cannot disagree. Delete `TierCard`, `Card` and `Q`. `Sheet` may end up unused by this page: if `tsc` says so, drop it from the import.

- [ ] **Step 4: Run the guard, tsc, and read the table**

Run: `npx vitest run tests/schedule-of-fees.test.ts tests/marketing-routes-in-the-app.test.ts tests/dangling-purchase-sentences.test.ts tests/plain-limit-copy.test.ts > /tmp/t5.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t5.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: all green. Then render `/pricing` at 1440 and 390 (Task 3 Step 8 script with the path changed) and READ THE CELLS: every consumer row must show a sensible value per tier (Cases 1, 3, 8, 15, 40; Bella tokens 500K, 1.5M, 3M). If `featureRows` produces "Yes" where a number belongs or a dot where a tier does have the feature, adjust the label in `CONSUMER_ROWS` to the substring the tier string actually uses (read `CONSUMER_TIERS` in the file), never the tier arrays.

- [ ] **Step 5: Mutate, gates, sweep, commit**

Mutate: change `stampOn="pro"` to `stampOn="plus"`; the stamp test goes red. Restore. Four gates. Sweep. Commit:

```bash
git add app/pricing/page.tsx tests/schedule-of-fees.test.ts
git commit -m "Set pricing as a schedule of fees

Two ruled tables built from the tier arrays that already existed, so
tiers compare row by row; the Most chosen stamp on Pro is the page's
one gold. The savings worksheet, discounts, add-ons, gift and FAQ are
ruled lists. The iOS branch is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 6: Features as the full index

**Files:**
- Create: `components/marketing/FeatureIndex.tsx` (client component: the toggle and both indexes)
- Rewrite: `app/features/page.tsx` (keep `metadata` lines 6-18)
- Test: `tests/feature-index.test.ts`

**Interfaces:**
- Consumes: `Section`, `Sheet`, `SheetRow`, `Definitions`, `H2`, `BODY`, `LABEL`, `BUTTON_INK` from `components/marketing/file`; `FilePage`, `H1` on the page.
- Produces: `FeatureIndex({ initial?: 'people' | 'firm' })`, default export none. `components/marketing/FeatureSheet.tsx` and `components/marketing/ApprovalToExecuted.tsx` are left in place but no longer imported by any page; Task 9 records them as dead.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/feature-index.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The features page is the table of contents of the file: lettered
 * entries for people, the four request states for firms, one Sheet where a
 * real screen matters, no browser frames, no gold.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/features/page.tsx'), 'utf8'));
const INDEX = stripComments(readFileSync(join(ROOT, 'components/marketing/FeatureIndex.tsx'), 'utf8'));

describe('the index', () => {
  it('letters the eight people entries A to H', () => {
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(INDEX, `tab="${letter}"`).toMatch(new RegExp(`tab="${letter}"`));
    }
  });
  it('keys the firm entries by the four request states, in order', () => {
    const order = ['Filed', 'With legal', 'Sent', 'Executed'].map((s) => INDEX.indexOf(`tab="${s}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('is a real toggle with tab semantics', () => {
    expect(INDEX).toMatch(/role="tablist"/);
    expect(INDEX).toMatch(/aria-selected=\{/);
    expect(INDEX).toMatch(/useState<'people' \| 'firm'>/);
  });
  it('ships no frames, cards or gold', () => {
    for (const s of [PAGE, INDEX]) {
      expect(s).not.toMatch(/BrowserFrame|FeatureSheet|ApprovalToExecuted|rounded-2xl|rounded-3xl|gold-|italic|font-display/);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/feature-index.test.ts > /tmp/t6.log 2>&1; echo EXIT=$?; grep -a -E '×|Error|Tests ' /tmp/t6.log | head`
Expected: EXIT=1 (FeatureIndex.tsx missing).

- [ ] **Step 3: Write FeatureIndex**

```tsx
// components/marketing/FeatureIndex.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  BODY,
  BUTTON_INK,
  Definitions,
  H2,
  LABEL,
  Section,
  Sheet,
  SheetRow,
} from '@/components/marketing/file';

/**
 * The table of contents of the file.
 *
 * For people, entries are lettered like exhibits because that is the
 * product's own device. For firms, entries follow the four states a request
 * passes through in the product (filed, with legal, sent, executed), because
 * that order carries information a reader needs. The toggle keeps the same
 * two-audience state the old sheet had.
 */
type Audience = 'people' | 'firm';

function Memo({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-t border-rule py-2.5 first:border-t-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-0.5 font-public text-[14px] leading-snug">{text}</p>
    </div>
  );
}

function Entry({
  tab,
  label,
  title,
  body,
  sheet,
  defs,
}: {
  tab: string;
  label: string;
  title: string;
  body: string;
  sheet?: React.ReactNode;
  defs?: { term: string; def: string }[];
}) {
  return (
    <Section tab={tab} label={label}>
      <div className={sheet ? 'grid gap-8 lg:grid-cols-2 lg:items-start' : ''}>
        <div className="min-w-0">
          <h2 className={H2}>{title}</h2>
          <p className={`${BODY} mt-4`}>{body}</p>
          {defs && <Definitions items={defs} />}
        </div>
        {sheet && <div className="min-w-0">{sheet}</div>}
      </div>
    </Section>
  );
}

function PeopleIndex() {
  return (
    <>
      <Entry
        tab="A"
        label="Exhibits"
        title="Your camera roll becomes an exhibit list."
        body="Drop in screenshots, PDFs, photos and recordings as things happen. Each one is lettered, the date is read from the file, and the source is noted, so nothing is lost before your hearing."
        defs={[
          { term: 'Lettered', def: 'A to Z and beyond, in the order you add them.' },
          { term: 'Dated', def: 'Read from the file itself, editable when it is wrong.' },
          { term: 'Withdraw', def: 'Never delete. A withdrawn exhibit keeps its letter so nothing that cites it shifts.' },
        ]}
        sheet={
          <Sheet kicker="Case file" kickerRight="Small claims, claimant" title="Ramirez v. Oakline Rentals">
            <SheetRow mark="A" text="Signed lease agreement.pdf" right="Jan 3, 2024" />
            <SheetRow mark="B" text="Move-out photos (kitchen).jpg" right="Mar 30, 2025" />
            <SheetRow mark="C" text={'Text: "deposit next week".png'} right="Apr 6, 2025" />
            <SheetRow mark="D" text="Itemized deduction letter.pdf" right="Apr 9, 2025" />
          </Sheet>
        }
      />
      <Entry
        tab="B"
        label="Review"
        title="A calm read of where your case stands."
        body="Advottic Review reads your file and points out possible issues, evidence gaps and questions worth asking, in plain language. Issue spotting in about thirty seconds, aware of your jurisdiction, never advice."
        sheet={
          <Sheet kicker="Advottic Review" kickerRight="Read in 28 seconds" title="Ramirez v. Oakline Rentals">
            <Memo label="Possible issue" text="Deductions may exceed statutory limits under Civ. Code 1950.5." />
            <Memo label="Evidence gap" text="Add the dated move-out inspection to strengthen the timeline." />
            <Memo label="Ask your attorney" text="Whether the 21-day return window was met after move-out." />
          </Sheet>
        }
      />
      <Entry
        tab="C"
        label="Safe Witness"
        title="Help is one press away."
        body="Press and hold Safe Witness from the app or your watch to share your live location with trusted contacts and reach 911 in one tap. It keeps updating until you mark yourself safe. It is on the Free tier and requires your explicit action every time."
        defs={[
          { term: 'Works on Wear OS', def: 'Press and hold on the watch, or from the app.' },
          { term: 'One-time live location', def: 'Sent to the trusted contacts you chose.' },
          { term: 'One-tap 911', def: 'A tap-to-call link in every alert.' },
        ]}
      />
      <Entry
        tab="D"
        label="Bella"
        title="Someone to ask, who has read the file."
        body="Bella is the assistant built into Advottic. She finds your cases by title, subject or place, explains a legal term in plain English, and walks you through a new case when you ask. She always asks before opening or changing anything."
        sheet={
          <Sheet kicker="Bella" kickerRight="In the app">
            <SheetRow mark="You" text="where is my apartment lease case from january?" />
            <SheetRow mark="Bella" text="Found it. Apartment lease, security deposit refund. Under review with 7 exhibits and a hearing in 9 days. Want me to open it?" />
            <SheetRow mark="You" text="yes please" />
            <SheetRow mark="Bella" text="Opening it now." />
          </Sheet>
        }
      />
      <Entry
        tab="E"
        label="Community case pages"
        title="A place for your community to show up."
        body="Publish a shareable page for an ongoing case, with the bond amount, the hearing date, whatever you would like people to know, and let the community help two ways: a signed letter of support for the attorney, or evidence and testimonials shared privately. Fundraising links point to your own accounts. Advottic never touches the money."
        defs={[
          { term: 'One shareable page', def: 'The bond amount, the hearing date, and what you choose to share.' },
          { term: 'Two ways to help', def: 'A signed letter of support, or evidence submitted privately.' },
          { term: 'Nothing public until you choose', def: 'Every submission goes to you and your attorney, exportable as one packet.' },
        ]}
      />
      <Entry
        tab="F"
        label="Packet"
        title="One PDF anyone can read in five minutes."
        body="Export the whole file as one court-ready packet: your account of what happened, the timeline by event date, every exhibit with its letter, and the questions worth raising at the hearing. Trial exports are watermarked so they read as drafts."
        sheet={
          <Sheet kicker="Court packet" kickerRight="PDF, 14 pages" title="Contents">
            <SheetRow mark="1" text="Your account of what happened" />
            <SheetRow mark="2" text="Timeline, by event date" />
            <SheetRow mark="3" text="Exhibits A to L" />
            <SheetRow mark="4" text="Questions for the hearing" />
          </Sheet>
        }
      />
      <Entry
        tab="G"
        label="Signing"
        title="Sign as a signer, always free."
        body="When a firm sends you a document to sign, the link opens the document itself, consent is captured before the pad opens, and you can finish on a phone by scanning a code. Your signed copy stays available to you for 90 days."
        defs={[
          { term: 'Consent first', def: 'You agree to sign electronically before the pad appears.' },
          { term: 'Draw, type or upload', def: 'Trackpad, mouse, or finish on your phone.' },
          { term: 'Your copy', def: 'Downloadable for 90 days after signing.' },
        ]}
      />
      <Entry
        tab="H"
        label="Vault and export"
        title="Yours alone, yours to take."
        body="Everything you write or upload is encrypted at rest and locked to your account. Download the whole file as a PDF or an archive whenever you like, and see who looked at the case, who added what, and when."
        defs={[
          { term: 'Encrypted', def: 'AES-256 at rest, TLS 1.3 in transit.' },
          { term: 'Exportable', def: 'PDF or archive, at any time, no questions.' },
          { term: 'Logged', def: 'Every view and change, with who and when.' },
        ]}
      />
      <Section label="Everything included">
        <h2 className={H2}>Start your case for free.</h2>
        <p className={`${BODY} mt-4`}>
          One case, court-ready PDF export, Safe Witness and signing as a signer are on the Free tier.
          Bella, Advottic Review and inviting your law firm unlock on the paid tiers.
        </p>
        <Link href="/cases/new" className={`${BUTTON_INK} mt-6`}>
          Start your case file
        </Link>
      </Section>
    </>
  );
}

function FirmIndex() {
  return (
    <>
      <Entry
        tab="Filed"
        label="Step 1 of 4"
        title="Nothing leaves the company until legal has read it."
        body="An employee fills one of your templates and names who it goes to. It waits. A lawyer reads the finished wording and decides. Only then is anything sent, and the same reference stays on the document from the queue to the executed copy."
        sheet={
          <Sheet kicker="Counsel, self-service" kickerRight="Waiting for review" title="Document approvals">
            <SheetRow mark="NDA" text="Mutual nondisclosure agreement, REQ-0000412, D. Whitfield" right="With legal" />
            <SheetRow mark="NDA" text="One-way nondisclosure agreement, REQ-0000411, A. Osei" right="With legal" />
            <SheetRow mark="Vendor" text="Supplier data processing terms, REQ-0000409, M. Halvorsen" right="Needs a change" />
          </Sheet>
        }
      />
      <Entry
        tab="With legal"
        label="Step 2 of 4"
        title="A lawyer reads the finished wording before anyone outside sees it."
        body="Filled forms addressed to an outside party land in one queue, grouped by the kind of document, so a reviewer can take all the NDAs in a single sitting."
        defs={[
          { term: 'Four outcomes', def: 'Approve and send, edit the wording, send it back, or decline.' },
          { term: 'A note is required', def: 'Sending back or declining needs a note, so your colleague knows where it landed.' },
          { term: 'Edits are attributed', def: 'An edit is recorded against the person who made it, with their reason.' },
        ]}
      />
      <Entry
        tab="Sent"
        label="Step 3 of 4"
        title="The recipient reads the document they are about to sign."
        body="The link opens the document itself, rendered on the page. The mark lands on the real signature line, in the position the signed copy will use."
        defs={[
          { term: 'Code apart from link', def: 'Where a request requires a code, it arrives separately from the link.' },
          { term: 'Consent first', def: 'Consent to sign electronically is captured before the pad opens.' },
          { term: 'Any device', def: 'Trackpad, mouse, or scan the code and finish on a phone.' },
        ]}
      />
      <Entry
        tab="Executed"
        label="Step 4 of 4"
        title="The executed copy files itself, and the chain says what happened."
        body="The signed document is filed under the category it was submitted as, carrying your firm's own reference, and it appears on both sides of the workspace at once: the legal team's shelf and the employee's."
        sheet={
          <Sheet kicker="Audit chain" kickerRight="REQ-0000412">
            <SheetRow mark="14:02" text="final_pdf_rendered" right="system" />
            <SheetRow mark="14:01" text="signed" right="counsel@northwind" />
            <SheetRow mark="13:58" text="link_viewed" right="counsel@northwind" />
            <SheetRow mark="13:55" text="request_sent" right="d.whitfield" />
          </Sheet>
        }
        defs={[
          { term: 'A seven-digit reference', def: 'Allocated once per firm and never reused.' },
          { term: 'Grouped', def: 'Fully executed documents grouped by what they are.' },
          { term: 'Chained', def: 'Each event hashes the one before it, so an altered row is detectable.' },
        ]}
      />
      <Section label="The rest of the workspace">
        <Definitions
          columns={2}
          items={[
            { term: 'Branded intake', def: 'A form on your own domain populates the matter file. Each client sees only their own matter.' },
            { term: 'Per-matter rooms', def: 'Counsel, paralegal, client and co-counsel each see what their role grants.' },
            { term: 'Review for triage', def: 'A freshly intaked matter read in thirty seconds: issues, gaps, the question list.' },
            { term: 'Case law you can cite', def: 'Every citation verified against CourtListener before it appears; unverified cites are dropped.' },
            { term: 'Audit log', def: 'Every write, sign and export, hash-chained.' },
            { term: 'SSO and SCIM', def: 'Microsoft Entra and Google Workspace, with access that follows your groups.' },
          ]}
        />
        <Link href="/enterprise" className={`${BUTTON_INK} mt-8`}>
          See Advottic for firms
        </Link>
      </Section>
    </>
  );
}

export function FeatureIndex({ initial = 'people' }: { initial?: Audience }) {
  const [aud, setAud] = useState<'people' | 'firm'>(initial);
  const tab = (key: Audience, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={aud === key}
      onClick={() => setAud(key)}
      className={`min-h-[44px] px-4 font-courier text-[12.5px] uppercase tracking-[0.08em] ${
        aud === key
          ? 'bg-forest-900 text-cream-50 dark:bg-cream-100 dark:text-forest-950'
          : 'text-forest-900 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10'
      }`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div role="tablist" aria-label="Choose an audience" className="inline-flex border border-forest-900 dark:border-cream-100/70">
        {tab('people', 'For people')}
        {tab('firm', 'For firms')}
      </div>
      <div className="mt-2">{aud === 'people' ? <PeopleIndex /> : <FirmIndex />}</div>
    </>
  );
}
```

- [ ] **Step 4: Rewrite the page**

```tsx
// app/features/page.tsx
import type { Metadata } from 'next';
import { FeatureIndex } from '@/components/marketing/FeatureIndex';
import { BODY, FilePage, H1, LABEL, Section } from '@/components/marketing/file';

// [keep the existing `export const metadata: Metadata = { ... }` block here, unchanged]

/**
 * The features page is the table of contents of the file. The cover states
 * the promise; FeatureIndex carries both audiences.
 */
export default function FeaturesPage() {
  return (
    <FilePage>
      <Section label="Index" first>
        <p className={LABEL}>Everything Advottic does, no account needed.</p>
        <h1 className={`${H1} mt-3`}>Everything in the file, in plain sight.</h1>
        <p className={`${BODY} mt-5`}>
          Two products held to one calm standard. Read through every capability, with the real
          screens from the product. Advottic prepares. An attorney advises. You decide.
        </p>
        <div className="mt-8">
          <FeatureIndex />
        </div>
      </Section>
    </FilePage>
  );
}
```

`FeatureIndex` renders `Section`s inside the cover `Section`'s body column; that nests a grid inside a grid, which is fine, but the inner sections then sit right of the cover's tab column at lg. If the render in Step 6 shows the index indented under the cover, move `<FeatureIndex />` OUT of the cover Section to be a sibling directly under `FilePage` (the toggle then stands on its own line above entry A). Either placement satisfies the guard; pick the one that reads as one file.

- [ ] **Step 5: Run the guard and tsc**

Run: `npx vitest run tests/feature-index.test.ts > /tmp/t6.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t6.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: both 0.

- [ ] **Step 6: Mutate, gates, render, commit**

Mutate: swap the order of the "Sent" and "Executed" entries; the order test goes red. Restore. Four gates. Render `/features` at both widths, click nothing (the server render shows people); then run the same script with `pg.click('[role=tab]:nth-child(2)')` before the screenshot to see the firm index. Sweep. Commit:

```bash
git add components/marketing/FeatureIndex.tsx app/features/page.tsx tests/feature-index.test.ts
git commit -m "Set the features page as the full index

Eight lettered entries for people, each with one sheet where a real
screen matters; four entries for firms keyed by the states a request
passes through. The browser frames and the approval scene are gone
from this page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 7: Enterprise as the firm's front door

**Files:**
- Rewrite: `app/enterprise/page.tsx` (keep lines 1-52 `SITE_URL` and `metadata`; keep `EnterpriseStructuredData` from line 1549 to the end; replace everything between)
- Modify: `components/EnterpriseSectorTabs.tsx:180-262` (the returned JSX only; data and state unchanged)
- Test: `tests/firm-front-door.test.ts`

**Interfaces:**
- Consumes: the primitives; `EnterpriseSectorTabs`, `EnterpriseInquiryForm`, `LegalReviewMock` (from `components/marketing/PortalMocks`, used INSIDE a `Sheet`, never inside `BrowserFrame`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/firm-front-door.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The enterprise page: a forest cover that keeps `enterprise-shell`, then
 * the same cream file, sections in the order a matter moves, one stamp,
 * the sector tabs and the inquiry form kept, the mocks and the compare
 * table gone.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/enterprise/page.tsx'), 'utf8'));
const TABS = stripComments(readFileSync(join(ROOT, 'components/EnterpriseSectorTabs.tsx'), 'utf8'));

describe('the cover', () => {
  it('keeps enterprise-shell on the dark cover and nowhere else', () => {
    expect(PAGE.match(/enterprise-shell/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<section className="enterprise-shell[^"]*bg-forest-950/);
  });
  it('spends the one gold on the request-number stamp', () => {
    expect(PAGE.match(/<Stamp\b/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<Stamp line1="Request" line2="REQ-0000412"/);
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border)-gold-|gold-metal|gold-shine|gold-pan|italic/);
  });
});

describe('the file below', () => {
  it('walks one matter in order', () => {
    const order = ['Intake', 'Review', 'Rooms', 'Signing', 'Packet'].map((s) => PAGE.indexOf(`tab="${s}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('keeps the sector tabs, the case-law review and the inquiry form', () => {
    expect(PAGE).toMatch(/<EnterpriseSectorTabs \/>/);
    expect(PAGE).toMatch(/<Sheet[^>]*>[\s\S]{0,200}<LegalReviewMock \/>/);
    expect(PAGE).toMatch(/<EnterpriseInquiryForm \/>/);
  });
  it('dropped the mocks, the frames and the compare table', () => {
    expect(PAGE).not.toMatch(/BrowserFrame|EsignMock|MeetingsMock|BellaAgentMock|TeamChatMock|IoltaMock|AuditChainMock|DiscoveryMock|CompareTable|FirmDashboardMock|AudienceSplit/);
  });
});

describe('the sector tabs', () => {
  it('are a Courier toggle and definitions, with no gold and no cards', () => {
    expect(TABS).toMatch(/font-courier/);
    expect(TABS).not.toMatch(/gold-|rounded-2xl|rounded-full|backdrop-blur|font-display/);
    expect(TABS).toMatch(/useState<SectorKey>\('firm'\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/firm-front-door.test.ts > /tmp/t7.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t7.log`
Expected: EXIT=1.

- [ ] **Step 3: Restyle the sector tabs**

In `components/EnterpriseSectorTabs.tsx` add `import { Definitions, H2, BODY, LABEL } from '@/components/marketing/file';` and replace the returned JSX (from `return (` at line 184 to the closing `);` before the function's `}`) with:

```tsx
  return (
    <section id="sectors">
      <p className={LABEL}>What kind of team are you?</p>
      <h2 className={`${H2} mt-2`}>The capabilities that matter, sized to your work.</h2>
      <p className={`${BODY} mt-4`}>
        Pick the sector that fits and the list re-orders. The kernel is the same for everyone; the
        call-outs change based on who is buying.
      </p>
      <div role="tablist" aria-label="Choose your sector" className="mt-6 flex flex-wrap border border-forest-900 dark:border-cream-100/70">
        {SECTORS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={sector === s.key}
            type="button"
            onClick={() => setSector(s.key)}
            className={`min-h-[44px] px-4 text-left font-courier text-[12.5px] uppercase tracking-[0.08em] ${
              sector === s.key
                ? 'bg-forest-900 text-cream-50 dark:bg-cream-100 dark:text-forest-950'
                : 'text-forest-900 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10'
            }`}
          >
            {s.label}
            <span className="ml-2 normal-case tracking-normal opacity-70">{s.tagline}</span>
          </button>
        ))}
      </div>
      <Definitions
        columns={3}
        items={features.map((f) => ({
          term: f.primary ? `${f.title}. Top fit` : f.title,
          def: f.body,
        }))}
      />
    </section>
  );
```

- [ ] **Step 4: Rewrite the page between metadata and EnterpriseStructuredData**

Replace the imports at lines 1-5 with:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { EnterpriseInquiryForm } from '@/components/EnterpriseInquiryForm';
import { EnterpriseSectorTabs } from '@/components/EnterpriseSectorTabs';
import { LegalReviewMock } from '@/components/marketing/PortalMocks';
import {
  BODY,
  BUTTON_INK,
  BUTTON_OUTLINE_CREAM,
  Definitions,
  FilePage,
  H1,
  H2,
  LABEL,
  LINK,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '@/components/marketing/file';
```

Then, after `metadata`, the page body:

```tsx
export default function EnterprisePage() {
  return (
    <FilePage>
      <Cover />
      <Step
        tab="Intake"
        n={1}
        title="Client intake without the email ping-pong."
        body="Send a branded intake link. The client uploads their documents, captures the timeline in their words, and you watch the matter populate in real time. By the time you take their call, you have already read the file."
        defs={[
          { term: 'Branded form', def: 'Your domain, your colors.' },
          { term: 'Auto-populated', def: "Case metadata filled from the client's answers." },
          { term: 'Isolated', def: 'The client never sees other matters.' },
        ]}
      />
      <Step
        tab="Review"
        n={2}
        title="Advottic Review reads the file in thirty seconds."
        body="Run Review on a freshly intaked matter. It returns the issues it spotted, the evidentiary gaps, the relevant statutes for the jurisdiction, and the questions worth asking the client. Hourly time goes to judgement, not skimming."
        sheet={
          <Sheet kicker="Advottic Review" kickerRight="Northwind Materials" title="Read in 30 seconds">
            <SheetRow mark="1" text="Trade secret misappropriation: elements present" right="Issue" />
            <SheetRow mark="2" text="No forensic image of the departing laptop" right="Gap" />
            <SheetRow mark="3" text="Which repositories did the engineer clone after notice?" right="Ask" />
          </Sheet>
        }
      />
      <Step
        tab="Rooms"
        n={3}
        title="Counsel, paralegal, client. One room."
        body="Your team adds exhibits and notes. The client adds documents through their scoped view. Pull in signing partners, co-counsel, or opposing counsel for a limited review, time-limited, audited, revocable in one click."
        defs={[
          { term: 'Role-scoped', def: 'Counsel, paralegal, client and co-counsel each see what their role grants.' },
          { term: 'Presence', def: 'Who is in the room, and an activity log of what changed.' },
          { term: 'Revocable', def: 'Guest access ends the moment you end it.' },
        ]}
      />
      <Step
        tab="Signing"
        n={4}
        title="Sign engagement letters, retainers and releases without leaving the vault."
        body="Documents are signed inside the encrypted portal and never sit in a third-party signing tool. Consent is captured before the pad opens, the mark lands on the real signature line, and every event chains to the one before it."
        sheet={
          <Sheet kicker="Counsel, signing" kickerRight="Fully executed">
            <SheetRow mark="NDA" text="Mutual nondisclosure agreement, REQ-0000412" right="Completed" />
            <SheetRow mark="NDA" text="One-way nondisclosure agreement, REQ-0000404" right="Completed" />
            <SheetRow mark="Emp." text="Contractor assignment of work, REQ-0000398" right="Completed" />
          </Sheet>
        }
      />
      <Step
        tab="Packet"
        n={5}
        title="Walk into the deposition with one packet."
        body="When hearing day arrives, export a signed PDF packet with the case summary, numbered exhibits and the question list. Hand it to the printer or upload it to e-filing, or share a read-only link with opposing counsel that expires."
        defs={[
          { term: 'Court-ready', def: 'Narrative first, exhibits lettered, a visible timeline of events.' },
          { term: 'Shareable', def: 'A key-gated link that expires, with a log of who opened it.' },
          { term: 'Yours', def: 'Bulk PDF and JSON export at any time.' },
        ]}
      />
      <Section label="Sectors" id="sectors-section">
        <EnterpriseSectorTabs />
      </Section>
      <Section label="Case law" id="case-law">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0">
            <h2 className={H2}>Case law you can actually cite.</h2>
            <p className={`${BODY} mt-4`}>
              Legal review reads the matter and lays out each claim in full. Every case it surfaces is
              checked against CourtListener first, so nothing unverified ever reaches your brief.
            </p>
            <Definitions
              items={[
                { term: 'Claim by claim', def: 'Elements, statutes and recommended actions for each.' },
                { term: 'Verified first', def: 'Every citation checked against CourtListener before it appears.' },
                { term: 'Dropped, never shown', def: 'An unverified cite does not reach the page.' },
              ]}
            />
          </div>
          <Sheet kicker="Legal review" kickerRight="Northwind Materials">
            <LegalReviewMock />
          </Sheet>
        </div>
      </Section>
      <Ledger />
      <Section label="Security" id="security">
        <h2 className={H2}>Built for firms whose reputation depends on the file being right.</h2>
        <Definitions
          columns={2}
          items={[
            { term: 'Encryption', def: 'AES-256 at rest, TLS 1.3 in transit. Storage in the United States.' },
            { term: 'Identity', def: 'SSO via Microsoft Entra and Google Workspace. No new password, no rogue accounts.' },
            { term: 'Signing', def: 'In-portal document signing. Documents never leave the portal.' },
            { term: 'Audit', def: 'An append-only event log. Every write, sign and export, hash-chained.' },
            { term: 'Privilege', def: 'Built for attorney-client privilege: scoped rooms, audited access, no advertising on your data.' },
          ]}
        />
      </Section>
      <Section label="Talk to us" id="inquiry">
        <h2 className={H2}>See your firm running on Advottic, today.</h2>
        <p className={`${BODY} mt-4`}>
          Tell us the size of the team and the practice areas. We reply with a written proposal and a
          workspace you can try with your own matters.
        </p>
        <div className="mt-8 max-w-2xl">
          <EnterpriseInquiryForm />
        </div>
      </Section>
      <EnterpriseStructuredData />
    </FilePage>
  );
}

/** The forest cover. The one dark surface in the file, because it is the firm product's colour. */
function Cover() {
  return (
    <section className="enterprise-shell -mx-4 bg-forest-950 px-4 pb-14 pt-12 text-cream-100 sm:-mx-6 sm:px-6 sm:pb-20 sm:pt-16 lg:-mx-10 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="min-w-0 lg:col-span-7">
          <p className="font-courier text-[12.5px] uppercase tracking-[0.08em] text-cream-100/60">
            Advottic for firms. In-house. Counsel.
          </p>
          <h1 className={`${H1} mt-3 text-cream-100 dark:text-cream-100`}>
            Stop hunting for the right version of the file.
          </h1>
          <p className="mt-6 max-w-[62ch] font-public text-[17px] leading-[1.55] text-cream-100/80">
            Every matter, one room. Every exhibit, one source of truth. Every attorney, paralegal and
            client on the same page. Sign documents inside the vault. Hand the audit log to opposing
            counsel without flinching.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="#inquiry" className={BUTTON_OUTLINE_CREAM}>
              Tell us about your firm
            </Link>
            <Link href="#sectors" className={`${LINK} text-cream-100 dark:text-cream-100`}>
              See what fits your team
            </Link>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Sheet kicker="Matter file" kickerRight="Commercial, trade secret" title="Northwind Materials v. departed engineer">
            <SheetRow mark="1" text="Intake: client account, 4 attachments" right="Filed" />
            <SheetRow mark="2" text="Review: 347 items read, 247 relevant" right="Done" />
            <SheetRow mark="3" text="Engagement letter" right="Executed" />
            <SheetRow mark="4" text="Deposition packet" right="Draft" />
            <Stamp line1="Request" line2="REQ-0000412" />
          </Sheet>
        </div>
      </div>
    </section>
  );
}

/** One step in the life of a matter. */
function Step({
  tab,
  n,
  title,
  body,
  sheet,
  defs,
}: {
  tab: string;
  n: number;
  title: string;
  body: string;
  sheet?: React.ReactNode;
  defs?: { term: string; def: string }[];
}) {
  return (
    <Section tab={tab} label={`Step ${n} of 5`}>
      <div className={sheet ? 'grid gap-8 lg:grid-cols-2 lg:items-start' : ''}>
        <div className="min-w-0">
          <h2 className={H2}>{title}</h2>
          <p className={`${BODY} mt-4`}>{body}</p>
          {defs && <Definitions items={defs} />}
        </div>
        {sheet && <div className="min-w-0">{sheet}</div>}
      </div>
    </Section>
  );
}

/** Seven tools a firm pays for separately today, as a ledger. */
function Ledger() {
  const rows = [
    ['E-signature', 'Engagement letters, retainers and releases signed inside the vault.'],
    ['Meetings', 'Microsoft Teams and Zoom, wired into every matter.'],
    ['Drafting', 'Bella drafts, files and reconciles from the same tools you would use yourself.'],
    ['Team chat', 'A channel-shaped workspace, scoped to your firm and your matters.'],
    ['Trust accounting', 'Three-way reconciliation, no spreadsheet.'],
    ['Audit', 'Every write, sign and export, hash-chained.'],
    ['Discovery', 'Bulk review with privilege flags.'],
  ];
  return (
    <Section label="Ledger" id="included">
      <h2 className={H2}>Seven tools your firm pays for separately today, inside one workspace.</h2>
      <p className={`${BODY} mt-4`}>
        No signing add-on, no scheduling seat, no separate AI subscription, no trust-accounting plugin.
        Every line below lives inside the same encrypted vault, under the same audit log, scoped to the
        same matter.
      </p>
      <table className="mt-6 w-full border-collapse font-public text-[14px]">
        <tbody>
          {rows.map(([tool, what]) => (
            <tr key={tool}>
              <th scope="row" className={`${LABEL} w-[26%] border-t border-rule py-2.5 pr-3 text-left font-normal align-top`}>
                {tool}
              </th>
              <td className="border-t border-rule py-2.5 pr-3 align-top">{what}</td>
              <td className="w-[12%] border-t border-rule py-2.5 text-right font-courier text-[12px] uppercase tracking-[0.06em] text-ink-600 dark:text-cream-100/60">
                included
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`${BODY} mt-6 text-[15px]`}>
        <Link href="/pricing#savings" className={LINK}>
          Work out what that saves your firm
        </Link>
      </p>
    </Section>
  );
}
```

Delete every function between the old `EnterprisePage` and `EnterpriseStructuredData` that is not `Cover`, `Step` or `Ledger` (ProveTheCase, EnterpriseHero, FirmDashboardMock, Workflow, FirmCapabilities, all the mocks, ProviderCard, ActionChip, ChannelRow, DmRow, ChatMessage, PaperclipIcon, CapabilityFrame, CapabilityCard, Compliance, CompareTable, EnterpriseInquiry, DotEmerald, ArrowRight and any other helper only they used). The Intake definitions use a straight apostrophe, in a double-quoted string: no curly quotes, no em or en dashes.

The Cover keeps `enterprise-shell` so `tests/consumer-live-defects.test.ts` and the dark eyebrow rule hold; the `H1` role carries `text-forest-900`, so the cover's `text-cream-100` override must come after it in the class string as written.

- [ ] **Step 5: Run the guard, its neighbours, and tsc**

Run: `npx vitest run tests/firm-front-door.test.ts tests/consumer-live-defects.test.ts tests/dark-panel-contrast.test.ts tests/accent-text.test.ts > /tmp/t7.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t7.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: all 0. `dark-panel-contrast` reads `components/EnterpriseSectorTabs.tsx` at line 337; if its assertion names a class the restyle removed, read that assertion, keep its INTENT (contrast of the selected tab's tagline) and update the expected class to the new selected-tab classes in the same commit, noting it in the commit body.

- [ ] **Step 6: Mutate, gates, render, commit**

Mutate: add a second `<Stamp line1="x" line2="y" />` in `Ledger`; the stamp test goes red. Restore. Four gates. Render `/enterprise` at both widths and both themes (add `await pg.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'}])` for the second run); the cover must read cream on forest with one gold stamp; the file below must be cream in light and forest-950 in dark. Sweep. Commit:

```bash
git add app/enterprise/page.tsx components/EnterpriseSectorTabs.tsx tests/firm-front-door.test.ts
git commit -m "Set the enterprise page as the firm's front door

A forest cover with the matter file and the request-number stamp as
the page's one gold, then the cream file: five steps in the life of a
matter, the sector tabs as a Courier toggle over definitions, the
case-law review on a sheet, the seven tools as a ledger, security as
definitions, and the inquiry form. The dashboard mock, the seven mock
screens, the compare table and the browser frames are gone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 8: The pages that only inherit

**Files:**
- Create: `components/marketing/file/Prose.tsx` and export it from `components/marketing/file/index.ts`
- Modify (wrapper and headline only, content untouched): `app/about/page.tsx`, `app/what-is-advottic/page.tsx`, `app/security/page.tsx`, `app/guides/page.tsx`, `app/glossary/page.tsx`, `app/compare/page.tsx`, `app/press/page.tsx`, `app/changelog/page.tsx`, `app/status/page.tsx`, `app/accessibility/page.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/cookies/page.tsx`, `app/dmca/page.tsx`
- Test: `tests/inheriting-pages-wear-the-file.test.ts`

**Interfaces:**
- Consumes: `FilePage`, `Section`, `H1`, `LABEL` from `components/marketing/file`.
- Produces: `Prose({ label: string, title: string, lede?: string, children })`: paper ground, a first `Section` carrying the page's `h1`, then the page's existing content in a 72ch measure.

- [ ] **Step 1: Write the failing guard**

```ts
// tests/inheriting-pages-wear-the-file.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Pages that are not redesigned still wear the file: the paper ground,
 * the Caslon h1, no fade-up reveal. Content is untouched, so this asserts
 * the wrapper CALL and the absence of the retired classes, nothing else.
 */
const ROOT = join(__dirname, '..');
const PAGES = [
  'about', 'what-is-advottic', 'security', 'guides', 'glossary', 'compare', 'press',
  'changelog', 'status', 'accessibility', 'terms', 'privacy', 'cookies', 'dmca',
];

describe.each(PAGES)('app/%s/page.tsx', (p) => {
  const src = stripComments(readFileSync(join(ROOT, `app/${p}/page.tsx`), 'utf8'));
  it('renders through Prose', () => {
    expect(src).toMatch(/<Prose\b[^>]*label=/);
    expect(src).toMatch(/from '@\/components\/marketing\/file'/);
  });
  it('has no scroll reveal and no display-face h1 of its own', () => {
    expect(src).not.toMatch(/animate-fade-up/);
    expect(src).not.toMatch(/<h1[^>]*font-display/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/inheriting-pages-wear-the-file.test.ts > /tmp/t8.log 2>&1; echo EXIT=$?; grep -a -c '×' /tmp/t8.log`
Expected: EXIT=1, 28 red.

- [ ] **Step 3: Write Prose**

```tsx
// components/marketing/file/Prose.tsx
import type { ReactNode } from 'react';
import { FilePage } from './FilePage';
import { Section } from './Section';
import { BODY, H1 } from './type';

/**
 * The wrapper for pages that inherit the file without a redesign: about,
 * security, guides, the legal pages. The page's own h1 moves into the
 * first Section; everything the page already rendered follows in a 72ch
 * measure with the existing content untouched.
 */
export function Prose({
  label,
  title,
  lede,
  children,
}: {
  label: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <FilePage>
      <Section label={label} first>
        <h1 className={H1}>{title}</h1>
        {lede && <p className={`${BODY} mt-5`}>{lede}</p>}
      </Section>
      <Section label="">
        <div className="max-w-[72ch] font-public text-[16px] leading-[1.6] text-ink-700 dark:text-cream-100/80 [&_h2]:font-caslon [&_h2]:text-[28px] [&_h2]:leading-[1.15] [&_h2]:text-forest-900 [&_h2]:dark:text-cream-100 [&_h3]:font-public [&_h3]:text-[17px] [&_h3]:font-semibold [&_a]:underline [&_a]:underline-offset-4">
          {children}
        </div>
      </Section>
    </FilePage>
  );
}
```

Add `export { Prose } from './Prose';` to `components/marketing/file/index.ts`.

- [ ] **Step 4: Wrap each page**

For each of the fourteen pages, the same three edits and nothing else:

1. Add `import { Prose } from '@/components/marketing/file';`.
2. Find the page's `<h1 ...>TEXT</h1>`. Remove that element and, if there is a `.eyebrow` paragraph directly above it, remove that too (its text becomes `label`). If a lede paragraph sits directly under the h1 with no heading between, move its text to `lede`.
3. Replace the outermost wrapper element of the returned JSX (for example `<div className="max-w-4xl mx-auto space-y-10 animate-fade-up">` on about, `<article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 ...">` on what-is-advottic) with `<Prose label="..." title="TEXT" lede="...">` and its closing tag with `</Prose>`, keeping every child in between exactly as it was. Labels: about "About", what-is-advottic "Definition", security "Security", guides "Guides", glossary "Glossary", compare "Compare", press "Press", changelog "Changelog", status "Status", accessibility "Accessibility", terms "Terms", privacy "Privacy", cookies "Cookies", dmca "DMCA".

Pages with structured data components (`BreadcrumbJsonLd`, `FaqJsonLd`, `ArticleJsonLd` and the like) keep them as children; they render nothing visible. `app/changelog/page.tsx` is also rendered by `tests/marketing-routes-in-the-app.test.ts` through `renderToStaticMarkup`; `Prose` is a server component with no hooks, so that still works. If a page's h1 carries JSX (a `<span>` inside), pass the plain text to `title` and drop the span.

- [ ] **Step 5: Run the guard and tsc, then gates**

Run: `npx vitest run tests/inheriting-pages-wear-the-file.test.ts tests/marketing-routes-in-the-app.test.ts > /tmp/t8.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t8.log; npx tsc --noEmit > /tmp/tsc.log 2>&1; echo TSC_EXIT=$?`
Expected: all 0. Then the four gates.

- [ ] **Step 6: Render every one and look**

Render all fourteen at 390px in light (the Task 3 script with a path loop) and READ each: the page h1 in Caslon on paper, content in the measure, nothing clipped, no sideways scroll. Fix any page whose content used a wide table without `overflow-x-auto` by wrapping that table in `<div className="overflow-x-auto">` (content unchanged, one wrapper).

- [ ] **Step 7: Mutate, sweep, commit**

Mutate: put `animate-fade-up` back on `app/about/page.tsx`'s Prose; the about test goes red. Restore. Sweep only the lines you changed (`git diff -U0 | grep '^+' | python3 -c "import re,sys;p=re.compile('[\u2013\u2014]');print(sum(len(p.findall(l)) for l in sys.stdin))"`), expected 0. Commit:

```bash
git add components/marketing/file/Prose.tsx components/marketing/file/index.ts app/about/page.tsx app/what-is-advottic/page.tsx app/security/page.tsx app/guides/page.tsx app/glossary/page.tsx app/compare/page.tsx app/press/page.tsx app/changelog/page.tsx app/status/page.tsx app/accessibility/page.tsx app/terms/page.tsx app/privacy/page.tsx app/cookies/page.tsx app/dmca/page.tsx tests/inheriting-pages-wear-the-file.test.ts
git commit -m "Let the fourteen inheriting pages wear the file

A Prose wrapper carries the paper ground, the Caslon h1 and a 72ch
measure; each page's content is untouched and its scroll reveal is
gone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 9: The site-wide guards and the design docs

**Files:**
- Create: `tests/marketing-type-roles.test.ts`, `tests/marketing-no-cards.test.ts`, `tests/home-faq-jsonld-matches.test.ts`, `tests/cover-motion-is-one-and-reducible.test.ts`, `tests/marketing-no-dashes.test.ts`
- Modify: `docs/DESIGN.md` (the `## Type` section) and `docs/DESIGN_SYSTEM.md` (one paragraph after the ONE-LINER)

**Interfaces:**
- Consumes: the finished pages from Tasks 3 to 8; `HOME_FAQ` from `app/page.tsx`.

- [ ] **Step 1: Write the five guards**

```ts
// tests/marketing-type-roles.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** Only the four case-file faces appear on marketing surfaces. */
const ROOT = join(__dirname, '..');
const FILES = [
  'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
  'components/marketing/FeatureIndex.tsx', 'components/EnterpriseSectorTabs.tsx',
  'components/marketing/file/type.ts', 'components/marketing/file/Section.tsx',
  'components/marketing/file/Sheet.tsx', 'components/marketing/file/Definitions.tsx',
  'components/marketing/file/Schedule.tsx', 'components/marketing/file/FilePage.tsx',
  'components/marketing/file/Prose.tsx',
];
describe.each(FILES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('never reaches for Fraunces, Inter, a serif or a mono class', () => {
    expect(src).not.toMatch(/\bfont-(?:display|sans|serif|mono|wordmark)\b/);
  });
  it('uses at least one of the four roles', () => {
    expect(src).toMatch(/font-(?:caslon|caslon-text|public|courier)|\b(?:H1|H2|BODY|LABEL)\b/);
  });
});
```

```ts
// tests/marketing-no-cards.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** The four pages carry no card grids, frames, photographs or marquee. */
const ROOT = join(__dirname, '..');
const PAGES = ['app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx', 'components/marketing/FeatureIndex.tsx'];
describe.each(PAGES)('%s', (rel) => {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  it('has no card, frame, photo or marquee', () => {
    expect(src).not.toMatch(/rounded-(?:2xl|3xl|full)|className="card|BrowserFrame|SectionPhoto|TestimonialMarquee|FeatureGallery|<Image\b|<img\b/);
  });
});
```

```ts
// tests/home-faq-jsonld-matches.test.ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FaqJsonLd } from '../components/seo/JsonLd';
import { HOME_FAQ } from '../app/page';

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
```

If importing `app/page.tsx` in a test pulls Supabase server helpers that throw at import time, move `HOME_FAQ` to `lib/home-faq.ts` (export it from there, import it in `app/page.tsx`, and update this test and the `cover-accent-discipline` regex `^export const HOME_FAQ` to `^import \{ HOME_FAQ \}`). That is the only acceptable deviation.

```ts
// tests/cover-motion-is-one-and-reducible.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/** One motion on the marketing site, and reduced motion removes it. */
const ROOT = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));
describe('the one motion', () => {
  it('is the home cover sheet, opted in exactly once across marketing', () => {
    const all = ['app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx', 'components/marketing/FeatureIndex.tsx']
      .map(read).join('\n');
    expect(all.match(/\bassemble\b/g)?.length).toBe(1);
    expect(all).not.toMatch(/animate-|stagger|gold-pan|shimmer|transition-transform/);
  });
  it('is removed, not reduced, under prefers-reduced-motion', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.file-assemble > \[data-row\],\s*\.file-assemble \[data-stamp\] \{([\s\S]*?)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/animation: none;/);
  });
});
```

```ts
// tests/marketing-no-dashes.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No em dash, en dash or emoji in marketing source. The positive control
 * proves the pattern matches; three silent no-match sweeps have shipped.
 */
const ROOT = join(__dirname, '..');
const PATTERN = /[\u2013\u2014]|[\u{1F300}-\u{1FAFF}]/u;
const FILES = [
  'app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/enterprise/page.tsx',
  'components/marketing/FeatureIndex.tsx', 'components/EnterpriseSectorTabs.tsx',
  'components/marketing/file/type.ts', 'components/marketing/file/Section.tsx',
  'components/marketing/file/Sheet.tsx', 'components/marketing/file/Definitions.tsx',
  'components/marketing/file/Schedule.tsx', 'components/marketing/file/FilePage.tsx',
  'components/marketing/file/Prose.tsx',
];
describe('the dash sweep', () => {
  it('positive control: the pattern matches', () => {
    expect(PATTERN.test('a \u2014 b')).toBe(true);
    expect(PATTERN.test('a \u2013 b')).toBe(true);
    expect(PATTERN.test('\u{1F600}')).toBe(true);
  });
  it.each(FILES)('%s is clean', (rel) => {
    expect(readFileSync(join(ROOT, rel), 'utf8')).not.toMatch(PATTERN);
  });
});
```

- [ ] **Step 2: Run them; they should be green on the finished pages**

Run: `npx vitest run tests/marketing-type-roles.test.ts tests/marketing-no-cards.test.ts tests/home-faq-jsonld-matches.test.ts tests/cover-motion-is-one-and-reducible.test.ts tests/marketing-no-dashes.test.ts > /tmp/t9.log 2>&1; echo EXIT=$?; grep -a -E '×|Tests ' /tmp/t9.log`
Expected: EXIT=0. A red here is a defect in Tasks 3 to 8, not in the guard: fix the page.

- [ ] **Step 3: Mutate every guard**

One mutation each, watch red, restore: add `font-display` to `Section.tsx` (type roles); add `rounded-2xl` to `app/features/page.tsx` (no cards); push a seventh entry onto `HOME_FAQ` (faq); add `assemble` to the pricing schedule's Sheet call (motion); type an em dash into a `Definitions` term on the home page (dashes). `git diff --stat` empty after.

- [ ] **Step 4: Amend the design docs**

In `docs/DESIGN.md`, replace the `## Type` section (from `## Type` to the line before `## Layout`) with:

```markdown
## Type

Four roles on the public marketing site, four faces, spelled once in
`components/marketing/file/type.ts`:

| role | face | where |
| --- | --- | --- |
| display | Libre Caslon Display (`font-caslon`) | h1 and section h2 only |
| quote | Libre Caslon Text italic (`font-caslon-text`) | pull quotes, sheet titles |
| reading | Public Sans (`font-public`) | body, controls, nav |
| utility | Courier Prime (`font-courier`) | labels, dates, exhibit letters, eyebrows |

Caslon is the face of American legal documents, Public Sans the civic
reading face, Courier what court filings are set in. The signed-in shells
keep Inter and Fraunces until their own spec.

- Body copy sits near 65 characters. Wider is unreadable, and a legal audience
  reads carefully.
- Headings take `text-wrap: balance`.
- Numbers that line up in a column take `tabular-nums`. Always.
- Courier is never body text and never a headline. The display face is never
  italic for emphasis and never gold.
- `font-serif` is reserved for rendered documents, where it means "this is
  the instrument".

**A status is not a headline.** Headline type is for names of things.
Sentences are body.

**Rules instead of cards, and one gold per screen.** Sections are separated by
one ink rule and carry a tab column; product is shown on paper sheets, not in
browser frames; the accent is a single stamp per page. The full spec is
`docs/superpowers/specs/2026-09-05-marketing-case-file-design.md`.

```

In `docs/DESIGN_SYSTEM.md`, directly under the `## ONE-LINER` blockquote, add:

```markdown
> Note (2026-09): the public marketing site no longer uses Inter and Fraunces.
> It is set as "the case file" (Libre Caslon Display, Public Sans, Courier
> Prime, paper ground, ruled sections, one gold stamp per page). See
> `docs/DESIGN.md` and `docs/superpowers/specs/2026-09-05-marketing-case-file-design.md`.
> The recipes below still describe the signed-in product.
```

Also add to the end of `docs/DESIGN.md` a short list titled `## Retired, still on disk` naming `components/AudienceSplit.tsx`, `components/FeatureGallery.tsx`, `components/TestimonialMarquee.tsx`, `components/TechTrustStrip.tsx`, `components/AboutTeaser.tsx`, `components/BellaAvatar.tsx`, `components/marketing/SectionPhoto.tsx`, `components/marketing/FeatureSheet.tsx`, `components/marketing/ApprovalToExecuted.tsx`, `components/marketing/ProductShowcaseBand.tsx` as no longer imported by any page after this redesign (verify each with `grep -rn "<Name" app components | grep -v "components/Name"` before listing it; drop any that still has a consumer). Deleting them is a separate, later change.

- [ ] **Step 5: Gates, sweep, commit**

Four gates. Dash sweep over the two docs and the five tests. Commit:

```bash
git add tests/marketing-type-roles.test.ts tests/marketing-no-cards.test.ts tests/home-faq-jsonld-matches.test.ts tests/cover-motion-is-one-and-reducible.test.ts tests/marketing-no-dashes.test.ts docs/DESIGN.md docs/DESIGN_SYSTEM.md
git commit -m "Guard the case file and amend the design docs

Five source-reading guards, each mutation-proven: the four type roles,
no cards or frames, the FAQ array feeding both list and JSON-LD, one
motion removed under reduced motion, and a dash sweep with a positive
control. docs/DESIGN.md carries the four roles; DESIGN_SYSTEM.md points
at it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git show --stat --oneline HEAD
```

---

### Task 10: The render audit and the pull request

**Files:**
- Create: `scripts/design/render-marketing.cjs`
- Create: `docs/superpowers/plans/2026-09-05-marketing-case-file-render-notes.md`

- [ ] **Step 1: Write the render script**

```js
// scripts/design/render-marketing.cjs
// Renders every marketing page at 1440 and 390, light and dark, from a
// local `next start`, and writes PNGs plus a sideways-scroll report.
// Usage: node scripts/design/render-marketing.cjs http://localhost:3111 /tmp/shots
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const [base, out] = process.argv.slice(2);
const PATHS = ['/', '/pricing', '/features', '/enterprise', '/about', '/what-is-advottic', '/security', '/guides', '/glossary', '/compare', '/press', '/changelog', '/status', '/accessibility', '/terms', '/privacy', '/cookies', '/dmca'];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const report = [];
  for (const scheme of ['light', 'dark']) {
    for (const [name, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      for (const p of PATHS) {
        await page.goto(base + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (/got it/i.test(b.textContent || '')) b.click(); }));
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        const stamps = await page.evaluate(() => document.querySelectorAll('[data-stamp]').length);
        const file = `${out}/${scheme}-${name}${p === '/' ? '-home' : p.replace(/\//g, '-')}.png`;
        await page.screenshot({ path: file, fullPage: true });
        report.push(`${scheme} ${name} ${p} stamps=${stamps} ${sideways ? 'SIDEWAYS SCROLL' : 'ok'}`);
      }
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log(report.join('\n'));
})().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Build, serve, render, read**

Run: `npm run build > /tmp/b.log 2>&1; echo BUILD_EXIT=$?; (npx next start -p 3111 > /tmp/next.log 2>&1 &); sleep 6; node scripts/design/render-marketing.cjs http://localhost:3111 /tmp/shots; pkill -f "next start -p 3111"`
Expected: 72 lines, every one `ok`, `stamps=1` on `/`, `/pricing`, `/enterprise` and `stamps=0` elsewhere. Then Read at least: both themes of the home page at both widths, pricing desk light, features phone light, enterprise desk dark, about phone light. For each, check the five items of the DESIGN.md "done" list. Write what was seen, and anything fixed, into `docs/superpowers/plans/2026-09-05-marketing-case-file-render-notes.md` as a dated list (one line per page and theme). Any fix goes through its own task's guard and the four gates before the next render.

- [ ] **Step 3: Commit and open the pull request**

```bash
git add scripts/design/render-marketing.cjs docs/superpowers/plans/2026-09-05-marketing-case-file-render-notes.md
git commit -m "Add the marketing render audit and its notes

Every marketing page at two widths and two themes from a local build,
with a stamp count and a sideways-scroll check per page.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin design/marketing-case-file
gh pr create --base main --head design/marketing-case-file --title "Set the marketing site as the case file" --body-file - <<'PR'
## What

The public site is rebuilt as "the case file", per docs/superpowers/specs/2026-09-05-marketing-case-file-design.md: Libre Caslon Display, Public Sans and Courier Prime on a paper ground; ruled sections with a binder tab column; product shown on paper sheets; one gold stamp per page. Home, pricing, features and enterprise are rewritten; header and footer are restyled; fourteen pages inherit through a Prose wrapper with content untouched. The signed-in app, counsel, portal and HQ are not touched.

## Verification

- tsc, vitest, build and audit guards exit 0 on every commit.
- Nine new guards, each mutation-proven; hero-accent-discipline is replaced by cover-accent-discipline.
- Every marketing page rendered at 1440 and 390, light and dark, from a local build (scripts/design/render-marketing.cjs); notes in the render-notes file.

## Before merging

Open the Vercel preview on a phone and look at the home, pricing and enterprise pages. Merging and the production deploy are the owner's call.
PR
```

The PR body deliberately omits the "Generated with Claude Code" footer, per the user's global CLAUDE.md.

---

## Self-review

**Spec coverage.** 2.1 type roles: Task 1 (fonts), Task 2 (`type.ts`), Task 9 (guard, DESIGN.md). 2.2 colour and dark theme: Task 1. 2.3 primitives: Task 2, Prose in Task 8. 2.4 motion: Task 1 (CSS), Task 3 (cover), Task 9 (guard). 2.5 copy: reused throughout; dash guard Task 9. Section 3 home blocks and cuts: Task 3. Section 4 pricing: Task 5. Section 5 features: Task 6. Section 6 enterprise: Task 7. Section 7 header, footer, inheriting, untouched: Tasks 4 and 8. Section 8 guards: Tasks 3, 4, 5, 6, 7, 8, 9. Section 9 verification: every task's gate steps plus Task 10. Section 10 delivery order: matches Tasks 1 to 10. Section 11 out of scope: no task touches those paths.

**Placeholder scan.** The only bracketed instructions are "[paste the existing SITE_URL constant and metadata here]" in Tasks 3 and 6, which refer to verbatim existing lines by number; no TBD or TODO.

**Type consistency.** `Sheet` props (`kicker`, `kickerRight`, `title`, `assemble`, `className`) are used identically in Tasks 3, 5, 6, 7. `SheetRow` props (`mark`, `text`, `right`) likewise. `Stamp` (`line1`, `line2`) likewise. `Section` (`tab`, `label`, `first`, `id`) likewise. `Definitions` (`items`, `columns`) likewise. `Schedule` (`columns`, `rows`, `stampOn`, `stamp`) matches its type in Task 2 and its use in Task 5. `Prose` (`label`, `title`, `lede`) matches Task 8. The guard in Task 7 expects `<Stamp line1="Request" line2="REQ-0000412"`, which is what the enterprise cover renders.
