# 2026-09-05 marketing case file: render audit notes (rendered 2026-09-15,
re-rendered 2026-09-19 after the final fix wave; see the last section, which
corrects three readings below)

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

---

## Re-run 2026-09-19, after the final fix wave

Run it with `npm run design:render -- http://localhost:3111 /tmp/shots`.
The script is wired into `package.json` now, so it is discoverable and
nothing has to remember the path.

### What the script reports that it did not before

- **A failed navigation is a line in the report.** `page.goto` used to end
  in `.catch(() => {})`, so a timeout or a 500 left whatever was on screen
  from the previous path and reported `stamps=0 ok` from it. The audit is
  the only thing that looks at fourteen of these pages, so a silent pass was
  the expensive failure. The script reports `NAV FAILED: <reason>` now and
  also checks `response.ok()`.
- **A crude contrast probe.** For every `h1`, `[data-stamp]` and
  `[data-row]`, each text-bearing element's computed colour, with its own
  and its ancestors' `opacity` folded in, is composited over the nearest
  ancestor that actually paints a background, and anything under 4.5:1 is
  reported. It exists because the enterprise cover shipped near-black ink on
  a dark sheet at about 1.3:1, in a capture that was taken and not read.
  Colours are resolved by painting them into a 1x1 canvas rather than by
  parsing the string: `text-accent-text` computes to
  `oklch(0.84 0.078 87.36)`, and the first version of the probe read three
  numbers out of that, called the gold stamp near-black and reported a
  1.25:1 that is really about 9:1. A probe that cries wolf is worse than no
  probe, so this was found and fixed before the numbers were believed.
- **A stamp-overlap check** on the text's own run rectangles (a `Range`),
  not on element boxes: a block element's box runs the full column width, so
  measuring boxes said the pricing stamp covered "Pro" when it sits well to
  the right of the word. The stamp's own box is still an axis-aligned box
  around a rotated element, so it over-reports slightly, which is the safe
  side.
- **A truncation report.** `SheetRow` truncates its middle column on purpose
  so a long filename cannot widen the sheet, so a hit is a copy length to
  weigh rather than a defect on its own. It is reported because a citation
  cut at "Electro-Craft Corp. v. Con..." looked exactly like the deliberate
  ones until somebody read the capture.

### Three readings in the notes above were wrong

The captures were read for structure and gold count, and the stamp's
position was taken on trust three times. On the rendered page:

- "the cover Sheet's stamp sits clear of row D" (home, light, 1440) and the
  same claim at 390 are both false. The stamp covered "Apr 9, 2025" at 1440
  and both dates below row B at 390.
- "clear of the Draft row above it" (enterprise, dark, 1440) is false. At
  `pb-16` the stamp crossed "Draft" on row 4 at 1440, 1024 and 390.

Both covers reserve the stamp's space with `pb-24 sm:pb-24` now, and the
overlap check is what would catch it coming back.

### The 2026-09-19 report

72 lines. No `SIDEWAYS SCROLL`, no `NAV FAILED`, no `LOW CONTRAST`, no
`STAMP OVER`. `stamps=1` on `/`, `/pricing` and `/enterprise` at both
widths in both themes, `stamps=0` on the other fifteen paths.

Twelve lines carry `TRUNCATED`, and all twelve are `SheetRow` middle
columns doing what `truncate` is there for: the home cover's four exhibit
rows, the same four on the features page, the enterprise cover's first two
rows and the three Review and Signing rows. Nothing is hidden that the page
does not also say elsewhere, and no line truncates a number, a date or a
status. It is left as an open question for the owner rather than fixed
here: at 1440 the two covers never show a row's full text, which is
plausible for a file index and may still be worth shortening the sample
copy for.

### Captures read

- **Enterprise, light, 1440** (the one C2 was visible in and nobody
  opened): the cover is real forest `rgb(10, 31, 25)`, full bleed from 0 to
  1440, the matter-file sheet is cream Courier on the dark sheet
  `rgb(15, 45, 36)` and reads cleanly, the gold `REQ-0000412` stamp sits
  clear of row 4, and the cover h1's left edge is 165px, the same as the
  "Intake" section label below it. Measured at 1440, 1200, 1100 and 390: h1
  and section label at 165/45/45/18 respectively, equal at every width, and
  the cover is 1440/1200/1100/390 wide, so the bleed holds.
- **Enterprise, light, 390**: same cover, single column, sheet legible,
  stamp clear of "Deposition packet / Draft", section below on cream.
- **Enterprise case law, light, 1440**: the citation sheet reads in full,
  "Electro-Craft Corp. v. Controlled Motion, Inc., 332 N.W.2d 890 (Minn.
  1983)." over "Unverified citations never reach the page."
- **Pricing, light, 1440**, both schedules: every cell carries a real value
  (the table text is in the fix-wave report). One gold, the "Most chosen"
  stamp over the Pro column, clear of the word.
- **Home, light, 1440 and 390**: the cover stamp no longer covers the
  dates.

### An open finding, not fixed here

`components/EnterpriseInquiryForm.tsx` gives /enterprise a second gold: a
`bg-gold-metal` submit button ("Request a walkthrough", measured
`rgb(199, 149, 50)` over a gold gradient), `text-gold-300` field labels and
`focus:ring-gold-400`. The spec says buttons are ink on paper or cream on
forest, never gold. It is pre-existing rather than new on this branch, and
it is invisible to every guard for the same reason `LegalReviewMock` was:
the guards read page source and do not follow an import. It is written into
the header of `tests/cover-accent-discipline.test.ts` so it is not true by
omission, and it needs an owner's decision.
