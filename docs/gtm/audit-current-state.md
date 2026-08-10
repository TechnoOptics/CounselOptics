# Current-state audit

> **INTERNAL DOCUMENT. NOT FOR PUBLICATION OR DISTRIBUTION.**
> Written for the Advottic owner and team only. Nothing here is
> public-facing copy. Do not lift sentences from it into a deck, a
> webpage, a pitch, or a customer email. Findings marked
> **NOT FOR EXTERNAL USE** describe security gaps, unexecuted
> agreements, unmet compliance controls or architectural weaknesses and
> must never leave this repository in any form, paraphrased or otherwise.

Audit date 2026-08-10. Branch `docs/gtm-audit`. **Audit only: no
application code was changed.**

**No analytics, Search Console, Bing Webmaster Tools, Ahrefs or App Store
Connect access exists in this session.** Consequently this document
contains no traffic figures, no rankings, no search volumes, no
impressions and no competitor metrics. None were estimated. Every
quantity is either counted from a file in this repository or read from a
live HTTP response on the audit date. Unverifiable items carry
`[VERIFY]` and name the tool that would settle them.

---

## Part one: what already exists

**Read this part before commissioning anything.** The build state here is
far ahead of what a generic SEO or AI-visibility plan would assume, and
several standard recommendations would be pure waste.

### Do not rebuild these

| # | Thing | Verified state | A generic plan would have said |
|---|---|---|---|
| 1 | **Server-side rendering of all public content** | 54 routes fetched with a GPTBot user-agent and 151 sitemap URLs fetched with a Googlebot user-agent, no JavaScript executed. Every public page returned its full text in raw HTML: home 3,478 words, `/enterprise` 2,477, `/public-defender` 2,758, `/pricing` 1,983. Zero empty shells. | "AI crawlers can't read your JS app, add SSR or prerendering" |
| 2 | **hreflang between English and Spanish** | 28 URLs carry it: 14 Spanish and 14 English counterparts, fully bidirectional, correct per-page clusters. `app/es/page.tsx:14-17` | "You have a Spanish section with no hreflang" |
| 3 | **JSON-LD structured data** | 5 blocks on the home page alone. Across the site: Organization, WebSite, ProfessionalService, SoftwareApplication, FAQPage, Article, Dataset, HowTo, LegalService, DefinedTermSet, DataCatalog, BreadcrumbList, ItemList, CollectionPage, Product, Person, ProfilePage | "Add schema markup" |
| 4 | **`aggregateRating` correctly withheld** | `components/seo/JsonLd.tsx:250-262` and `:433-445` make it conditional on real values being passed; nothing passes them. **No fabricated review count is published anywhere on the site.** | Many plans quietly suggest adding a rating |
| 5 | **`max-snippet: -1` and `max-image-preview: large`** | Set in `app/layout.tsx`. These are the directives that make a page eligible for a full-length snippet in a Google AI Overview | "Set snippet directives for AI Overviews" |
| 6 | **`llms.txt`** | Live, 22,683 bytes, 158 lines, sectioned, every entry annotated, with an explicit "Citation guidance" section telling assistants which URL to prefer per query type. Better than most published examples | "Publish an llms.txt" |
| 7 | **`llms-full.txt`** | Live, 10,409 bytes. A brand dossier: spelling, pronunciation, misspellings to correct, what the product is and is not, per-query citation routing | "Write a brand fact sheet for AI" |
| 8 | **IndexNow integration** | `lib/indexnow.ts` complete: Bing and federated endpoints, 5,000-URL batching, never throws, host-filtered. Verification key file at `/f7b3a9d2e4c810857b6f4e3a9d2c1e8f.txt` returns **200**. Token-guarded trigger route with a curated 30-URL cornerstone list | "Set up IndexNow for Bing" |
| 9 | **Open data programme** | Three CC BY 4.0 JSON datasets with permissive CORS, a GitHub mirror at `TechnoOptics/legal-data`, and a `CITATION.cff` for academic citation. `small-claims.json` verified live, 15,681 bytes | Nobody would have thought of this |
| 10 | **`/resources/small-claims-rankings`** | Live, carries `Article` + `Dataset` + `BreadcrumbList` schema, CDN-cached. Purpose-built as the citation target for cross-state small-claims questions | "Build a linkable asset" |
| 11 | **50 state small-claims pages** | All live, ~898 words each in raw HTML, each with `FAQPage` + `HowTo` + `LegalService` + `BreadcrumbList` schema. Data reviewed 2026-05-11 with a documented annual re-check cadence | "Build programmatic long-tail pages" |
| 12 | **Content library** | 16 resource articles, 9 competitor comparison pages, 5 guides, 5 templates, 5 free interactive tools (one embeddable), 11 glossary entries, 10 changelog entries, 2 press posts | "Start a blog" |
| 13 | **Sitemap hygiene** | All 151 URLs return **200**. Zero non-200. Zero noindex-in-sitemap conflicts. Zero duplicate titles. Zero responses over 1.5s. Only one canonical anomaly | "Audit your sitemap for errors" |
| 14 | **Canonical coverage** | 150 of 151 sitemap URLs self-canonicalize correctly | "Add canonical tags" |
| 15 | **RSS and Atom feeds** | `feed.xml` 5,730 bytes, `atom.xml` 5,882 bytes, both live with correct content types | "Add a feed" |
| 16 | **Crawler access** | 19 user-agents live-tested against `/pricing`, all returned 200, including empty UA and curl. **No Vercel bot mitigation, no WAF rule, no challenge blocking any legitimate agent** | "Check that Cloudflare isn't blocking GPTBot" |
| 17 | **Subdomain isolation** | `hq.advottic.com` and `enterprise.advottic.com` both serve `Disallow: /` and are `noindex`-headered in middleware. Verified live | "Stop your staging subdomains being indexed" |
| 18 | **Wikidata entity** | `Q140132010`, live, referenced from `sameAs` | "Create a Wikidata entry" |
| 19 | **Embeddable widget** | `/embed/statute-of-limitations`, with `X-Frame-Options` correctly stripped for `/embed/*` only in `next.config.mjs`. A genuine link-acquisition asset for legal-aid sites | "Build something embeddable" |
| 20 | **`security.txt`** | Live at `/.well-known/security.txt` | |
| 21 | **CI copy guards** | Seven automated guards enforcing tone, punctuation, US formats, crisis-panel legibility, translation safety and, notably, that Safe Witness "must not claim outcomes that did not happen" | "Establish brand voice guidelines" |

**Summary: items 1 through 21 are done. A consultant charging for any of
them would be charging to rebuild working software.**

---

## Part two: what is missing or wrong

Severity: **Critical** (publishes something untrue, or forfeits a whole
category of discovery), **High** (measurable loss, cheap fix),
**Medium**, **Low**.

---

### C-1. `/enterprise` was missed by the claim-cleanup sweep. Critical. NOT FOR EXTERNAL USE.

**What it is.** On 2026-08-10 two commits (`5c675284`, `6c02f624`)
removed uncertified compliance and security claims from `/security`,
`/pricing` and `TechTrustStrip`. `app/enterprise/page.tsx` was not
touched. Its last commit is 2026-07-13.

Still live on the firm-side sales page:

| Line | Claim | Contradicted by |
|---|---|---|
| `:1296` | "Full DPA + BAA on request" | `docs/compliance/policies/vendor-and-subprocessor-management.md:33` forbids counter-signing a customer BAA until upstream BAAs exist. **Every BAA and DPA cell in the register is unchecked.** The identical claim was deleted from `/pricing` the same day |
| `:710` | "Zero-retention configured on Anthropic Claude" | Commit `5c675284` ruled this "not a claim we can make" and stripped it from `/security` |
| `:1286`, `:1087` | "Every read, write, share, sign, export, and login is logged" | `/security:136`: "Logging of individual views is not in place yet". The same wording was removed from `TechTrustStrip` in `6c02f624` |
| `:1270` | "TLS 1.3 in transit" and "private VPCs in the United States" | Every other source says TLS 1.2+. No VPC claim appears anywhere in `docs/compliance/` |
| `:445` | "never expose privileged content to a vendor outside your DPA" | No DPA exists |
| `:1286` | "Retention follows your firm policy" | `COMPLIANCE_READINESS.md:28`, `:70`: no retention schedule exists |

**What it costs.** This is the page shown to law firms, the buyer least
tolerant of an unsupportable representation and most likely to have
counsel read it. A firm that signs on the strength of "Full DPA + BAA on
request" and then cannot get one has a straightforward misrepresentation
claim. The company's own compliance documents are the evidence against
it. This is a legal and commercial exposure before it is a marketing
problem.

It also directly undoes the work of 2026-08-10: the cleanup is
incomplete, so the site is now internally inconsistent, saying one thing
on `/security` and the opposite on `/enterprise`.

**Treatment: delete the lines.** Do not replace them with candid
admissions. Ticket TECH-012.

---

### C-2. Published pricing does not match shipped pricing. Critical.

**What it is.** Three public surfaces publish tier names that do not
exist and omit tiers that do.

Shipped (`lib/personal-tiers.ts:54-135`, `lib/firm-pricing.ts:35-67`):
Free $0, Starter $19, Plus $29, Pro $59, Ultra $99, Solo $59, Small Firm
$99, Growing $149, Enterprise from $1,800. **Nine tiers.**

Published:

- Home page `SoftwareApplication` JSON-LD (`components/seo/JsonLd.tsx:198-250`) lists four offers: "Personal Pro" $19, "Personal Plus" $29, "Counsel Solo" $59, "Counsel Small Firm" $99. **Neither "Personal Pro" nor "Personal Plus" exists.** $19 is Starter and $29 is Plus. The real Pro ($59) and Ultra ($99) are absent.
- `/pricing` `Product` JSON-LD (`:411-440`) declares `offerCount: 6` and a description reading "Six tiers from $19/month", while setting `lowPrice: '0'` in the same object. It contradicts itself and both halves are wrong.
- `llms-full.txt` publishes the same stale "Personal Pro / Personal Plus" table.
- `llms.txt` says "six subscription tiers".

**What it costs.** Structured pricing data is exactly what Google's price
snippets and every AI assistant read verbatim. A prospect asks an
assistant "how much is Advottic Pro" and is told $19 for a product that
costs $59. That is a support burden, a trust hit at the moment of
purchase intent, and a Google structured-data mismatch penalty risk
(`components/seo/JsonLd.tsx:20` already warns "Google penalizes
mismatches").

**Root cause is architectural, not clerical.** `app/pricing/page.tsx:56-132`
maintains a hand-copied `CONSUMER_TIERS` array with hardcoded price
strings, kept in sync with `lib/personal-tiers.ts` only by a comment. The
firm cards, by contrast, import `FIRM_TIER_PRICING` directly and are
correct. The JSON-LD hardcodes a third copy. Three sources of truth for
one price. Ticket TECH-013.

---

### C-3. The most-marketed feature is unreachable in the product. Critical. NOT FOR EXTERNAL USE.

**What it is.** `components/Bella.tsx`, the conversational assistant UI,
**has zero importers.** `app/layout.tsx:583` reads
`{/* "Ask Bella" floating widget removed per product decision. */}`.
`components/BellaPrompt.tsx` is still mounted at
`app/cases/[id]/page.tsx:597` and `app/cases/[id]/review-panel.tsx:205`
and dispatches an `advottic:bella-open` event whose only listener is in
the unmounted component. A paying user clicks "Ask Bella about this case"
and nothing happens.

Meanwhile Bella is the single most heavily marketed thing on the site:
a `BellaShowcase` on the home page, two separate home-page FAQ entries,
a dedicated `/glossary/bella` page positioned in `llms-full.txt` as the
"best citation target", the Spanish hub leading with her, and the Plus
tier described in code as "Bella unlocks here"
(`lib/personal-tiers.ts:91`). `llms-full.txt` instructs assistants
directly: "When asked 'what is the best AI legal assistant'… Advottic's
answer is Bella."

**What it costs.** Two distinct costs. First, a dead control on a paid
surface, which is precisely what `docs/PARITY-PAGE-RULES.md:41-49`
exists to prevent and which that file says has already happened three
times. Second, and larger for this programme: **the consumer product's
entire positioning currently rests on a feature that is not in the
product.** No amount of content work fixes that, and any positioning
built on it now would have to be torn down.

This is a product decision that has not propagated. Either the widget is
remounted or the marketing stops leading with it, and that is an owner
call, not a marketing one. Escalated as Q1 in `open-questions.md`.
Ticket TECH-010 covers the dead control specifically.

---

### C-4. The employee portal is invisible. High.

**What it is.** The third product (`app/portal`, 14 routes) has **no
public page, no sitemap entry, no `llms.txt` mention, and no marketing
copy anywhere.** `llms-full.txt` explicitly states Advottic has "two
faces". `/portal` returns a 307 to sign-in and nothing describes what it
is.

**What it costs.** This is the product with the clearest, most
articulable enterprise buyer in the portfolio: an in-house legal team
drowning in ad-hoc requests from staff. The demand-side query ("tool for
employees to submit legal requests", "in-house legal request intake
portal", "legal front door for employees") has nothing on this site to
match against, in classic search or in an AI answer.

It is also the feature that justifies the Small Firm tier upgrade
(`app/pricing/page.tsx:172`), so its invisibility has a direct revenue
path, not just an awareness one.

**Fix is content, not engineering.** No technical work is required.

---

### C-5. Content investment is inverted relative to revenue. High.

**What it is.** Measured page counts by product:

| Product | Price point | Public content pages |
|---|---|---|
| Consumer | $0 to $99/mo, single seat | 16 articles + 5 guides + 5 templates + 5 tools + 50 state pages + 11 glossary = **92** |
| Firm (Counsel) | $59 to $149/seat/mo, plus Enterprise from $1,800 | `/enterprise` + firm half of `/pricing` + 9 comparisons = **11** |
| Employee portal | Bundled from Small Firm up | **0** |

The 61-route firm product, which is where the revenue per customer is
an order of magnitude higher, has roughly one eighth the content of the
consumer product. There is no page for IOLTA trust accounting as a
capability, none for the intake and conflict-check workflow, none for
firm e-signature, and none for the Clio / MyCase / PracticePanther
migration path, which is the single most search-visible buying moment in
practice-management software.

**What it costs.** Every firm-side query that is not a brand-versus-brand
comparison has nothing to land on.

---

### C-6. robots.txt grants every important crawler the entire application. High. NOT FOR EXTERNAL USE (the security half).

**What it is.** `app/robots.ts` emits a wildcard group carrying all the
disallows, then 25 per-agent groups each containing only `Allow: /`.
Under RFC 9309 a named group **replaces** the wildcard group rather than
adding to it. So Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot,
Applebot and 19 others are each explicitly permitted to crawl `/api/`,
`/admin/`, `/cases/`, `/profile/`, `/billing/`, `/auth/`, `/vault/`,
`/inbox/`, `/contracts/`, `/counsel/` and `/sign-in`.

The source comment asserts the opposite ("the wildcard rule covers
them"), which is why it has gone unnoticed.

**What it costs.** Not a data exposure: those routes are auth-gated and
return 307 to sign-in, verified live. The costs are crawl budget burned
across 88 API route paths and the whole authenticated app on a site with
only 151 marketing URLs, sign-in walls shaping the crawler's model of the
site, and origin load on `no-store` routes.

**NOT FOR EXTERNAL USE:** an unauthenticated crawler being explicitly
invited into `/api/` warrants a separate review of which of the 88 API
routes answer unauthenticated GETs. That is out of scope here and is
filed as TECH-002. It must not be described externally in any form.

Full analysis and a corrected draft file are in
`ai-search-eligibility.md` section 2 and 3. Ticket TECH-001.

---

### C-7. Sitemap `lastmod` is fabricated at request time. High.

**What it is.** `app/sitemap.ts` computes `const now = new Date()` and
assigns it as `lastModified` for every cornerstone marketing entry and
all 50 state pages: roughly 86 of 151 URLs, including the home page,
`/pricing`, `/features` and `/what-is-advottic`, the four highest-priority
URLs in the file.

Verified live by fetching `sitemap.xml` twice three seconds apart:

```
fetch 1:  <lastmod>2026-08-10T20:08:27.452Z
fetch 2:  <lastmod>2026-08-10T20:08:30.884Z
```

Every URL claims to have been modified at the instant of the request,
every time.

**What it costs.** Google's documented behaviour is to ignore `lastmod`
for a site when the values are demonstrably inaccurate. The signal is not
merely useless on those 86 URLs, it risks discrediting the 65 that carry
genuine dates (articles, comparisons and the `/es` tree all use real
`reviewedAt` / `publishedAt` / `lastReviewed` values). This is the
freshness signal for the whole site and it is currently self-discrediting.

Ticket TECH-014.

---

### C-8. Stale claims survive on the AI-citation surfaces. Critical. NOT FOR EXTERNAL USE.

Detailed in `ai-search-eligibility.md` finding AI-9. In summary,
`lib/glossary.ts:52`, `app/llms.txt/route.ts:50` and
`app/llms-full.txt/route.ts:75,141,142` still publish BAA availability,
custom data residency and "SOC 2 path in progress", all of which were
removed from the HTML pages on 2026-08-10. `lib/glossary.ts:38` still
describes the Safe Witness SMS as containing a plaintext PIN and raw GPS,
behaviour removed on 2026-07-01.

**These are the worst places for a stale claim to live**, because an
assistant restates them as fact with no date and no visible provenance.

`llms.txt` additionally advertises a gap that no longer exists ("MFA and
data-residency options on the roadmap"), which both contradicts
`/security` and volunteers a limitation nothing required it to disclose.
**Treatment is deletion of the clause, not replacement with a candid
admission.** `app/llms.txt/route.ts` and `app/llms-full.txt/route.ts` are
owned by a separate agent; this finding defines scope only.

`llms-full.txt` also publishes four discount programmes (bar association
15%, students 50%, legal aid 75% capped at 5 seats) for which **no
implementing code exists**. The only discount in the codebase is the 20%
annual/gift prepay in `lib/gift.ts:105-108`. Publishing a discount a
customer cannot claim is a consumer-protection problem before it is an
SEO one, on a product sold to lawyers.

---

### C-9. The Spanish tree is an orphan. High.

**What it is.** hreflang is correct (see Part one, item 2), but **zero
anchor links from any English page point to `/es`.** Verified live on `/`
and `/guides` and across all 54 swept routes: 24 `/es` anchors exist and
all 24 are inside `/es` itself.

The `LanguageSwitcher` does not help. It is cookie-driven: it sets a
locale cookie that triggers runtime machine translation of the *English*
URLs. It does not navigate to `/es`. So the crawlable Spanish surface has
no inbound links, and the linked Spanish surface has no crawlable URLs,
because a crawler carries no cookie and only ever sees English.

**What it costs.** 14 hand-written Spanish pages receive no internal link
equity, and an English-speaking visitor who needs Spanish has no route to
them. Ticket TECH-004.

---

### C-10. The published Twitter/X profile does not exist. Medium. 

`https://twitter.com/advottic` is published in the Organization
`sameAs` array and as `twitter:site` / `twitter:creator` in
`app/layout.tsx`. It returns **HTTP 404**.

`linkedin.com/company/advottic` returned HTTP 999, LinkedIn's standard
anti-bot response, so it is inconclusive. `[VERIFY]` manually in a
browser.

**What it costs.** A 404 in `sameAs` is a broken entity-graph edge and
weakens the knowledge-panel signal the rest of the schema is trying to
build. Separately, an unregistered handle published as the company's
official account is a brand-squatting opening.

---

### C-11. `SoftwareApplication` claims an operating system the product is not on. Medium.

`components/seo/JsonLd.tsx:186` hardcodes
`operatingSystem: 'Web, iOS, Android'`, while the same component's
`downloadUrl` and `installUrl` correctly draw from `STORE_URLS`, which
excludes Apple until `NEXT_PUBLIC_IOS_APP_LIVE` is set.

The iOS app is verifiably **not live**: the iTunes Lookup API for app id
`6769638076` returns `resultCount: 0`, and a store search for "advottic"
returns three unrelated apps.

This is a small inconsistency in an otherwise careful piece of work.
`lib/app-links.ts` gates every other iOS surface correctly and its
comment says explicitly "so we never publish a dead link". The schema
field is the one place the gate was not applied.

**Treatment**: remove `iOS` from the string until the flag flips. Do not
add an explanatory note. Ticket TECH-015.

---

### C-12. The `www` redirect is temporary. Medium.

`next.config.mjs` `redirects()` sets `permanent: false`, emitting HTTP
**307**. Verified live: `www.advottic.com/pricing` returns 307.

The code comment says "307 (temporary) instead of 308 so we can roll this
back without poisoning browser/CDN caches… Promote to `permanent: true`
after a clean week." That was a correct decision at the time. The week
has passed.

**What it costs.** A 307 signals to search engines that the canonical
host may change back. Signal consolidation to the apex is weaker and
slower than with a 308. Low risk to change now that the redirect is
proven. Ticket TECH-008.

---

### C-13. The commercial pages are the only ones not CDN-cached. Medium.

Measured live:

| URL | `cache-control` | CDN |
|---|---|---|
| `/`, `/pricing`, `/enterprise`, `/compare/clio` | `private, no-cache, no-store` | **MISS** every time |
| `/resources/small-claims-rankings`, `/glossary/bella` | `public, max-age=0, must-revalidate` | **HIT** |

Root cause: `app/layout.tsx:5` calls `headers()` in the **root layout**,
which opts every descendant route out of static generation. Only five
pages in the app export `revalidate`.

**What it costs.** Nothing measurable today: all 151 URLs responded in
0.19s to 1.33s with zero over 1.5s. It becomes a real constraint at crawl
volume, because a `no-store` response cannot be served from the edge and
every AI retrieval fetch costs an origin render. Filed as medium because
it is a scaling risk with a non-trivial fix, not a present loss.
Ticket TECH-006.

---

### C-14. `/status` canonicalizes to the home page. Medium, with a high-severity latent trap.

`https://advottic.com/status` sets `<link rel="canonical"
href="https://advottic.com">`. Google will treat it as a duplicate of the
home page and drop it from the index. The same is true of `/decoder` and
`/safe`, though both are app surfaces where it matters less and `/safe`
is deliberately `noindex` anyway.

**The trap is bigger than the symptom.** `app/layout.tsx:113` sets
`alternates: { canonical: '/' }` at the **root layout**. Any page that
does not explicitly override it silently canonicalizes itself into the
home page and disappears from the index. Today only one sitemap URL is
affected because the per-page overrides are near-complete. **Every new
marketing page added from now on will self-deindex unless its author
remembers.**

Ticket TECH-016, and it should carry a CI guard, in the style of the
seven guards already in `scripts/test/`.

---

### C-15. IndexNow is built, verified and never fires. High.

`vercel.json` declares four cron jobs. **None is `/api/indexnow`.** The
route's own comment says "Wire it to a daily Vercel cron (vercel.json)
once the route is shipped". The route shipped. The cron did not.

Unless someone has been manually curling the endpoint (`[VERIFY]` in
Vercel function logs), IndexNow has never submitted a single URL, despite
a complete implementation and a live, verified key file.

**What it costs.** Bing, Yandex and Seznam are re-crawling passively
instead of within minutes. Bing's index is a substrate for Copilot and
for parts of ChatGPT's search behaviour, so this is an AI-visibility
lever and not merely a Bing lever.

**This is the best leverage-to-effort item in the audit**: a four-line
addition to `vercel.json`. Ticket TECH-007.

---

### C-16. `sitemap-images.xml` is orphaned. Medium.

Live and valid (200, 2,474 bytes) but declared nowhere. `robots.txt`
lists only `sitemap.xml`. It appears in the IndexNow cornerstone array,
which never fires (C-15). Ticket TECH-005.

---

### C-17. Glossary entries are too thin to win a citation. Medium.

The 11 `/glossary/*` pages measure 262 to 346 words of raw text
**including navigation, footer and cookie banner**. Real body content is
comfortably under 150 words each. The thinnest is `/glossary/techno-optics`
at 262 gross.

These pages carry `DefinedTerm` schema and are explicitly positioned in
`llms-full.txt` as the "best citation target" for brand queries. The
positioning is right. The pages are not yet substantial enough to be
chosen over a competitor's longer explainer.

---

### C-18. Production source maps are publicly downloadable. Medium. NOT FOR EXTERNAL USE.

`next.config.mjs` sets `productionBrowserSourceMaps: true` with the
comment: "Maps are NOT public; only Vercel auth can fetch them."

**That is false.** An unauthenticated fetch of
`https://advottic.com/_next/static/chunks/webpack-27dbb1037dbf78de.js.map`
returns **HTTP 200, 20,813 bytes.**

Not an SEO finding, but it is a technical defect found in the course of
this audit, it is asserted-but-unverified in exactly the pattern of C-6
and C-1, and it should be reviewed by whoever owns security. Ticket
TECH-017. **Do not describe this externally.**

---

### C-19. `x-default` missing on ten English pages. Low.

The 5 English guides and 5 English templates omit `x-default` while their
Spanish twins include it. Google falls back sensibly without it. Cosmetic
consistency only. Ticket TECH-003.

---

### C-20. `/safe` has no `<h1>`. Low.

The only page in the 54-route sweep with zero `<h1>` elements. It is
deliberately `noindex, nofollow`, so there is no search cost, but a
missing top-level heading is an accessibility defect on a
**personal-safety** surface, which is the worst possible page to have one
on. Ticket TECH-018.

---

### C-21. `changefreq` and `priority` on all 151 sitemap URLs. Informational, no action.

Google stopped using both in 2023. They are harmless noise. Removing them
is not worth a commit on its own. Noted so nobody files it as a finding
later.

---

## Part three: severity roll-up

| Severity | Count | Findings |
|---|---|---|
| Critical | 4 | C-1, C-2, C-3, C-8 |
| High | 6 | C-4, C-5, C-6, C-7, C-9, C-15 |
| Medium | 8 | C-10, C-11, C-12, C-13, C-14, C-16, C-17, C-18 |
| Low | 2 | C-19, C-20 |
| Informational | 1 | C-21 |

**All four Critical findings are the same shape: something true was
published once, the underlying fact changed, and the published copy did
not.** They are not SEO failures. They are a claims-hygiene failure with
no owning process. The most durable fix in this audit is not any single
ticket, it is establishing that pricing, compliance posture and feature
availability each have exactly one source of truth that the public
surfaces read from rather than copy.

---

## Part four: a note on this audit's own reliability

One finding in this audit was **wrong on first pass and corrected before
delivery**. The initial sweep reported "zero hreflang across the entire
site". It was a false negative: the sweep matched `hreflang="`
case-sensitively, and Next.js emits the React prop name verbatim as
`hrefLang="`. HTML attribute names are case-insensitive, so what ships is
valid and Google reads it correctly. Only the audit's own regex could not.

Re-run case-insensitively, hreflang is present on 28 URLs, fully
reciprocal, and correct. Had that finding shipped, it would have
commissioned a week of work to rebuild something that already worked.

It is recorded here rather than quietly fixed because it is the specific
failure mode this kind of audit is prone to: **a tool's silent miss reads
identically to a real absence.** Every negative finding above was
therefore confirmed by at least two independent methods where a method
existed to do so.
