# Counsel light mode: sizing spike

Branch `spike/counsel-light`, based on `main` at `91827319`.
Run 2026-08-01. No production code changed. The harness used to produce the
screenshots was deleted before this commit.

The question: the owner wants the counsel and employee-portal surfaces to read
light, like techottic.com (`#f6f6f7` ground, `#ffffff` surface, `#17171b` ink).
The counsel shell hardcodes `dark`. Does removing that class get us most of the
way for free?

## Answer in one paragraph

No, but the job is also not a 130-file rewrite. The hypothesis assumed the
shell's darkness comes from the 2044 `dark:` variants, so that dropping the root
class would let 2044 already-written light values through. It does not. The
shell's darkness is painted almost entirely by counsel-scoped CSS in
`app/globals.css` that never looks at the root class: a design-token ramp swap
plus 36 compiled rules that hardcode near-black. I flipped the class on a live
page mounting real counsel components and measured every rendered element:
**of 166 elements in the shell, 9 changed, and zero of them changed background
colour.** The naive flip is a no-op that breaks four things. The real job is
concentrated in one CSS file, not spread across 130 component files: the 803
dark-assuming utilities collapse to **118 distinct class spellings**, 58 of
which need no rule at all because they are driven by a CSS variable the shell
already owns.

## 1. Dark-assuming classes with no light counterpart

Method: every string literal in `app/counsel`, `app/portal` and
`components/counsel` (213 `.ts`/`.tsx` files) was tokenised, each colour utility
parsed into variant / property / colour / shade / alpha, and classified against
the ramp semantics that actually apply inside `.counsel-shell` (where the
`forest` scale is remapped to zinc, so `forest-950` is near black and
`forest-50` is near white). A token counts as dark-assuming when it is applied
unconditionally (no `dark:` variant) and its value only works on a dark ground.
Tokens carrying a `dark:` variant are excluded: those disappear cleanly with the
root class, which is the one part of the hypothesis that holds.

| Measure | Count |
| --- | --- |
| Colour utility tokens in scope | 5264 |
| Carrying a `dark:` variant (disappear cleanly) | 2026 |
| **Dark-assuming, no light counterpart** | **803** |
| Files carrying at least one | 84 of 171 |
| Distinct class spellings behind those 803 | **118** |

### By kind

| Kind | Tokens | Distinct spellings |
| --- | --- | --- |
| Text (incl. `fill`/`stroke`) | 469 | 27 |
| Background | 203 | 51 |
| Border | 79 | 17 |
| Ring / outline | 50 | 19 |
| Gradient stops | 2 | 2 |
| Divide | (in border) | 2 |

### By colour family, which is what determines the fix

| Family | Tokens | Distinct spellings | How it gets fixed |
| --- | --- | --- | --- |
| `forest-*` | 223 | 58 | Free. Driven by `rgb(var(--forest-N) / alpha)`, so one ramp swap covers every shade and every opacity variant. Zero rules, zero call sites. |
| `cream-*` / `white` | 575 | 56 | 56 CSS repaint rules. `cream` is a fixed hex in `tailwind.config.ts`, so it cannot be remapped by a variable. |
| `black`, `ink-100` | 5 | 4 | 4 rules or 5 hand edits. |

That is the real cost number: **60 CSS rules, not 803 edits.** The 803 figure is
what you get if you assume each call site must be touched. It does not, because
this repo already solves exactly this problem twice with a scoped
utility-repaint layer (`app/globals.css:278-330` for `.dark`, `:717-747` for
`.counsel-shell`).

### Concentration by file

The damage is concentrated. 50 percent sits in 11 files, 80 percent in 33 files.
Ten files carry 400 of the 803.

| File | Total | bg | text | border | ring |
| --- | --- | --- | --- | --- | --- |
| app/counsel/cases/[id]/approach-builder.tsx | 82 | 20 | 41 | 19 | 2 |
| app/counsel/cases/[id]/evidence/evidence-viewer.tsx | 57 | 22 | 24 | 4 | 7 |
| components/counsel/CoCounselTour.tsx | 56 | 17 | 30 | 9 | 0 |
| components/counsel/CounselDashboardTiles.tsx | 40 | 6 | 32 | 0 | 2 |
| app/counsel/cases/[id]/evidence/evidence-intake.tsx | 33 | 16 | 11 | 0 | 6 |
| components/counsel/DashboardCustomizer.tsx | 32 | 5 | 21 | 5 | 1 |
| app/portal/layout.tsx | 28 | 5 | 17 | 6 | 0 |
| app/counsel/onboarding/onboarding-wizard.tsx | 27 | 4 | 13 | 6 | 4 |
| components/counsel/import/ImportPanels.tsx | 25 | 3 | 18 | 1 | 3 |
| components/counsel/PersonaSwitcher.tsx | 20 | 5 | 11 | 3 | 1 |
| components/counsel/CounselMobileNav.tsx | 19 | 7 | 7 | 3 | 2 |
| components/counsel/CounselGuestNav.tsx | 18 | 4 | 13 | 0 | 1 |
| app/portal/page.tsx | 16 | 2 | 12 | 0 | 2 |
| components/counsel/CaseActivityStream.tsx | 16 | 4 | 9 | 2 | 1 |
| app/counsel/cases/[id]/preview/preview-client.tsx | 15 | 5 | 7 | 2 | 1 |
| components/counsel/AskAdvottic.tsx | 15 | 3 | 9 | 2 | 1 |
| app/counsel/request/request-form.tsx | 14 | 0 | 14 | 0 | 0 |
| components/counsel/CounselGuestMenu.tsx | 13 | 4 | 5 | 1 | 3 |
| app/portal/[id]/page.tsx | 12 | 2 | 9 | 0 | 1 |
| app/counsel/cases/[id]/timeline/guest-timeline-view.tsx | 11 | 0 | 11 | 0 | 0 |
| components/counsel/CounselHeader.tsx | 11 | 3 | 8 | 0 | 0 |
| app/counsel/layout.tsx | 10 | 2 | 6 | 2 | 0 |

Distribution of the remaining tail: 21 files carry 5 to 9 each (134 tokens),
31 files carry 2 to 4 each (89 tokens), 10 files carry exactly 1.

### The bucket that does come free

1166 tokens across 125 files are the mirror image: `text-forest-900`,
`text-ink-400` through `text-ink-950`, `border-ink-100/200`,
`border-forest-200`. Today the `.dark` repaint layer at `app/globals.css:278-330`
forces these to cream. Remove the root class and they revert to their authored
dark-ink values, which is correct on a light ground. Top spellings:
`text-forest-900` (306), `text-ink-500` (292), `text-ink-600` (136),
`text-ink-400` (125), `text-ink-700` (102).

So the raw ratio is 1166 free against 803 broken. That ratio is misleading in
both directions: the 1166 are only "free" once the surface behind them is
actually light, and the 803 mostly collapse into shared CSS rules.

### The bucket that looks free and is not

206 unconditional tokens in these files are light-surface utilities
(`bg-white`, `hover:bg-cream-50`, `bg-ink-100`, `bg-cream-50/40` and friends)
that the counsel-scoped block force-darkens regardless of the root class. Top:
`hover:bg-cream-50` (79), `bg-white` (52), `bg-ink-100` (20), `bg-cream-50` (14).
These are the ones that make the naive flip look like nothing happened. They are
fixed by editing CSS, not by editing the 206 call sites.

## 2. What the `.counsel-shell` ramp override should do under light

**Recommendation: keep overriding, and add a second ramp under a light selector
with the slot order inverted. Do not stop overriding.** Pair it with a scoped
text-repaint layer, because the ramp alone is not safe.

Reasoning, in the order the evidence forced it.

**Stopping the override is not an option.** The base `:root` ramp is the
consumer brand's forest green, not a neutral. I removed `.counsel-shell` from
the live shell root and screenshotted it: the approach-builder panel, which uses
an explicit `bg-forest-950`, rendered as a solid dark-green island on a white
page, and the `bg-forest-900/40` panels rendered as green-grey slabs. Dropping
the override reintroduces green into the enterprise product, which the file's own
comment at `app/globals.css:672` calls out as the thing this layer exists to
prevent ("Enterprise = black, not green"). It also does not produce a light
surface: `bg-forest-900` is still a dark green. Worst of both.

**The ramp is the highest-leverage single edit available.** It is variable
driven, so it covers every shade, every property (`bg`, `border`, `ring`,
`divide`, gradient stops) and, critically, every opacity variant automatically.
A repaint layer cannot do that: `bg-forest-900/40` compiles to its own class, so
a repaint layer would need one rule per alpha, which is why the existing
`.dark` layer had to enumerate `/40` and `/50` by hand and gave up on the rest.
Usage in these files skews overwhelmingly to the dark end that an inversion
serves: **1156 tokens on `forest-600` through `forest-950`, against 19 on
`forest-50` through `forest-300`.** Those 19 are `border-forest-200` (6),
`bg-forest-50` (5), `bg-forest-100` (4), `ring-forest-300` (3), `bg-forest-50/60`
(1), and most are already special-cased in the existing repaint block anyway.

**But the ramp alone breaks 424 text tokens, and this is the trap.** The same
slot is used both as a surface and as a text colour. `bg-forest-900` wants to
become near-white under light; `text-forest-900` wants to stay near-black. They
are the same variable. Invert the ramp and you fix 389 backgrounds, 134 borders
and 196 rings while turning 424 `text-forest-*` call sites into white-on-white.

The resolution is the mechanism the file already uses: a scoped utility-repaint
layer that overrides the *text* utilities inside the light shell, mirroring
`app/globals.css:278-291` in the opposite direction. About 15 rules. Combined
with the 56 cream/white rules from section 1, the whole colour layer is roughly
60 to 75 rules in one place with zero call-site churn.

Concretely, the shape I would build:

```
.counsel-shell-light {
  /* inverted: 950 is the page ground, 50 is the darkest ink */
  --forest-950: 246 246 247;  /* was 10 10 11 */
  ...
  --forest-50:  10 10 11;     /* was 244 244 245 */
}
.counsel-shell-light .text-forest-900 { color: #17171b; }   /* ~15 rules */
.counsel-shell-light .text-cream-100  { color: #17171b; }   /* ~56 rules */
.counsel-shell-light .text-cream-100\/55 { color: rgba(23,23,27,0.55); }
...
```

One caution I could not resolve inside the spike: `.counsel-shell` and
`.enterprise-shell` share the ramp block at `app/globals.css:689`. The public
`/enterprise` marketing page is on that selector. Whatever selector carries the
light ramp must not drag the marketing shell along unless that is also intended.

## 3. Counsel-scoped rules that hardcode dark surfaces

These do not respond to the root class at all. They are the reason the naive
flip changes nothing.

**17 source blocks in `app/globals.css`.** All are scoped to `.counsel-shell`
(most also to `.enterprise-shell`).

| Line | Selector | Fixed dark value |
| --- | --- | --- |
| 689 | `.counsel-shell, .enterprise-shell` | the whole `--forest-950` to `--forest-50` zinc ramp, `10 10 11` through `244 244 245` |
| 717 | `.bg-white`, `.bg-ink-100`, `.hover:bg-white`, `.hover:bg-ink-100` | `#1e1e22` |
| 725 | `.bg-cream-50`, `.bg-forest-50`, `.hover:bg-cream-50`, `.hover:bg-forest-50` | `#1a1a1e` |
| 727 | `.bg-cream-50/40` | `rgba(26,26,30,0.4)` |
| 729 | `.bg-cream-50/50` | `rgba(26,26,30,0.5)` |
| 737 | `.bg-cream-100`, `.bg-forest-100`, and their hover forms | `#242428` |
| 739 | `.bg-cream-200` | `#2c2c31` |
| 743 | `.bg-ink-50`, `.hover:bg-ink-50` | `#141417` |
| 745 | `.bg-ink-50/40` | `rgba(20,20,23,0.4)` |
| 747 | `.bg-ink-50/50` | `rgba(20,20,23,0.5)` |
| 756 | `.bg-forest-900 > .card`, `.bg-forest-950 > .card` | gold border `rgba(213,187,126,0.28)` + `box-shadow 0 1px 2px rgba(0,0,0,0.35)` |
| 766 | `.counsel-shell` | `background-color: #0a0a0b` + a fixed gold radial wash + `background-attachment: fixed` |
| 787 | `.counsel-shell .card` | `rgba(22,22,26,0.92)`, gold hairline, dark-ground shadow |
| 792 | `.counsel-shell .card:hover` | gold hairline `rgba(213,187,126,0.32)` |
| 799 | `.counsel-shell .input`, `select.input`, `textarea.input` | `rgba(14,14,14,0.55)` fill, gold border, cream text |
| 804 | `.counsel-shell .input::placeholder` | `rgba(245,237,214,0.45)` |
| 807 | `.counsel-shell .input:focus` | `rgba(18,18,18,0.7)` |

**Those 17 source blocks compile to 36 rules, and this is a genuine trap.**
Tailwind's `@apply` copies every rule whose selector mentions the applied
utility, rewriting the selector. Because `.card`, `.popup-panel`,
`.btn-secondary`, `.btn-ghost`, `.input`, `.card-hover` and `.card-luminous` all
`@apply bg-white` or `@apply bg-forest-*` in the components layer, they silently
inherit the counsel repaint. I read the compiled stylesheet off the running page
to confirm. Rules that exist only after compilation:

```
.counsel-shell .btn-secondary            => background-color: #1e1e22
.counsel-shell .btn-secondary:hover      => background-color: #1a1a1e
.counsel-shell .btn-ghost:hover          => background-color: #1a1a1e
.counsel-shell .input                    => background-color: #1e1e22
.counsel-shell .card                     => background-color: #1e1e22
.counsel-shell .popup-panel              => background-color: #1e1e22
.counsel-shell .card-hover               => background-color: #1e1e22
.counsel-shell .card-luminous            => background-color: #1e1e22
.counsel-shell .!card / .!input          => background-color: #1e1e22
.counsel-shell .card-hover               => rgba(22,22,26,0.92) + gold hairline + shadow
.counsel-shell .card-luminous            => rgba(22,22,26,0.92) + gold hairline + shadow
.counsel-shell .card-hover:hover         => gold hairline
.counsel-shell .card-luminous:hover      => gold hairline
.counsel-shell .bg-forest-900 > .card-hover     => gold border + shadow
.counsel-shell .bg-forest-950 > .card-hover     => gold border + shadow
.counsel-shell .bg-forest-900 > .card-luminous  => gold border + shadow
.counsel-shell .bg-forest-950 > .card-luminous  => gold border + shadow
.counsel-shell .btn-primary > .card      => gold border + shadow   (artifact)
.counsel-shell .tab-underline > .card    => gold border + shadow   (artifact)
```

The last two are `@apply` artifacts with no meaning (`.btn-primary` applies
`bg-forest-900`, so `.bg-forest-900 > .card` was rewritten into
`.btn-primary > .card`). Harmless, but they are noise anyone auditing the
compiled output will trip over. Worth a comment when this layer is rewritten.

**Also outside the shell scope but load-bearing for it:** `.bg-forest-900 > .card`
and `.bg-forest-950 > .card` at `app/globals.css:442` set a gold ring and a
green-tinted shadow with no shell scoping at all, and the `html:not(.dark)`
light-on-light guard net at `:392-412` is written with `.dark` in its selector,
so it stops protecting the counsel surface the moment the class comes off.
That guard is currently what keeps `text-cream-100` legible on light surfaces
inside counsel; losing it silently is a hazard, not a saving.

## 4. What breaks that is not colour

**The wordmark asset.** `public/advottic-wordmark.png` is a transparent PNG whose
lettering is pure white; only the pillar glyph is gold. On a light ground the
word "ADVOTTIC" disappears completely. It is used at
`components/counsel/CounselHeader.tsx:157` and `:215` and
`components/counsel/CounselGuestHeader.tsx:39`. `advottic-wordmark-email.png` is
the same white lettering. A light-backdrop horizontal wordmark does not exist in
the repo. `public/advottic-logo.png` has dark lettering but is a stacked lockup,
wrong shape for the header. This needs a new asset produced, not a code change.
`public/advottic-mark.png` is gold-only and survives, though its contrast on
`#f6f6f7` is marginal.

**The shell's atmosphere layer.** `app/globals.css:766` paints a gold radial wash
at 5 percent opacity over `#0a0a0b`, `background-attachment: fixed`. At 5 percent
over near-white it is invisible. The counsel surface currently gets its sense of
depth from that wash plus gold hairlines plus flat black shadows; none of the
three reads on light. This is the part that is design work rather than
substitution.

**Shadows tuned for a dark ground.** `.counsel-shell .card` carries
`0 1px 2px rgba(0,0,0,0.35)`, which on near-black is a barely-there separation
and on near-white is a hard grey smudge. Same for `shadow-2xl` (14 call sites),
and the arbitrary values `shadow-[0_18px_50px_-30px_rgba(0,0,0,0.8)]` and
`shadow-[0_6px_20px_-12px_rgba(0,0,0,0.9)]`. Elevation has to be re-derived, not
re-coloured.

**Backdrop blur over dark tints.** 20 call sites, and every one of them pairs the
blur with a dark translucent tint: `bg-forest-950/80 backdrop-blur` on the
counsel and portal sticky headers and footers, `bg-forest-950/92 backdrop-blur-sm`
on the evidence-viewer scrim, `bg-forest-950/70 backdrop-blur-sm` on the mobile
nav scrim, `bg-black/70 backdrop-blur-sm` on the co-counsel tour. Under an
inverted ramp the tint flips to a light translucent and the blur still works, but
a modal scrim that used to darken the page will now lighten it, which removes the
"the page behind is inactive" cue. Scrims need to be re-decided, not re-mapped.

**The gold gradient text treatment.** `bg-gold-shine bg-clip-text text-transparent
gold-pan` at `app/counsel/request/page.tsx:28` and
`app/counsel/onboarding/onboarding-wizard.tsx:730`. The `gold-shine` gradient's
highlight bands are `#f2d896`, near-white. On a light ground the sweep washes out
and the headline flickers as the `gold-pan` animation runs. Needs a darker gold
ramp for light, and the accent work is happening on another branch, so this
should be sequenced after that lands.

**Gold chrome that only exists against dark.** `.header-glow-line` at
`app/globals.css:474` is a gold-to-cream 2px band with a gold glow, built to read
as a filament on black. `.search-pill-gold` at `:527` uses
`--pill-bg: rgb(var(--forest-900))` as its inner fill. `.dark .btn-primary` at
`:1332` adds a gold glow ring that vanishes with the class. `.eyebrow` renders
gold; I measured it at `rgb(120,101,60)` inside the shell, which is fine on
white, but the many gold-on-dark hairlines at `rgba(213,187,126,0.12)` become
invisible on white.

**`color-scheme`.** `:root` sets `color-scheme: light dark` at
`app/globals.css:167` and nothing scopes it to the shell. That means native
scrollbars, `select` popups and date pickers inside the counsel shell already
follow the operating system rather than the shell, so today a light-OS user gets
light native chrome inside a black workspace. A light counsel shell makes that
consistent rather than worse. Worth noting as a bug the change happens to fix.

**Firm accent colours are data, not code.** Both layouts set
`--firm-accent` from `firm.accentColor`, and `.header-glow-line-tenant` at
`app/globals.css:576` builds a gradient from it. Every firm currently in the
database picked that colour against a black shell. A firm that chose a pale gold
or a cream will be unreadable on white. There is no code fix for this; it needs a
contrast floor applied at render time or a migration pass over stored values.

**More shell roots than expected.** The brief names two. There are eleven
production call sites of `dark counsel-shell`, and two components deliberately
re-declare it because they portal to `document.body` and escape the wrapper:

```
app/counsel/layout.tsx:133, :231
app/counsel/welcome/page.tsx:96, :119
app/counsel/request/page.tsx:20
app/portal/layout.tsx:70, :177
app/join/page.tsx:60
app/guest-login/page.tsx:18
components/auth/SessionReconnect.tsx:53
components/counsel/CoCounselTour.tsx:89        (portaled, self-declares)
components/counsel/CounselLoadingOverlay.tsx   (hardcodes forest-950 for the same reason)
app/enterprise/page.tsx:56                     (enterprise-shell, shares the ramp)
components/marketing/PortalMocks.tsx           (public marketing page, hardcoded black+gold copy of the counsel look)
```

`PortalMocks.tsx` matters more than it looks: it renders faithful mocks of both
portals on the public `/features` page using explicit black and gold hex values
specifically so it does not depend on the shell class. It will not follow a light
counsel and will silently start advertising the wrong product.

## What the naive flip actually looked like

I built a throwaway public route at `/embed/spike-light/[mode]` (deleted before
this commit) that renders the same body twice, once under `dark counsel-shell`
and once under `counsel-shell`. `/embed/*` strips all consumer chrome in
`app/layout.tsx`, so the shell renders full-bleed exactly as it does under
`/counsel`. The body mounts real components: `ApproachBuilder`,
`CounselDashboardTiles`, `CaseActivityStream`, `CounselTrialBanner`, plus a
`.card` with `.input`, `.btn-primary` and `.btn-secondary`, a `bg-forest-900/40`
panel, and a `bg-white` chip. Dummy `NEXT_PUBLIC_SUPABASE_*` values in a local
`.env.local` (also deleted) kept hydration from crashing. Dev server on port 3311
out of the worktree.

**Screenshot A, `dark counsel-shell`, the control.** The production counsel look.
Near-black ground, gold hairlines on the cards, cream body copy, gold "Primary"
button with its glow ring, white "Secondary" button label, dashboard tiles with
serif headings in cream.

**Screenshot B, `counsel-shell` with `dark` removed.** Visually near-identical to
A. Same near-black ground, same cards, same input well, same panels, same gold
eyebrows. Four differences, all of them regressions:

1. The "Primary" button loses its gold fill and its gold glow ring, falling back
   to `bg-forest-900` which the ramp resolves to `#101012`. It becomes a flat
   black button. Legible, because `.btn-primary { color: #fbf7e9 }` is
   unconditional, but the brand signal is gone.
2. The "Secondary" button label vanishes. `.btn-secondary` falls back to
   `bg-white text-forest-900`; the `.counsel-shell` repaint turns the fill to
   `#1e1e22` while the text resolves to `rgb(16,16,18)`. Measured contrast 1.14:1.
3. The `bg-white` chip's body text vanishes the same way. Measured 1.12:1.
4. The two dashboard tile headings ("Next 1", "Request inbox") vanish. They are
   `text-forest-900` with a `dark:` sibling; the `.dark` repaint that was making
   them cream stops firing and they resolve to `rgb(16,16,18)` on a `#1e1e22`
   card. Measured 1.04:1.

**The measurement behind that.** I snapshotted computed `background-color`,
`color`, `border-color` and `background-image` for every element in the shell,
removed the class, and re-snapshotted:

```
elements in shell:            166
elements that changed:          9
  background-color changed:     0
  border-color changed:         0
  color changed:                8
  background-image changed:     1
```

A WCAG pass over the same page, comparing composited foreground against
composited effective background for every leaf text node:

```
dark control:      1 of 65 text nodes below 3:1
naive light flip:  4 of 65 text nodes below 3:1
```

(The one failure present in both is `.btn-primary`, a false positive: the auditor
reads `background-color` and cannot see `bg-gold-metal`'s gradient
`background-image`.)

**Screenshot C, the diagnostic.** I also removed `.counsel-shell` itself, which
is not a proposed fix but isolates where the darkness lives. The page finally
goes light, and the damage becomes visible and legible: 16 backgrounds and 23
text colours change. The matter heading and its subtitle disappear into white.
The card body copy disappears. The `bg-forest-900/40` panels become mid-grey-green
slabs. The intake stat tiles become grey blocks with cream numerals. The approach
builder, which uses an explicit `bg-forest-950`, stays a solid dark **green**
island on a white page, which is the base ramp reasserting itself and the reason
section 2 says do not stop overriding.

## Realistic sizing

**Comes free (no work at all):**
- 2026 `dark:`-variant tokens. They disappear cleanly. This part of the
  hypothesis is correct, it just does not buy what was hoped.
- 1166 `text-ink-*` / `text-forest-{700,800,900}` / `border-ink-*` tokens across
  125 files, once the surfaces behind them are light.
- 223 `forest-*` tokens across 58 spellings, covered by the ramp swap.

**One CSS file, roughly 60 to 75 rules, one to two days:**
- A light ramp with inverted slots, plus a decision on whether it is a new class
  on the root or a `:root`-level toggle.
- 56 `cream`/`white` repaint rules, about 15 `text-forest-*` repaint rules.
- Gate or rewrite the 17 counsel-scoped blocks (36 compiled rules) so they apply
  to the dark shell only.
- Re-scope the `html:not(.dark)` guard net at `:392-412`, which currently keys on
  `.dark` and would stop protecting a light counsel.

**Eleven one-line changes** at the shell roots listed in section 4.

**Genuine per-file hand work, small:** the 5 `bg-black*` / `text-ink-100` tokens,
the 2 gradient stops, the ~10 arbitrary-value colour classes
(`text-[#1a1a1a]`, `border-[#ece8dd]`, the four arbitrary shadows), and the 25
inline `style={{}}` colour expressions. Call it a day.

**The part that is not class work at all, and is most of the calendar time:**
a light wordmark asset; an elevation system to replace the gold-hairline-on-black
idiom; scrim and blur decisions; the gold-shine treatment under light; a contrast
floor for stored firm accent colours; `PortalMocks.tsx` on the public marketing
page. This is a design pass over roughly 35 screens, and it is where the
techottic.com resemblance is actually won or lost. Nothing in this spike sizes
it, because sizing design is not what a spike measures.

**Sequence I would use:**

1. Land the emerald accent branch first. Half the gold-specific findings above
   (`gold-shine`, the glow ring, the hairlines, `.eyebrow`) get re-decided by
   that work, and doing them twice is waste.
2. Build the CSS layer behind a flag on one route. `app/portal/page.tsx` is the
   right pilot: 16 dark-assuming tokens, self-contained, and the employee portal
   is the surface with the least brand freight.
3. Widen to the top 11 files. That is 50 percent of the remaining damage and
   proves whether the repaint layer holds on the dense screens
   (`approach-builder.tsx` at 82 tokens is the honest stress test).
4. Only then flip the eleven shell roots.
5. Design pass, wordmark, elevation, scrims.

**What I would not do:** touch the 803 call sites. The distinct-spelling count of
118 is the whole argument. A per-call-site sweep would be 130 files of churn to
produce the same rendered output as 60 CSS rules, and it would collide with every
other branch in flight.

## What I could not determine

- **Whether the repaint layer produces a good light theme or merely a legible
  one.** Mapping `text-cream-100/55` to `rgba(23,23,27,0.55)` is mechanical and
  will be flat and muddy in places. I measured contrast; I did not evaluate
  quality. The only way to know is to build the layer and look at ten real
  screens, which is past the boundary of a spike.
- **Anything behind auth.** The harness mounts four real components with
  fabricated props. It does not cover the case timeline, the calendar board, the
  intake ticket thread, the letter studio, the signing lifecycle, or any error or
  empty state. Those are 35 of the 84 affected files. My counts include them, my
  screenshots do not.
- **Whether the light ramp should be inverted or renamed.** Inverting keeps 1156
  call sites still. But `bg-forest-950` meaning "lightest" is a semantic lie that
  every future reader will trip over. The alternative is renaming the slots,
  which is exactly the 130-file churn this spike argues against. I recommend
  inverting with a loud comment, but I hold that recommendation loosely and it
  deserves a second opinion.
- **Whether `.enterprise-shell` should follow.** It shares the ramp block. The
  brief covers counsel and portal only. Splitting the selector is trivial;
  deciding whether the public enterprise page should also go light is a product
  question I did not have an answer for.
- **The real state of stored firm accent colours.** I could not query the
  database from the spike. The number of firms whose accent fails a contrast
  floor on white is unknown and could be zero or could be all of them.
- **Native and Capacitor surfaces.** The app ships as a remote-URL Capacitor
  shell with a cache-first service worker. Whether the status-bar style, the
  splash screen and the safe-area chrome need matching changes, and how a
  half-cached light and dark mix would look after a deploy, is untested.
- **Print and PDF export.** `lib/pdf.ts` builds court exhibits independently of
  the shell. I did not check whether any export path reads shell colours.
