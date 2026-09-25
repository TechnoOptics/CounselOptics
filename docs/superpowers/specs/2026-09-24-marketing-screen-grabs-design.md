# Real screen grabs on the public marketing site

Date: 2026-09-24
Status: awaiting owner review
Scope: the public marketing site (home, features, enterprise), plus the seed
and capture tooling the images depend on.
Builds on `2026-09-05-marketing-case-file-design.md`; amends its section on
imagery, and nothing else in it.

---

## 1. The decision

The owner's brief: the site "does not have real screen grabs of the actual
app so that the visitors can actually see how the app looks and works, not
all talk and no show."

That is accurate. After the case-file redesign the four marketing pages carry
**no images at all**. Verified by reading them: no `Image`, no `img`, on home,
features, enterprise or pricing.

The redesign caused it, through a conflation worth naming so it is not
repeated. The old site carried eight browser-frame mockups, a stock
photograph, and `components/marketing/PortalMocks.tsx`, a hand-built React
component that re-drew a fake portal with invented data. The spec banned
those, and was right to: a hand-drawn copy of a product is not the product,
and it drifts from the real thing every time somebody ships a change. But the
spec then substituted nothing, and it never actually argued against showing
the real software. What it argued against was fake browser chrome and stock
imagery. Those are different objections, and following the letter of the first
produced a site that describes the product without ever showing it.

`app/example/page.tsx` is not an answer either. It is 572 lines that import
nothing from `@/components` or `@/lib`: another simulation, the same trap.

## 2. What a visitor sees

Decided with the owner: both audiences in one pass, and a different job per
page rather than one uniform treatment.

**Home, one frame.** The real case file view, `cases/[id]`, placed where the
typographic sheet now stands under the headline. The sheet and the screenshot
show the same fictional matter, so the page does not introduce two different
cases in two hundred pixels.

**Features, two sequences.** Four or five frames each, in the order somebody
would actually do the thing, each under a Courier caption naming the step.
The consumer sequence runs `cases/[id]` to `cases/[id]/timeline` to
`cases/[id]/packet`. The firm sequence runs `counsel/cases/[id]` to
`counsel/cases/[id]/evidence` to `counsel/cases/[id]/timeline`. Frames are
chosen to prove the sentence beside them, not to be pretty.

**Enterprise, one wide frame.** The firm workspace, `counsel/cases/[id]`,
which is what firms buy on seeing.

**Pricing, none.** Nobody comparing prices is persuaded by a picture, and the
schedule is the page's whole argument.

### How a frame is presented

No browser chrome, no URL bar, no device frame, no gradient, no drop shadow
beyond what `Sheet` already carries. The image sits inside the existing
`Sheet` primitive on the paper ground, cropped to the region that carries the
claim. This keeps every prohibition the case-file spec made about mockup
clichés while dropping the accidental prohibition on the product itself.

Each frame carries alt text that says what the screen shows, in a sentence,
never the word "screenshot". These are the only images on the site, so each
one ships with intrinsic width and height to reserve its space, and in a
modern format, or they undo the page weight the redesign bought.

## 3. Where the pixels come from

Captures are **generated, never hand-taken**. A folder of hand-cropped images
is stale within a month, and a marketing site that shows a version of the
product nobody can still find is worse than one that shows nothing.

### The demo data

A seed script builds two accounts carrying the fiction the site already uses,
so the sheet and the screenshot agree:

- a person's account holding **Ramirez v. Oakline Rentals**, the small-claims
  matter the home page's sheet already names, with its four lettered exhibits
  and the hearing date;
- a firm account holding the **trade-secrets matter** the enterprise page
  already describes, with its intake, its review and its citation.

Both are invented. No frame may be captured from a real matter, ever. That is
not a style rule: the production database holds privileged client work.

### Signing in without a new public door

Consumer sign-in is OTP email codes only. There is no password and no
magic-link button, which is why `app/api/auth/review-login/route.ts` exists as
a narrow bypass for App Store reviewers, who cannot read a code sent to a real
inbox.

The capture path does **not** add a second bypass. The seed already holds the
service-role key, so it mints a one-time link for the demo user and the
capture script visits it, which is the mechanism the branded sign-in email
already uses. Nothing new is exposed to the internet, and the bypass that
exists keeps its single purpose.

### The capture script

Modelled on `scripts/design/render-marketing.cjs`, which already drives the
marketing site in headless Chrome through puppeteer-core: it takes a base URL
and an output directory, emulates reduced motion, and writes deterministically.

The new script signs in, drives each named route, and captures at fixed widths
in both themes where the surface has two. It writes the images plus a manifest
recording, for each frame, the route, the viewport, the theme, and the commit
it was taken from.

It refuses to run against a target that looks like production. A capture run
that reaches the real database is the one failure in this design that cannot
be undone, so the check is a precondition rather than a warning.

## 4. Keeping the site honest

A guard, in the same family as the marketing guards already in `tests/`:

- every image referenced by a marketing page exists in the manifest;
- every route in the manifest still resolves in the app, so a renamed or
  deleted screen fails the build rather than leaving a picture of something
  that is gone;
- every frame carries alt text, and none of it contains the word
  "screenshot";
- the manifest's commit is not absent.

The guard reads comment-stripped source and is mutation-proven before it
lands, as every guard on this site is.

Refreshing is one command. Running that command in CI on a schedule is what
turns "the images are current" from a hope into a fact, and is the part most
likely to be skipped and most worth keeping.

## 5. Where the capture runs

**Assumption, stated because the owner declined to choose and may overturn
it:** a local Supabase configuration is added to the repository so the whole
path runs from the committed schema, on a laptop or in CI, seeded fresh each
run. The repository has migrations and `supabase/schema.sql` but no
`supabase/config.toml`, so this is new work.

It is chosen over a cloud demo project because it costs nothing to run, needs
no second schema kept in step, and cannot reach production data even by
mistake. The alternative, a separate Supabase project holding only invented
data, renders exactly as production does and remains the fallback if the local
stack proves unreliable.

Capturing from production with a demo account is rejected. The realism is not
worth pointing a screenshot tool at a database of privileged matters.

## 6. Risks

**A real client's data reaching the public site.** The design's answer is
structural: captures run against a database seeded from nothing, and the
script refuses a production-looking target. Both, not either.

**Staleness.** Answered by the manifest, the guard and the scheduled refresh.
Accepted residue: a screen can change cosmetically without changing its route,
and no guard catches that. The scheduled run plus a human reading the diff is
the control, the same one the render audit relies on.

**This is infrastructure, not content.** Seed, capture, manifest, guard, and a
local stack that has to keep working. That is the honest price of images that
stay true, and it is why hand-capturing looks cheaper than it is.

**Page weight.** The first images on an otherwise text-only site. Mitigated by
intrinsic dimensions, modern formats and tight crops, and measured in the
render audit rather than assumed.

## 7. Out of scope

- Pricing page imagery.
- Video, animation, or any interactive embed of the product.
- Changing any product screen to photograph better. If a screen looks wrong in
  a frame, that is a finding about the screen, filed separately.
- The mobile apps. This covers the web product only.
- Retiring `app/example` or `components/marketing/PortalMocks.tsx`. Both are
  now unreferenced by marketing pages; removing them is its own change.
