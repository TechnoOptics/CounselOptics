# 2026-09-05 marketing case file: render audit notes (rendered 2026-09-15)

Rendered every marketing page at 1440 and 390, light and dark, from a local
`next start -p 3111` build, via `scripts/design/render-marketing.cjs` and
`puppeteer-core` against system Chrome. This worktree has no Supabase
environment, so every route throws the global error boundary under
`next start` unless placeholder credentials are exported in the shell first
(per the Task 7 report's method, not committed anywhere):

```
export NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
```

## Report summary

72 lines, every one `ok` (no sideways scroll at either width, in either
theme). Stamp count is 1 on `/`, `/pricing` and `/enterprise`, 0 everywhere
else, matching the brief's expected result exactly. Full report:
`/tmp/shots/report.txt` (not committed; a build artifact, regenerate with the
script).

## Two adjustments to the brief's script

1. **Visible stamps, not all `[data-stamp]` nodes.** The pricing page's
   `Schedule` renders two `[data-stamp]` DOM nodes at once: one inside the
   desk table's `hidden overflow-x-auto sm:block` container, one inside the
   phone fallback's `grid gap-4 sm:hidden` (`components/marketing/file/Schedule.tsx`
   lines 47 and 95). They are mutually exclusive by breakpoint, so a reader
   only ever sees one. Counting every `[data-stamp]` node would report
   `stamps=2` on pricing at every width. The script instead walks each
   node's ancestor chain and counts it only when neither the node nor any
   ancestor computes `display: none`, so the report reflects what a reader
   actually sees.

2. **Emulate `prefers-reduced-motion: reduce` on every capture.** The cover's
   one motion (`app/globals.css`, `.file-assemble` / `file-stamp`) holds the
   gold stamp at `opacity: 0` for a 640ms delay before a 400ms fade-in, so a
   screenshot taken immediately after navigation can race the animation and
   capture the stamp mid-fade. This is invisible to the `stamps=` count
   (the DOM node exists and is not `display: none`; only its opacity is
   momentarily 0) and does not show up as `SIDEWAYS SCROLL`, so the report
   line reads `ok` while the actual PNG shows a blank corner where the stamp
   belongs. Confirmed by direct reproduction: `getComputedStyle(stamp).opacity`
   read `"0"` immediately after the click-through-cookie-banner step on a
   `dark desk /` capture, and the rendered pixels at that region were plain
   background with no gold present. The site's own CSS already defines the
   reduced-motion behavior as landing directly on the final state ("Reduced
   motion means none, not less" per `app/globals.css`), so emulating
   `prefers-reduced-motion: reduce` alongside `prefers-color-scheme` removes
   the race instead of papering over it with an arbitrary sleep. Re-rendered
   after the fix: `dark desk /`'s stamp region shows the full "HEARING / APR
   18" stamp, gold border and ink, matching light mode's rendering.
   Re-confirmed the fix is real (not a fluke) by reproducing the failure
   first without the emulation, then again with it, three times.
   By emulating reduced motion, the audit never captures the animated or
   mid-fade state. This trade-off is acceptable because the audit's purpose
   is to verify layout and the gold-count value, while motion behavior is
   guarded separately by `tests/cover-motion-is-one-and-reducible.test.ts`
   from Task 9.

No page, component, or test file changed. This was a defect in the render
script's own timing, not in `app/page.tsx` or `components/marketing/file/`,
so no task's guard applies and only the four project-wide gates were run
(all listed below).

A third, pre-existing behavior worth recording rather than fixing: ThemeBoot
(`components/ThemeBoot.tsx`) resolves an unauthenticated visitor's theme as
`stored || server || 'system'`, and the marketing layout's server default is
always `'light'`, so `prefers-color-scheme` emulation alone never produces a
dark render for these pages (this matches what Task 7 and Task 8 found and
worked around). The script sets the `advottic-theme` localStorage key
directly via `page.evaluateOnNewDocument` before each navigation so the two
schemes are actually two different renders, not two light ones labeled
differently.

## The eight captures, read against DESIGN.md's five-item "done" list

1. Rendered and looked. 2. Looked at it in the other theme. 3. Looked at it
at 375px (390, the closest breakpoint this script uses). 4. Confirmed
nothing but the page scrolls. 5. Confirmed the accent (the gold stamp) is
spent once.

- **Home, light, 1440** (`light-desk-home.png`): cover Sheet renders all
  four rows plus the one gold "Hearing / Apr 18" stamp, rotated, clear of
  row D. Sections A through E walk in order with their lettered kickers,
  three-column definitions, the two-sheet "what comes out" block, the three
  pull quotes, and the FAQ accordion. Footer and firm-teaser band render on
  the paper ground. Only the page scrolls; no sideways scroll. Accent spent
  once (the cover stamp only).
- **Home, dark, 1440** (`dark-desk-home.png`): same structure, forest-950
  background with cream ink throughout. The cover stamp is now confirmed
  visible (see the emulation fix above) with the same gold border and dark
  gold-ink text `Stamp` uses for readability on paper (`text-accent-text`),
  correctly re-tinted for the dark background. No sideways scroll. Accent
  spent once.
- **Home, light, 390** (`light-phone-home.png`): single column, the sector
  definitions and quotes stack to one column, the cover Sheet's stamp sits
  clear of row D at the narrow width too. Only the page scrolls. Accent
  spent once.
- **Home, dark, 390** (`dark-phone-home.png`): same layout in dark, cover
  stamp visible and correctly positioned. Only the page scrolls. Accent
  spent once.
- **Pricing, light, 1440** (`light-desk-pricing.png`): both schedules (for
  one person, for firms) render as ruled tables, not cards. The one gold
  stamp ("Most Chosen") sits above the Pro column, rotated, clear of the
  header row and the price row below it. The savings calculator, discounts,
  add-ons, gift block and FAQ accordion all render below the fold. Only the
  page scrolls; no sideways scroll on the wide fee tables (they are the
  desk view, not the horizontally-scrolling table container used at
  narrower widths).
- **Features, light, 390** (`light-phone-features.png`): the full feature
  index (lettered sections A through H: overview, capture, review, safe
  witness, ask, community, export, security) renders as stacked
  term/description rows, single column, no cards. No stamp expected or
  present (`stamps=0`). Only the page scrolls.
- **Enterprise, dark, 1440** (`dark-desk-enterprise.png`): the cover is
  confirmed theme-invariant (cream text on forest-950 in both themes, per
  the Task 7 report), so the surrounding dark theme mostly changes the file
  sections below it, which correctly flip to forest-950/cream. The one gold
  stamp ("Request / REQ-0000412") is legible, rotated, clear of the "Draft"
  row above it. Sector tabs, case law, ledger and security sections all
  render in order. Only the page scrolls.
- **About, light, 390** (`light-phone-about.png`): the canonical "What
  Advottic is, and isn't" page (`app/about/page.tsx`) inherits through the
  `Prose` wrapper. Single column, ruled sections, no cards, no stamp
  (`stamps=0`, correct: only the home, pricing and enterprise pages carry
  the one-stamp motif). Only the page scrolls.

Nothing else looked wrong in these eight beyond the stamp-timing race
already covered above, which the script fix resolves.

## Fixes made

None to any page or component. The only fix was to the render script itself
(the two adjustments above), which is a new file this task adds, not an
earlier task's guarded surface. No task guard applies; the four project
gates below cover it.

## Four gates (all before commit)

```
npx tsc --noEmit > /tmp/t.log 2>&1; echo TSC_EXIT=$?              TSC_EXIT=0
npx vitest run > /tmp/v.log 2>&1; echo VITEST_EXIT=$?             VITEST_EXIT=0 (343 files, 5600 passed, 1 skipped)
npm run build > /tmp/b.log 2>&1; echo BUILD_EXIT=$?               BUILD_EXIT=0
npm run test:audit-guards > /tmp/g.log 2>&1; echo GUARDS_EXIT=$?  GUARDS_EXIT=0
```

## Dash and emoji sweep

Ran the project's standard positive-control sweep (em dash, en dash and
emoji pattern against the staged diff's added lines) before committing:
`control 1`, `hits 0`. The command itself is not reproduced verbatim here
because its own regex and control string contain the literal characters
it is checking for, which would make this file fail its own sweep.
