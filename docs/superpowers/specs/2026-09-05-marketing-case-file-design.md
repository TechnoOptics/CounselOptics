# The case file: a redesign of the public marketing site

Date: 2026-09-05
Status: approved in brainstorming, awaiting spec review
Scope: the public marketing site only (home, pricing, features, enterprise,
the shared header and footer, and the pages that inherit primitives).
Supersedes the type section of `docs/DESIGN.md`; everything else in that
file stands.

---

## 1. The decision

The owner's brief: the site looks like generated software and must not.

What the rendered pages showed (captured 2026-09-05 at 1440px and 390px):
the palette (forest green, cream, gold) and the wordmark are genuinely the
brand and are not one of the looks generated design converges on. What reads
as templated is everything around them: one section recipe (centered gold
eyebrow, serif headline with an italic gold phrase, grey subtitle, a grid of
white rounded cards) repeated about eight times on a 13,900px home page;
card grids and check-bullet lists for all content; eight browser-frame
mockups and a stock photograph; an auto-scrolling testimonial marquee; a
gradient closing band; and Fraunces italic over Inter, now the most common
AI-era pairing.

Three decisions were made with the owner, in order:

1. Scope is the public marketing site. The signed-in app, counsel and portal
   are not touched; the app gets its own spec afterwards.
2. Colours and the wordmark stay. Type, page structure, section language and
   imagery are rebuilt.
3. The home page leads with the person preparing for court. Firms get one
   signpost to the enterprise page, which becomes their own front door.

Three directions were shown as rendered mockups. The owner chose **A, the
case file**: the site is set like the artifact the product makes.

---

## 2. The system

### 2.1 Type: four roles, four faces

| role | face | where | size |
| --- | --- | --- | --- |
| display | Libre Caslon Display | h1 and section h2 only | h1 `clamp(40px, 6vw, 72px)`, h2 28 to 40px |
| quote | Libre Caslon Text, italic | pull quotes, sheet titles | 18 to 24px |
| reading | Public Sans | body, controls, nav | 17px, line height 1.55, measure about 62ch |
| utility | Courier Prime | labels, dates, exhibit letters, eyebrows, footer column titles, the disclaimer | 12 to 13px, uppercase, tracked 0.08em |

Why these: Caslon is the face of American legal documents. Public Sans is
the civic reading face built for United States government sites. Courier is
what court filings are set in. Each is a reference to the reader's own world,
not a taste.

Rules that carry over from `docs/DESIGN.md` and still bind: a status is not a
headline; body copy sits near 65 characters; headings take `text-wrap:
balance`; numbers in columns take `tabular-nums`. New rules: Courier is
never body text and never a headline; the display face is never italic for
emphasis and never gold; `font-serif` stays reserved for rendered documents.

All four faces load through `next/font/google` in the root layout as CSS
variables and Tailwind families (`font-caslon`, `font-caslon-text`,
`font-public`, `font-courier`). Inter and Fraunces keep loading for the
signed-in shells, which are out of scope. Marketing components name the new
families explicitly; nothing in the app changes by accident.

### 2.2 Colour: the existing tokens, used six ways

| role | token | value today (light) |
| --- | --- | --- |
| paper, the ground | `cream-50` | the existing cream |
| sheet, a piece of the file | new token `sheet` | a warmer near-white, `#fffdf8` |
| ink | `forest-900` | body and headline text |
| quiet ink | `ink-600` | secondary text only, never body |
| rule | new token `rule` | `#d9d0bb`, the only border colour on marketing |
| gold | `accent` / `accent-text` | once per view |

Two new tokens (`sheet`, `rule`) are added to `tailwind.config.ts` and
`app/globals.css` in both themes. No raw hex in components.

**Gold is spent once per screen.** On the home cover it is the hearing stamp.
On pricing it is the "most chosen" stamp. On the enterprise cover it is the
request-number stamp. Buttons are ink on paper (or cream on forest), never
gold. Nothing else is gold.

**Dark theme is designed, not inverted.** Ground `forest-950`, ink
`cream-100`, sheets `forest-900` with `rule` redefined to a cream at 20%
opacity, gold unchanged. Tokens are redefined once under
`prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])`,
and again under `:root[data-theme="dark"]`, the same pattern the app uses.

### 2.3 Layout primitives

Five shared primitives under `components/marketing/file/`, each one file:

- **`Section`**: the ruled block. One ink rule on top, a 200px tab column on
  the left at 1024px and above carrying the letter (or label) and a Courier
  caption; on narrower screens the tab collapses to one line above the body.
  Spacing comes from grid `gap`, never per-element margins.
- **`Sheet`**: a piece of the file. `sheet` background, `rule` border, one
  soft shadow (`0 30px 50px -30px` of forest at 35%), 3px radius at most, an
  optional `Stamp` positioned bottom right. Content inside is set in Courier
  with a Caslon Text title.
- **`Stamp`**: a two-line gold-bordered label rotated minus six degrees. The
  only element on the site allowed to rotate and the only element that is
  gold. One per page.
- **`Definitions`**: a `dl` of two to four terms, Courier term over a Public
  Sans definition, separated by `rule` hairlines. Replaces every check-bullet
  list.
- **`Schedule`**: a ruled comparison table (pricing) and its single-column
  form on phones, where each tier becomes a Sheet with its rows.

Cards, rounded tiles, icon-in-a-square, browser frames with three dots and a
URL bar, gradient bands and stock photographs do not appear on any marketing
page. `components/marketing/PortalMocks.tsx` stays for the counsel demo and
the `/example` page, which are not marketing surfaces in this pass.

Container: max width 1200px, left aligned. Touch targets 44px. The page body
never scrolls sideways; the pricing table scrolls inside its own container
below 1024px.

### 2.4 Motion: one moment

On load of the home page, the cover's sheet assembles: rows A to D arrive one
after another (opacity 0 to 1 and 8px up, 120ms apart, 360ms each, the
`cubic-bezier(.22,.61,.36,1)` curve from DESIGN.md), and the stamp lands
last (scale 1.15 to 1, 400ms). Nothing else on the marketing site animates on
scroll or on load. Under `prefers-reduced-motion: reduce` the sheet renders
complete with no transition at all. The existing `animate-fade-up` scroll
reveals are removed from marketing pages; they are also what made the middle
of the home page render blank in a headless capture.

### 2.5 Copy

`docs/DESIGN.md` copy rules stand in full: no em dashes, no emoji, calm and
plain, controls say what happens, errors say what to do next, never scary,
never jokey. Existing copy is reused wherever it is already good; the home
hero headline "Walk into court with everything in order." is kept. New
copy is limited to captions, terms in definition lists and the sheets.

---

## 3. The home page

Roughly 5,500px at 1440px against 13,900 today. One story, one reader.

| block | tab | content |
| --- | --- | --- |
| Cover | (none) | h1 "Walk into court with everything in order." Deck (existing). One ink button "Start your case file" with "free for 7 days" as a small trailing note, and a Courier line "No card to start. Cancel any time. Yours to export." Right: the case-file Sheet for the sample matter Ramirez v. Oakline Rentals with rows A to D and the "Hearing Apr 18" Stamp. This is the one motion on the site. |
| A | What goes in | h2 "Your camera roll becomes an exhibit list." One paragraph. Definitions: Lettered, Dated, Kept. |
| B | What comes out | h2 "A calm read of where you stand, and a packet anyone can read in five minutes." One paragraph naming Advottic Review, Bella and the packet. Two Sheets side by side: the Review memo (three entries: possible issue, evidence gap, ask your attorney) and the packet contents (four numbered parts). |
| C | Who can see it | h2 "Yours alone, yours to take, and a clear log of every change." Definitions: Private by default, Yours to take with you, You stay in control. |
| D | In their words | Three pull quotes in Caslon Text italic with a Courier cite line (existing quotes: Marisol R., David K., Tracy P.). Static. The "names changed" note stays as a Courier line. |
| E | What it is not | h2 "Advottic prepares. An attorney advises. You decide." One paragraph. Six FAQ entries as a ruled disclosure list (Is Advottic legal advice; criminal charges; where is my information kept; can my attorney see my case; what is Bella; what is Safe Witness). `FaqJsonLd` is fed the same six entries from one array, so the markup and the page cannot disagree. |
| Firm signpost | (none) | One forest band, not lettered because it is not part of the person's file: "Running a practice?" with one sentence and a cream-outlined link "See Advottic for firms" to `/enterprise`. |
| Close | (none) | h2 "One small step today." One sentence. One ink button "Start your case file". |

Cut from the home page, with where each piece goes:

- The two-audience split at the top and the "two products, one calm
  standard" comparison (gone; the signpost band and the nav carry firms).
- The nine-tile "quiet tools" grid and its Learn links (features page).
- The "nothing leaves the company until legal has read it" walkthrough and
  `ApprovalToExecuted` (enterprise page).
- Safe Witness and Community case pages sections (features page).
- The Bella chat panel (one sentence in block B; Bella keeps her features entry).
- Partner cards for Anthropic, Stripe, Supabase, Vercel and the spec grid
  (security page, which already carries the posture).
- The stock photograph, every browser-frame mockup, the testimonial marquee,
  the gradient closing band, the "Daily / A to Z / Yours" stat row.
- Three of nine FAQ entries (what happens when I close a case; case
  management or case prep; what "case building" means). They remain on the
  what-is-Advottic page.

Signed-in visitors are redirected to their landing as today; nothing in that
path changes.

---

## 4. Pricing: a schedule of fees

Cover: Courier eyebrow "Schedule of fees. 7-day trial on every paid tier. 20%
off annual. Cancel any time." h1 "What it costs." One sentence.

- **I. For one person.** A `Schedule` with tiers as columns (Free, Starter,
  Plus, Pro, Ultra), price row in Caslon, feature rows (cases, court-ready
  PDF, Bella tokens, Advottic Review, invite your law firm, timeline and
  group cases, Safe Witness, signing, priority support), and a final row of
  buttons. The "Most chosen" Stamp sits on Pro and is the page's gold.
- **II. For firms.** The same form for Solo, Small firm, Growing firm,
  Enterprise, with "Talk to us" where the price is agreed in writing.
- **Worksheet.** The savings calculator stays as an interactive Sheet titled
  "What does Advottic save your firm?", restyled through the primitives; its
  arithmetic and inputs are untouched.
- **Discounts, add-ons, FAQ, gift.** Ruled lists. The gift block becomes one
  ruled row with its existing link.

The prices and every "start trial" control keep today's iOS gating
(`data-hide-on-ios` and the server user-agent gate). The guards
`marketing-routes-in-the-app`, `dangling-purchase-sentences`,
`plain-limit-copy` and `no-storekit-in-the-binary` must stay green without
edits to their assertions.

---

## 5. Features: the full index

Cover: Courier eyebrow "Index. Everything Advottic does, no account needed."
h1 "Everything in the file, in plain sight." One sentence. A Courier toggle
"For people / For firms" (the existing tab state, restyled).

**For people**, lettered entries, each a `Section`, with one Sheet where a
real screen matters:

A Exhibits (index Sheet), B Review (memo Sheet), C Safe Witness (a phone-card
Sheet, dark, with the hold-to-share control drawn as text), D Bella (a
four-line exchange as a Sheet), E Community case pages, F Packet (contents
Sheet), G Signing, H Vault and export. A closing Section "Everything
included, for people" as Definitions, then one ink button.

**For firms**, entries follow the four states a request passes through in
the product, because that order carries information: Filed, With legal,
Sent, Executed. Each is a Section with the existing walkthrough copy from
the home page's `ApprovalToExecuted` and one Sheet (the queue, the reviewer's
view, the signer's page, the executed chain). Then Definitions for the rest
of the firm surface (intake, rooms, review for triage, audit, SSO).

---

## 6. Enterprise: the firm's front door

The one page whose cover is forest, because it is the firm product's colour.
The page keeps the `enterprise-shell` class on the cover, which
`tests/consumer-live-defects.test.ts` asserts and which drives the dark
eyebrow contrast rule. Below the cover the page is the same cream file.

Cover: Courier eyebrow "Advottic for firms. In-house. Counsel." h1 "Stop
hunting for the right version of the file." Deck (existing). One
cream-outlined button "Tell us about your firm" and a text link "See what
fits your team". Right: a matter-file Sheet (Northwind Materials v. departed
engineer) with four numbered rows and the "REQ-0000412" Stamp, the page's
gold.

Sections follow the life of one matter, labelled with the step name and
"Step n of 5" in the tab: Intake, Review, Rooms, Signing, Packet. Each has
the existing copy and one Sheet. Then:

- **Sector tabs.** `EnterpriseSectorTabs` keeps its behaviour (the feature
  list re-orders by sector); its buttons become the Courier toggle and its
  cards become Definitions with a "Top fit" Courier note.
- **Ledger.** "Seven tools your firm pays for separately today" as a ruled
  three-column ledger: tool, what Advottic does, "included".
- **Case law.** The CourtListener-verified case law section keeps its copy as
  a Section with one Sheet showing a verified citation.
- **Security.** A ruled sheet of five rows (encryption, SSO, in-portal
  signing, append-only log, privilege).
- **Close.** "See your firm running on Advottic, today." with the existing
  contact path.

The savings calculator lives on pricing only; the enterprise page links to it.

---

## 7. Header, footer, and pages that inherit

**Header.** The forest bar stays, sticky, without the blur. For signed-out
visitors the nav is Pricing, Features, For firms, What Advottic is, the
language control set small in Courier, and Sign in as an outlined button.
Signed-in visitors keep today's header exactly; the change is scoped by the
existing `signedIn` branch in `app/layout.tsx`.

**Footer.** One ink rule, five Courier-titled columns (Advottic, Product,
Company, Legal, Get the app), the disclaimer as a Courier line under a `rule`
hairline. The Google Play badge stays behind the same server gate that hides
it on iOS. The footer is one component in the root layout and renders on
signed-in consumer pages too; that restyle is the only spill-over into the
app and is accepted.

**Pages that inherit.** About, what-is-Advottic, security, guides, glossary,
compare, press, changelog, status, accessibility and the legal pages get the
paper ground, the four faces and the `Section` primitive around their
existing content. No copy changes, no restructuring. Each is rendered and
looked at, both themes, both widths, before the branch is called done.

**Untouched.** `/cases`, `/counsel`, `/portal`, `/hq`, `/sign`, `/example`,
Bella, the widgets, emails and PDFs.

---

## 8. Guards

Existing guards that read these files and must be kept green by updating
their subjects, not their intent:

- `tests/hero-accent-discipline.test.ts` is rewritten for the new cover. Its
  intent (the accent makes exactly one claim in the first viewport; no
  italic-gold phrase; no gold statistics) is kept and extended to the
  pricing and enterprise covers.
- `tests/dark-panel-contrast.test.ts` and `tests/consumer-live-defects.test.ts`
  read `app/layout.tsx`, `app/enterprise/page.tsx` and the eyebrow rule; the
  eyebrow keeps its token and its dark contrast.
- The iOS gating guards listed in section 4.

New guards, each mutation-proven and reading comment-stripped source:

- `marketing-type-roles`: marketing components use only the four families;
  `font-display` (Fraunces) and Inter classes do not appear under
  `app/page.tsx`, `app/pricing`, `app/features`, `app/enterprise`,
  `components/marketing/file/`.
- `marketing-no-cards`: no `rounded-2xl`/`rounded-3xl` card grids, no
  `BrowserFrame`, no `SectionPhoto`, no `TestimonialMarquee` on the four
  pages.
- `home-faq-jsonld-matches`: the six rendered FAQ entries and the JSON-LD
  come from one array.
- `cover-motion-is-one-and-reducible`: the only animation classes on
  marketing pages are the cover's, and `prefers-reduced-motion` removes
  them.
- `marketing-no-dashes`: no em or en dash in any marketing source or copy.

---

## 9. Verification

1. The four gates with true exit codes: `tsc`, `vitest`, `build`,
   `test:audit-guards`.
2. Every changed guard mutated to red and restored.
3. Render every marketing page with puppeteer-core and the system Chrome at
   1440px and 390px, light and dark, and read the captures. The DESIGN.md
   "done" checklist applies: render it, other theme, 375px, only the page
   scrolls, accent spent once.
4. A Vercel preview deployment is opened for the owner to look at on a phone
   before merge.
5. The em-dash and emoji sweep with a positive control, over source and over
   the rendered text of every page.

---

## 10. Delivery

One branch, `design/marketing-case-file`, off `origin/main`, in an isolated
worktree. Commits in this order, each gated:

1. Tokens and fonts: `sheet`, `rule`, the four font variables and families,
   the dark redefinitions.
2. Primitives: `Section`, `Sheet`, `Stamp`, `Definitions`, `Schedule`.
3. Home page, with the rewritten hero guard.
4. Header and footer.
5. Pricing.
6. Features.
7. Enterprise.
8. Inheriting pages sweep.
9. New guards, `docs/DESIGN.md` type section amended to the four roles, and a
   pointer in `docs/DESIGN_SYSTEM.md` that the marketing type system has
   moved.

Then a pull request. Merging and the production deploy are the owner's call
after the preview.

## 11. Out of scope, on purpose

- The signed-in consumer app, counsel, portal and HQ shells (own spec).
- Any change to copy voice, pricing, plans, routes, redirects or JSON-LD
  beyond the FAQ array.
- Photography or illustration commissions. The site ships with no
  photographs.
- A new wordmark, icon, or store assets.
