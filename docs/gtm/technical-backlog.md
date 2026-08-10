# Technical backlog

> **INTERNAL DOCUMENT. NOT FOR PUBLICATION OR DISTRIBUTION.**
> Engineering tickets for the Advottic team only. Several tickets
> describe security gaps, unexecuted agreements or unsupportable public
> claims and are marked **NOT FOR EXTERNAL USE**. Do not paste any part
> of this file into a customer-facing document, a status page, a deck,
> or a support reply.

Raised by the 2026-08-10 GTM audit on branch `docs/gtm-audit`. **No
application code was changed by the audit.** Every ticket below is
written so a developer can close it against stated acceptance criteria
without re-reading the audit.

Effort is a rough engineering estimate: **XS** under 30 minutes, **S**
under half a day, **M** one to three days, **L** more than three days.

---

## TECH-001. robots.txt per-agent groups revoke the disallow list

**Severity** Critical · **Effort** S · **File** `app/robots.ts`

Under RFC 9309 and Google's implementation, a crawler obeys only the
single most specific matching `User-agent` group. Groups do not merge.
`app/robots.ts` emits a wildcard group carrying every `Disallow`, then 25
per-agent groups each containing only `Allow: /`. Every named agent
(Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot, Applebot and 19
others) is therefore explicitly permitted to crawl `/api/`, `/admin/`,
`/cases/`, `/profile/`, `/billing/`, `/auth/`, `/vault/`, `/inbox/`,
`/contracts/`, `/counsel/` and `/sign-in`.

The source comment in the file asserts the opposite ("Restating… is
redundant (the wildcard rule covers them)"). That comment is the reason
this went unnoticed and must be corrected or deleted along with the code.

Recommended fix: delete the 25 per-agent groups entirely. They grant
nothing the wildcard does not. A corrected draft file, with every line
justified, is in `docs/gtm/ai-search-eligibility.md` section 3.

**Acceptance criteria**

- [ ] `curl https://advottic.com/robots.txt` returns exactly one `User-agent:` group for the apex host, or every per-agent group repeats the full `Disallow` list verbatim.
- [ ] The disallow list includes `/portal`, `/send/`, `/share/`, `/verify-mfa`, `/guest-login`, `/war-room`, `/action-center`, `/deadlines` in addition to the current entries.
- [ ] `Sitemap:` lines are present for both `sitemap.xml` and `sitemap-images.xml`.
- [ ] `hq.advottic.com/robots.txt` and `enterprise.advottic.com/robots.txt` still return `Disallow: /` (regression check, both currently correct).
- [ ] A fetch of `https://advottic.com/pricing` with a `Googlebot` user-agent still returns 200 (regression check).
- [ ] Any comment in `app/robots.ts` describing group-merging semantics is corrected or removed. No comment may assert behaviour that has not been verified.

---

## TECH-002. Review unauthenticated GET exposure across the 88 API routes

**Severity** High · **Effort** M · **NOT FOR EXTERNAL USE**

Consequence of TECH-001: every major crawler is currently invited into
`/api/`. `find app/api -name route.ts | wc -l` returns 88. The audit did
**not** call any API endpoint, because doing so could have caused a
production database query, which was out of scope.

This ticket is a security review, not an SEO fix, and should be owned by
whoever owns security rather than by whoever closes TECH-001.

**Acceptance criteria**

- [ ] Every route under `app/api/` is classified as: requires auth / requires a token / intentionally public.
- [ ] Every intentionally-public route is confirmed to return no user data and to be safe to serve to an anonymous crawler at volume.
- [ ] Any route that is neither auth-gated nor intentionally public is fixed or removed.
- [ ] Findings are recorded in `docs/compliance/` or `docs/SECURITY_AUDIT.md`, not in a public document.

---

## TECH-003. Add `x-default` to the ten English hreflang clusters

**Severity** Low · **Effort** XS · **Files** `app/guides/[slug]/page.tsx`, `app/templates/[slug]/page.tsx`

The 5 English guides and 5 English templates emit `en-US` and `es-US`
hreflang but omit `x-default`. Their Spanish twins include it. Google
falls back sensibly without it, so this is consistency only.

**Do not treat this as "implement hreflang".** hreflang is already
implemented, bidirectional and correct across 28 URLs. Only `x-default`
is missing on ten of them.

**Acceptance criteria**

- [ ] All 28 URLs in the English/Spanish hreflang set emit `en-US`, `es-US` and `x-default`.
- [ ] Verified live with a case-insensitive match on the `hreflang` attribute. Next.js emits it as `hrefLang`; a case-sensitive check will produce a false negative.

---

## TECH-004. `/es` has no inbound internal links

**Severity** High · **Effort** S · **Files** `app/layout.tsx` (footer), `app/guides/page.tsx`, `app/templates/page.tsx`, `app/what-is-advottic/page.tsx`

Zero anchor links from any English page point to `/es`. Verified live on
`/` and `/guides` and across 54 swept routes: all 24 `/es` anchors on the
site are inside `/es` itself. The `LanguageSwitcher` does not help, since
it is cookie-driven runtime translation of English URLs and never
navigates to `/es`.

Result: 14 Spanish pages receive no internal link equity, and an
English-speaking visitor who needs Spanish has no route to them.

**Acceptance criteria**

- [ ] A persistent link to `/es` exists in the global footer, labelled in Spanish ("Español").
- [ ] `/guides` links to `/es/guias`; `/templates` links to `/es/plantillas`; `/what-is-advottic` links to `/es/que-es-advottic`.
- [ ] Each of the 5 English guide pages and 5 English template pages links to its Spanish twin in the body, not only via hreflang.
- [ ] Verified live: `curl https://advottic.com/ | grep 'href="/es'` returns at least one anchor.
- [ ] Copy passes the voice rules in `docs/DESIGN_SYSTEM.md` §7: no em dashes, no emoji.

---

## TECH-005. `sitemap-images.xml` is orphaned

**Severity** Medium · **Effort** XS · **File** `app/robots.ts`

Live and valid (HTTP 200, 2,474 bytes) but referenced from nothing.
`robots.txt` declares only `sitemap.xml`.

Can be folded into TECH-001.

**Acceptance criteria**

- [ ] `https://advottic.com/robots.txt` contains `Sitemap: https://advottic.com/sitemap-images.xml`.

---

## TECH-006. The four highest-intent pages are the only ones not CDN-cached

**Severity** Medium · **Effort** M · **File** `app/layout.tsx:5`

`headers()` is called in the **root layout**, which opts every descendant
route out of static generation. Measured live:

| URL | `cache-control` | CDN |
|---|---|---|
| `/`, `/pricing`, `/enterprise`, `/compare/clio` | `private, no-cache, no-store` | MISS every time |
| `/resources/small-claims-rankings`, `/glossary/bella` | `public, max-age=0, must-revalidate` | HIT |

No present performance loss: all 151 sitemap URLs responded in 0.19s to
1.33s, none over 1.5s. This is a scaling risk, because a `no-store`
response cannot be served from the edge and every AI retrieval fetch
costs an origin render.

Likely fix: move the `headers()` read out of the root layout into the
authenticated subtree, or split the marketing routes into a route group
with their own layout, so they can be statically generated or ISR-cached.

**This ticket must not regress the personalized header.** The root layout
reads headers to drive the user menu, notification bell, token gauge and
native-platform detection. Any fix must keep those correct for signed-in
users.

**Acceptance criteria**

- [ ] `/`, `/pricing`, `/enterprise` and `/compare/[slug]` return `cache-control: public` and produce an `x-vercel-cache: HIT` on a second request.
- [ ] A signed-in user still sees their own user menu, notification count and token balance on those pages.
- [ ] A signed-out user sees no personalized content and no user data leaks into a cached response. This is the critical regression risk: verify explicitly that a cached page served to an anonymous visitor never contains another user's name, email or notification count.
- [ ] Existing tests pass, including `npm run test:audit-guards`.

---

## TECH-007. Wire IndexNow to a Vercel cron

**Severity** High · **Effort** XS · **File** `vercel.json`

`lib/indexnow.ts` is complete and correct. The verification key file at
`https://advottic.com/f7b3a9d2e4c810857b6f4e3a9d2c1e8f.txt` returns 200.
`app/api/indexnow/route.ts` exposes a token-guarded trigger with a
curated ~30-URL cornerstone list. Its own comment says "Wire it to a
daily Vercel cron (vercel.json) once the route is shipped."

`vercel.json` declares four crons and none is `/api/indexnow`. Unless
someone has been manually curling it, **IndexNow has never submitted a
single URL.**

Highest leverage-to-effort item in the audit.

**Acceptance criteria**

- [ ] `vercel.json` contains a cron entry for the IndexNow trigger, running at most daily.
- [ ] The cron invocation carries the `INDEXNOW_TRIGGER_TOKEN`, or the route accepts Vercel's cron authentication header, so the endpoint is not left publicly triggerable.
- [ ] A Vercel function log shows a successful invocation with non-zero HTTP status codes returned from at least one IndexNow endpoint.
- [ ] `[VERIFY]` afterwards in Bing Webmaster Tools that submitted URLs appear under IndexNow submissions.

---

## TECH-008. Promote the `www` redirect from 307 to permanent

**Severity** Medium · **Effort** XS · **File** `next.config.mjs`

`redirects()` sets `permanent: false`, emitting HTTP 307. Verified live:
`www.advottic.com/pricing` returns 307. The code comment says "Promote to
`permanent: true` after a clean week"; the redirect has been in place far
longer and is proven.

A 307 tells search engines the canonical host may revert, so signal
consolidation to the apex is weaker and slower than with a 308.

**Acceptance criteria**

- [ ] `curl -I https://www.advottic.com/pricing` returns **308**.
- [ ] A signed-in user arriving at a `www` URL still lands authenticated on the apex. This redirect exists because Supabase Auth only whitelists the apex callback; verify the OAuth round trip still completes.
- [ ] The stale "promote after a clean week" comment is removed.

---

## TECH-009. Token-bearing routes should carry `noindex`

**Severity** Medium · **Effort** S · **NOT FOR EXTERNAL USE** · **Files** `app/send/[token]`, `app/share/[token]`, `app/sign/[token]`

These routes carry a live credential in the URL path. They are not
currently in the robots disallow list (TECH-001 adds them), but
`robots.txt` is not a security control and a URL can reach an index by
other means, for example a referrer leak or a pasted link.

**Acceptance criteria**

- [ ] Every token-bearing route emits `X-Robots-Tag: noindex, nofollow` as an HTTP header, not only a meta tag, so it applies to non-HTML responses too.
- [ ] `Referrer-Policy` on those routes is `no-referrer`, so the token is not leaked in the referrer of any outbound link or asset. The site-wide default is currently `strict-origin-when-cross-origin`, which sends the origin but not the path; confirm no path-carrying referrer is emitted.
- [ ] Verified live with `curl -I` on a live token URL.

---

## TECH-010. `BellaPrompt` dispatches an event nothing listens for

**Severity** Critical · **Effort** S · **NOT FOR EXTERNAL USE** · **Files** `components/BellaPrompt.tsx`, `app/cases/[id]/page.tsx:597`, `app/cases/[id]/review-panel.tsx:205`, `app/layout.tsx:583`

`components/Bella.tsx` has **zero importers**. `app/layout.tsx:583`
records that the floating widget was "removed per product decision".
`components/BellaPrompt.tsx` is still mounted on two paid consumer
surfaces and dispatches `advottic:bella-open`, whose only listener lives
in the unmounted component. A paying user clicks "Ask Bella about this
case" and nothing happens.

This is exactly what `docs/PARITY-PAGE-RULES.md:41-49` exists to prevent:
"no badge without a state behind it", "a control drawn before the thing
behind it existed".

**This ticket only fixes the dead control.** Whether Bella returns at all
is a product decision, escalated as Q1 in `docs/gtm/open-questions.md`,
and the marketing surface cannot be settled until it is answered.

**Acceptance criteria**

- [ ] Either `components/Bella.tsx` is mounted somewhere that receives the event, or `BellaPrompt` is unmounted from both call sites.
- [ ] No component in the repository dispatches a custom event that has no mounted listener. Add a check to `scripts/test/` in the style of the seven existing guards.
- [ ] If Bella is retired rather than restored, `lib/personal-tiers.ts:91` ("Bella unlocks here") and every tier feature list naming Bella are updated in the same change, because they are the paid entitlement description.

---

## TECH-011. Two different company addresses are published

**Severity** Medium · **Effort** XS · **Files** `components/seo/JsonLd.tsx`, `app/llms-full.txt/route.ts`

Organization JSON-LD publishes `addressLocality: "Minneapolis"`.
`llms-full.txt` publishes "Location: Edina, Minnesota, USA". Both are
served simultaneously to search engines and AI assistants.

Inconsistent name and address data weakens entity resolution.

**Requires an owner decision**: which address is on the Minnesota
Secretary of State filing. Do not guess.

**Acceptance criteria**

- [ ] One city appears in both places, matching the registered address.
- [ ] The same address appears in any other public location that carries one (`/about`, `/press`, `security.txt`, Google Business Profile if one exists).

---

## TECH-012. Remove unsupportable claims from `/enterprise`

**Severity** Critical · **Effort** S · **NOT FOR EXTERNAL USE** · **File** `app/enterprise/page.tsx`

The 2026-08-10 cleanup (`5c675284`, `6c02f624`) removed uncertified
claims from `/security`, `/pricing` and `TechTrustStrip` but did not
touch `/enterprise`, whose last commit is 2026-07-13. Still live:

| Line | Claim | Contradicted by |
|---|---|---|
| `:1296` | "Full DPA + BAA on request" | `docs/compliance/policies/vendor-and-subprocessor-management.md:33`; every BAA and DPA cell in the register is unchecked |
| `:710` | "Zero-retention configured on Anthropic Claude" | Commit `5c675284` ruled this not a claim we can make |
| `:1286`, `:1087` | "Every read… is logged" | `/security:136`; view logging is not implemented |
| `:1270` | "TLS 1.3" and "private VPCs in the United States" | Every other source says TLS 1.2+; no VPC claim exists in `docs/compliance/` |
| `:445` | "never expose privileged content to a vendor outside your DPA" | No DPA exists |
| `:1286` | "Retention follows your firm policy" | `COMPLIANCE_READINESS.md:28`, `:70`: no retention schedule exists |

**Treatment: delete each line. Do not replace it with a candid
admission.** Removing a false claim is required; publishing a confession
about the gap is not, and converts a silent gap into marketing about the
gap. State what is true, then stop. Never substitute an uncertified
compliance claim.

**Acceptance criteria**

- [ ] None of the six claims above appears in `app/enterprise/page.tsx` or in its `metadata`, `openGraph` or OG-image strings.
- [ ] Nothing on the page asserts a certification, attestation, executed agreement or logging behaviour that `docs/compliance/COMPLIANCE_READINESS.md` does not support.
- [ ] No replacement text volunteers a limitation that no removed claim required correcting.
- [ ] The same sweep is run over every remaining public page not covered by the 2026-08-10 commits. At minimum: `/about`, `/features`, `/developers`, `/affiliate`, `/what-is-advottic`, `/press/*`, and `components/marketing/*`.
- [ ] A `scripts/test/` guard fails the build if any of a denylist of phrases ("SOC 2 compliant", "ISO 27001", "HIPAA compliant", "BAA on request", "zero-retention", "every read is logged", "data residency") reappears under `app/` or `components/`. This is the durable fix; the deletions alone will regress.

---

## TECH-013. Pricing has three sources of truth and two of them are wrong

**Severity** Critical · **Effort** M · **Files** `components/seo/JsonLd.tsx:198-250` and `:411-440`, `app/pricing/page.tsx:56-132`, `lib/personal-tiers.ts`, `lib/firm-pricing.ts`

Shipped ladder: Free $0, Starter $19, Plus $29, Pro $59, Ultra $99, Solo
$59, Small Firm $99, Growing $149, Enterprise from $1,800. **Nine tiers.**

Published:

- `AppJsonLd` offers list "Personal Pro" $19 and "Personal Plus" $29. **Neither tier exists.** $19 is Starter, $29 is Plus. The real Pro ($59) and Ultra ($99) are omitted.
- `PricingProductJsonLd` declares `offerCount: 6` and a description reading "Six tiers from $19/month", while setting `lowPrice: '0'` in the same object.
- `app/pricing/page.tsx:56-132` maintains a hand-copied `CONSUMER_TIERS` array with hardcoded price strings, kept in sync with `lib/personal-tiers.ts` by a comment only. The firm cards import `FIRM_TIER_PRICING` directly and are correct.

`components/seo/JsonLd.tsx:20` already carries the warning "Google
penalizes mismatches; eg. don't claim a price in JSON-LD" that this code
violates.

**Acceptance criteria**

- [ ] `AppJsonLd` and `PricingProductJsonLd` derive every offer, name, price and count from `lib/personal-tiers.ts` and `lib/firm-pricing.ts`. No price string is hardcoded in `components/seo/JsonLd.tsx`.
- [ ] `app/pricing/page.tsx` derives its consumer card prices and names from `lib/personal-tiers.ts` rather than the hand-copied array.
- [ ] `offerCount` equals the actual number of offers emitted.
- [ ] The `Product` description does not contradict `lowPrice`.
- [ ] A unit test asserts that the tier names and prices in the emitted JSON-LD equal those in `lib/personal-tiers.ts` and `lib/firm-pricing.ts`, so this cannot drift again.
- [ ] Live-verified: fetch `/` and `/pricing`, parse the JSON-LD, and confirm every offer matches the code.

Related, separate ticket: `llms.txt` and `llms-full.txt` carry the same
stale pricing table. Those files are owned by another workstream; see
`docs/gtm/audit-current-state.md` C-8.

---

## TECH-014. Sitemap `lastmod` is generated at request time

**Severity** High · **Effort** S · **File** `app/sitemap.ts`

`const now = new Date()` is assigned as `lastModified` for every
cornerstone marketing entry and all 50 state pages, roughly 86 of 151
URLs including `/`, `/pricing`, `/features` and `/what-is-advottic`.

Verified live, two fetches three seconds apart:

```
fetch 1:  <lastmod>2026-08-10T20:08:27.452Z
fetch 2:  <lastmod>2026-08-10T20:08:30.884Z
```

Google's documented behaviour is to ignore `lastmod` sitewide when values
are demonstrably inaccurate, which would also discredit the 65 URLs that
carry genuine `reviewedAt` / `publishedAt` / `lastReviewed` dates.

Recommended fix: give each static entry an explicit reviewed date in the
`ENTRIES` array, in the same style `COMPARISONS`, `ARTICLES`, `ES_GUIDES`
and `ES_TEMPLATES` already use. `STATES_SMALL_CLAIMS` already has
`SMALL_CLAIMS_REVIEWED_AT = '2026-05-11'`; use it for the 50 state pages.

**Acceptance criteria**

- [ ] Two fetches of `https://advottic.com/sitemap.xml` more than a minute apart return **byte-identical** `<lastmod>` values.
- [ ] No `lastModified` value in `app/sitemap.ts` derives from `new Date()` with no argument.
- [ ] The 50 state pages use `SMALL_CLAIMS_REVIEWED_AT`.
- [ ] Each cornerstone entry carries a date that reflects when its content was actually last reviewed.

---

## TECH-015. `SoftwareApplication` claims iOS while the app is not on the App Store

**Severity** Medium · **Effort** XS · **File** `components/seo/JsonLd.tsx:186`

`operatingSystem: 'Web, iOS, Android'` is hardcoded, while the same
component's `downloadUrl` and `installUrl` correctly use `STORE_URLS`,
which excludes Apple until `NEXT_PUBLIC_IOS_APP_LIVE` is set.

The app is verifiably not live: the iTunes Lookup API for id
`6769638076` returns `resultCount: 0`, and a store search for "advottic"
returns three unrelated apps. `lib/app-links.ts` gates every other iOS
surface correctly, with the comment "so we never publish a dead link".
This field is the one place the gate was not applied.

**Treatment: remove `iOS` from the string until the flag flips.** Do not
add an explanatory note.

**Acceptance criteria**

- [ ] `operatingSystem` is derived from the same flag that drives `STORE_URLS`, so it reads `'Web, Android'` when `IOS_APP_LIVE` is false and `'Web, iOS, Android'` when it is true.
- [ ] Live-verified on `/`: the emitted `operatingSystem` matches the actual store availability.

---

## TECH-016. The root layout canonical silently deindexes any page that forgets to override it

**Severity** High (latent) · **Effort** S · **File** `app/layout.tsx:113`

`alternates: { canonical: '/' }` in the root layout means any page not
setting its own canonical resolves to `https://advottic.com` and is
treated by Google as a duplicate of the home page.

Today one sitemap URL is affected (`/status`), plus `/decoder` and
`/safe` outside the sitemap, because the per-page overrides are
near-complete. **Every new marketing page will self-deindex unless its
author remembers to override.**

**Acceptance criteria**

- [ ] `/status` self-canonicalizes to `https://advottic.com/status`, verified live.
- [ ] `/decoder` self-canonicalizes to `https://advottic.com/decoder`.
- [ ] The root layout no longer sets a hardcoded absolute canonical that pages inherit by default.
- [ ] A `scripts/test/` guard, in the style of the seven existing guards, fails the build if any `page.tsx` under `app/` that is reachable without auth lacks an explicit `alternates.canonical`. This guard is the point of the ticket; the three page fixes alone will regress.

---

## TECH-017. Production source maps are publicly downloadable

**Severity** Medium · **Effort** S · **NOT FOR EXTERNAL USE** · **File** `next.config.mjs`

`productionBrowserSourceMaps: true` is set with the comment "Maps are NOT
public; only Vercel auth can fetch them."

That is false. Verified live: an unauthenticated request for
`https://advottic.com/_next/static/chunks/webpack-27dbb1037dbf78de.js.map`
returns **HTTP 200, 20,813 bytes.**

Not an SEO issue. Raised because it was found during this audit and
because it is an unverified assertion in a code comment, the same pattern
as TECH-001 and TECH-012. Route to whoever owns security for the
decision: keep the maps and accept the disclosure, or upload them to
Vercel and stop serving them.

**Acceptance criteria**

- [ ] A decision is recorded in `docs/SECURITY_AUDIT.md` or `docs/compliance/`.
- [ ] If maps are to stay private, an unauthenticated fetch of any `.map` under `/_next/static/` returns 401, 403 or 404.
- [ ] The comment in `next.config.mjs` states what was verified, not what was assumed.

---

## TECH-018. `/safe` has no `<h1>`

**Severity** Low · **Effort** XS · **File** `app/safe/page.tsx`

The only page in the 54-route sweep with zero `<h1>` elements. It is
deliberately `noindex, nofollow`, so there is no search cost, but a
missing top-level heading is an accessibility defect on a
**personal-safety** surface. That is the worst page on the site to have
one on: a user reaching it may be in immediate danger and using a screen
reader.

**Acceptance criteria**

- [ ] `/safe` renders exactly one `<h1>`.
- [ ] The heading text passes the crisis-copy rules: calm, plain, no alarmist language, no em dashes, no emoji (`docs/DESIGN_SYSTEM.md` §7, `docs/launch/SEO_CONTENT_PLAN.md:3`).
- [ ] `scripts/test/crisis-copy-invariants.mjs` still passes.

---

## Suggested order

Grouped by what unblocks what, not strictly by severity.

**Do first (all XS or S, all high impact)**

1. TECH-007 : wire the IndexNow cron. Four lines, activates a fully built pipeline.
2. TECH-012 : remove the six unsupportable claims from `/enterprise`. This is a live legal exposure on the page shown to law firms.
3. TECH-001 + TECH-005 : fix robots.txt and declare the image sitemap in the same commit.
4. TECH-014 : fix the sitemap `lastmod`.
5. TECH-008 : promote the `www` redirect to 308.

**Then (the durable fixes, each needs a guard)**

6. TECH-013 : one source of truth for pricing, with a test.
7. TECH-016 : canonical trap, with a guard.
8. TECH-010 : the dead Bella control, blocked on the product decision in Q1.

**Then**

9. TECH-004 : link `/es` from the English site.
10. TECH-011, TECH-015, TECH-018, TECH-003 : small corrections.
11. TECH-006 : caching, once the personalization regression risk has been thought through properly.

**Route to security, not to this backlog's owner**

- TECH-002, TECH-009, TECH-017.
