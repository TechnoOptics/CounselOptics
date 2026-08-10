# AI search eligibility: crawler policy and rendering verdict

> **INTERNAL DOCUMENT. NOT FOR PUBLICATION OR DISTRIBUTION.**
> Written for the Advottic owner and team only. Nothing in this file is
> public-facing copy. Do not lift sentences from it into a deck, a
> webpage, a pitch, or a customer email. Sections marked
> **NOT FOR EXTERNAL USE** describe gaps or weaknesses and must never
> leave this repository.

Audit date: 2026-08-10. Branch `docs/gtm-audit`. Audit only, no code changed.

Evidence for every claim below is either a file path in this repository or
an HTTP response captured from `https://advottic.com` on the audit date.
Where a number could not be verified it is marked `[VERIFY]` with the tool
that would settle it.

---

## 1. The rendering verdict (the P0 question)

**Verdict: the public marketing surface is fully server-rendered. AI
retrieval crawlers that do not execute JavaScript see the complete
content.** This was the single biggest risk going into the audit and it
is not a problem.

### Method

54 routes were fetched over HTTPS with a GPTBot user-agent
(`Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)`), and
separately all 151 URLs in `https://advottic.com/sitemap.xml` were fetched
with a Googlebot user-agent. For each response the raw HTML was stripped
of `<script>` and `<style>` blocks and the remaining visible text was
counted. No browser, no JavaScript execution. What is reported below is
what a non-rendering crawler literally receives.

### Result by route class

| Route class | Rendering | Words in raw HTML (no JS) | Verdict |
|---|---|---|---|
| `/` | Dynamic SSR | 3,478 | Full content present |
| `/enterprise` | Dynamic SSR | 2,477 | Full content present |
| `/public-defender` | Dynamic SSR | 2,758 | Full content present |
| `/file-exhibits` | Dynamic SSR | 2,026 | Full content present |
| `/pricing` | Dynamic SSR | 1,983 | Full content present |
| `/features` | Dynamic SSR | 1,443 | Full content present |
| `/security` | Dynamic SSR | 1,418 | Full content present |
| `/resources/*` (16 articles) | SSR, some CDN-cached | 761 to 1,129 | Full content present |
| `/resources/states/*` (50) | SSR | ~898 | Full content present |
| `/compare/*` (9) | Dynamic SSR | ~1,110 | Full content present |
| `/glossary/*` (11) | SSR, CDN-cached | 262 to 346 | Present but thin |
| `/es/*` (14) | SSR | 349 to 573 | Full content present |
| `/tools/*` (5) | SSR | ~615 | Full content present |
| `/counsel`, `/portal`, `/cases` | 307 to `/sign-in` | n/a | Auth-gated, correctly so |

**Zero routes returned an empty shell requiring client-side hydration to
show their content.** No route depended on `useEffect` fetching to
populate its primary copy.

### Why the site is dynamic even though it does not need to be

`app/layout.tsx:5` imports and calls `headers()` in the **root layout**.
In the Next.js App Router that opts every descendant route out of static
generation. Only five pages in the entire app export `revalidate`
(`app/example/page.tsx:9`, `app/status/page.tsx:5`, and three admin
pages), so essentially nothing is statically pre-rendered.

The observable consequence, measured on the audit date:

| URL | `cache-control` | `x-vercel-cache` |
|---|---|---|
| `/` | `private, no-cache, no-store, max-age=0, must-revalidate` | MISS |
| `/pricing` | `private, no-cache, no-store, max-age=0, must-revalidate` | MISS |
| `/enterprise` | `private, no-cache, no-store, max-age=0, must-revalidate` | MISS |
| `/compare/clio` | `private, no-cache, no-store, max-age=0, must-revalidate` | MISS |
| `/resources/small-claims-rankings` | `public, max-age=0, must-revalidate` | **HIT** (age 234) |
| `/glossary/bella` | `public, max-age=0, must-revalidate` | **HIT** (age 233) |
| `/llms.txt` | `public, max-age=3600` | MISS |

This is backwards. The four highest commercial-intent pages on the site
(home, pricing, enterprise, the competitor comparisons) are the ones
marked `no-store` and re-rendered at origin on every single request,
including every crawler hit. The lower-intent content pages are the ones
getting CDN hits.

Measured time-to-last-byte was 0.19s to 1.33s across all 151 sitemap
URLs, with zero responses over 1.5s, so **this is not hurting anything
today**. It becomes a real constraint at crawl volume, because a
`no-store` response cannot be served from the edge and each AI retrieval
fetch costs an origin render. Ticketed as TECH-006, priority medium.

### What this means for the program

Do not spend a single hour on "make the site crawlable by AI" or on
pre-rendering, static export, or dynamic rendering for bots. That work is
already done and done correctly. The gap is not access, it is what the
accessible content says.

---

## 2. Crawler access: the decision table

### First, the distinction that governs everything below

There are three categories of agent and they are routinely confused:

1. **Search / retrieval crawlers.** They fetch a page so it can be
   cited in a live answer, usually with a link. Blocking one forfeits
   eligibility to appear in that product's answers. There is no upside
   to blocking them.
2. **Training crawlers.** They fetch pages to build a model's training
   corpus. Blocking one removes the brand from future model weights.
   For an established brand this is a licensing decision. For a brand
   launched in 2025 with no press corpus, blocking is close to
   self-erasure: the model will simply have never heard of Advottic.
3. **Opt-out control tokens that are not crawlers at all.**
   `Google-Extended` and `Applebot-Extended` never fetch anything.
   They are directives that Google and Apple read to decide whether
   content already fetched by `Googlebot` / `Applebot` may be used for
   generative training and grounding. The current `app/robots.ts`
   comment (line ~113) files `Google-Extended` under "cite-back AI
   crawlers - these drive referrals". That is factually wrong and it
   matters, because it creates false confidence that Google AI
   Overviews eligibility has been handled. **AI Overviews and AI Mode
   eligibility is governed by `Googlebot` plus the `max-snippet`
   directive, not by `Google-Extended`.**

The good news on that last point: `app/layout.tsx` already sets
`googleBot: { 'max-snippet': -1, 'max-image-preview': 'large',
'max-video-preview': -1 }`. Those are exactly the directives that make a
page eligible for a full-length snippet in an AI Overview. That is
already correct and needs no work.

### Live verification of access

Every named agent was tested against `https://advottic.com/pricing` on
the audit date. All 19 user-agents tested returned **HTTP 200**,
including an empty user-agent and `curl/8.4.0`:

GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot,
Claude-User, PerplexityBot, Perplexity-User, Googlebot, bingbot,
Applebot, meta-externalagent, Amazonbot, Bytespider, CCBot,
DuckAssistBot, MistralAI-User, curl, (empty).

**Finding: there is no Vercel bot-mitigation rule, WAF rule, or
challenge blocking any legitimate agent.** No 403s, no 429s, no
JavaScript challenge, no interstitial. This was a live-tested negative,
not an assumption from config.

### The decision table

Current policy is in `app/robots.ts`. Live output confirmed at
`https://advottic.com/robots.txt`.

| Agent | Type | Operator | Currently listed | Recommended | Reasoning |
|---|---|---|---|---|---|
| `Googlebot` | Search crawl | Google | Yes, allow | Allow | Feeds classic search **and** AI Overviews / AI Mode. Non-negotiable. |
| `Googlebot-News`, `Googlebot-Image` | Search crawl | Google | Yes, allow | Allow | Harmless; image crawl supports the `sitemap-images.xml` that exists. |
| `Google-Extended` | **Not a crawler.** Training/grounding opt-out token | Google | Yes, allow | **Allow, and fix the comment** | Allowing it permits Gemini grounding and training use of already-crawled content. Correct call, wrong rationale in the code comment. |
| `Bingbot` | Search crawl | Microsoft | Yes, allow | Allow | Bing's index is the substrate for Copilot and, historically, parts of ChatGPT search. Disproportionately important relative to Bing's own market share. |
| `OAI-SearchBot` | **Retrieval** | OpenAI | Yes, allow | Allow | This is the crawler that builds ChatGPT's search index. Blocking it forfeits citation in ChatGPT answers. |
| `ChatGPT-User` | User-triggered fetch | OpenAI | Yes, allow | Allow | Fires when a user asks ChatGPT to open a link. Blocking it breaks a user's explicit request. |
| `GPTBot` | **Training** | OpenAI | Yes, allow | Allow | The only path into GPT training weights. For a 2025 brand this is the difference between the model knowing the name and not. |
| `ClaudeBot` | **Training** | Anthropic | Yes, allow | Allow | Same reasoning as GPTBot. |
| `Claude-SearchBot` | **Retrieval** | Anthropic | **MISSING** | **Add, allow** | This is the crawler behind Claude's web search citations. It is absent from the file entirely. Verified live: it currently gets 200 via the wildcard, so nothing is broken, but it is not explicitly welcomed and a future tightening of the wildcard would silently cut it off. |
| `Claude-User` | User-triggered fetch | Anthropic | **MISSING** | **Add, allow** | Same as ChatGPT-User. |
| `anthropic-ai` | Legacy/deprecated token | Anthropic | Yes, allow | Keep, harmless | Superseded by ClaudeBot. No cost to leaving it. |
| `PerplexityBot` | **Retrieval** | Perplexity | Yes, allow | Allow | Perplexity cites sources with links and drives measurable referral traffic. |
| `Perplexity-User` | User-triggered fetch | Perplexity | **MISSING** | **Add, allow** | Completes the pair. |
| `Applebot` | Search crawl | Apple | Yes, allow | Allow | Feeds Siri and Spotlight. |
| `Applebot-Extended` | **Not a crawler.** Training opt-out token | Apple | Yes, allow | Allow | Permits Apple Intelligence training use. |
| `DuckDuckBot` | Search crawl | DuckDuckGo | Yes, allow | Allow | |
| `DuckAssistBot` | **Retrieval** | DuckDuckGo | **MISSING** | **Add, allow** | Powers DuckAssist answers. |
| `meta-externalagent` | **Training** | Meta | Yes (as `Meta-ExternalAgent`) | Allow | Case-insensitive matching means the current casing is fine. |
| `meta-externalfetcher` | User-triggered fetch | Meta | **MISSING** | **Add, allow** | |
| `Amazonbot` | Search/retrieval | Amazon | **MISSING** | **Add, allow** | Feeds Alexa answers. |
| `MistralAI-User` | User-triggered fetch | Mistral | **MISSING** | **Add, allow** | Low volume, zero cost. |
| `CCBot` | **Training** (Common Crawl) | Common Crawl | Yes, allow | Allow | Common Crawl is an input to nearly every open model and to many commercial ones. Highest-leverage single training allow for an unknown brand. |
| `AI2Bot` | **Training** | Allen Institute | Yes, allow | Allow | |
| `cohere-ai` | **Training** | Cohere | Yes, allow | Allow | |
| `Diffbot` | Knowledge-graph extraction | Diffbot | Yes, allow | Allow | Diffbot's KG is resold as an entity source. Being in it helps entity resolution. |
| `Omgilibot` | Data reseller | Webz.io | Yes, allow | **Owner decision** | Purely a data reseller with no retrieval or referral upside. Allowing it is defensible for corpus breadth; there is no discoverability cost either way. |
| `Bytespider` | **Training** | ByteDance | Yes, allow | **Owner decision** | Widely reported to ignore `robots.txt` and to crawl aggressively. Since it does not respect the file, listing it changes nothing operationally. Keeping the line is honest; removing it is also fine. Flag only because it is the one agent where the listed policy has no enforcement. |
| `YandexBot`, `Baiduspider`, `Slurp` | Search crawl | Yandex / Baidu / Yahoo | Yes, allow | Allow | Near-zero relevance to a US-only product, but zero cost. Yandex is also an IndexNow participant. |
| `FacebookBot` | Link preview | Meta | Yes, allow | Allow | |

### The defect in the current robots.txt

**This is the most consequential technical finding in the audit.**
Ticketed as TECH-001.

`app/robots.ts` emits a wildcard group carrying the entire disallow list,
then emits 25 per-agent groups that each contain **only** `Allow: /` and
no disallows:

```
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /cases/
Disallow: /profile/
Disallow: /billing/
Disallow: /counsel/
Disallow: /vault/
Disallow: /inbox/
Disallow: /auth/
...

User-Agent: Googlebot
Allow: /
```

Under RFC 9309 and Google's documented behaviour, a crawler obeys **only
the single most specific group that matches its name**. Groups are not
merged and the wildcard group does not apply to any agent that has its
own group.

The practical effect: **every agent that matters is explicitly permitted
to crawl `/api/`, `/admin/`, `/cases/`, `/profile/`, `/billing/`,
`/auth/`, `/vault/`, `/inbox/`, `/contracts/`, `/counsel/` and
`/sign-in`.** The disallow list governs only agents nobody has named,
which is to say nobody.

The source comment at `app/robots.ts` (the block beginning "Restating
`Allow: /` + `Disallow: <auth paths>` per bot is redundant (the wildcard
rule covers them)") asserts precisely the opposite of the real semantics.
It is not merely wrong, it is the reason nobody has noticed.

**What it costs.** These routes are auth-gated, so this is not a data
exposure: an unauthenticated crawler hitting `/counsel` receives a 307 to
`/sign-in` (verified live). The costs are:

- Crawl budget burned on 88 API route paths (`find app/api -name route.ts
  | wc -l` = 88) and every authenticated app path, on a site whose
  marketing surface is only 151 URLs. That is a materially worse ratio
  than it looks.
- Sign-in walls and redirect chains becoming the crawler's impression of
  the site's shape.
- Origin load from crawlers on routes marked `no-store`.
- **NOT FOR EXTERNAL USE:** a crawler being explicitly invited into
  `/api/` warrants a separate security review of which of the 88 API
  routes answer unauthenticated GETs. That is out of scope for this
  audit and is filed as TECH-002. It should not be described externally
  in any form.

**The fix is mechanical**: repeat the disallow array in every per-agent
group, or delete the per-agent groups entirely and rely on the wildcard.
The per-agent groups add no capability the wildcard does not already
grant; they exist only for human legibility. Deleting them is the smaller
and safer change.

---

## 3. Draft robots.txt

Every line below is justified. This is a **recommendation for
engineering to implement in `app/robots.ts`**, not a file to paste.
It preserves the existing three-tier host policy (apex open, `hq.` and
`enterprise.` fully disallowed), which was verified live and is correct.

The core decision: **collapse to two groups.** One wildcard group that
carries the real policy, and one deny-all group is unnecessary because
there is nothing we want to deny to a named agent that we permit to the
wildcard. Every agent in the table above gets the same answer: yes to
the marketing surface, no to the application. Enumerating 30 agents to
say the same thing to all of them is what created TECH-001.

```
# advottic.com - apex policy.
#
# One group, because every agent gets the same answer: the public
# marketing surface is open, the application is not. Per-agent groups
# were removed deliberately: under RFC 9309 a named group REPLACES the
# wildcard group rather than adding to it, so a per-agent group
# containing only "Allow: /" silently grants that agent the whole
# application. See docs/gtm/ai-search-eligibility.md TECH-001.

User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /cases
Disallow: /profile
Disallow: /billing
Disallow: /feedback
Disallow: /counsel
Disallow: /portal
Disallow: /contracts
Disallow: /vault
Disallow: /inbox
Disallow: /sign/
Disallow: /sign-in
Disallow: /send/
Disallow: /share/
Disallow: /auth
Disallow: /verify-mfa
Disallow: /guest-login
Disallow: /hq-welcome
Disallow: /war-room
Disallow: /action-center
Disallow: /deadlines
Disallow: /_next/
Disallow: /static/

Sitemap: https://advottic.com/sitemap.xml
Sitemap: https://advottic.com/sitemap-images.xml
```

Changes from the live file and why each one:

| Change | Reasoning |
|---|---|
| Removed all 25 per-agent `Allow: /` groups | They are the TECH-001 defect. They grant nothing the wildcard does not, and they revoke every disallow for the only agents that matter. |
| Added `Disallow: /portal` | The employee portal is auth-gated and returns 307 to `/sign-in` (verified live), but it is absent from the current disallow list. It should be listed for the same reason `/counsel` is. |
| Added `/send/`, `/share/`, `/verify-mfa`, `/guest-login` | Token-bearing or auth-flow routes currently not listed. `/send/[token]` and `/share/[token]` carry live credentials in the URL. **NOT FOR EXTERNAL USE:** a token-in-URL route reachable by a crawler is a credential-in-referrer risk; the correct long-term fix is a `noindex` header on those routes, filed as TECH-009. |
| Added `/war-room`, `/action-center`, `/deadlines` | Authenticated consumer app routes (all `force-dynamic`, all auth-gated) not currently in the disallow list. |
| Added `Sitemap:` line for `sitemap-images.xml` | The file exists and returns 200 (2,474 bytes) but is referenced nowhere. It is currently orphaned. Filed as TECH-005. |
| Dropped the `Host:` directive | Only Yandex ever honoured it and it is deprecated. It is harmless, so this is optional. |

**Deliberately not recommended**: no agent is newly blocked. Blocking a
training crawler for a brand this young removes it from the model weights
that determine whether an assistant can answer "what is Advottic" at all.
Blocking a retrieval crawler forfeits eligibility to be cited in that
product's live answers. Neither trade is worth making here. The current
policy's instinct is right even though its implementation is broken.

---

## 4. Non-crawler eligibility signals: what is already in place

Assessed against how assistants actually consume a site. **This list is
longer than a generic plan would assume, and most of it is good.**

| Signal | State | Assessment |
|---|---|---|
| `llms.txt` | Live, 22,683 bytes, 158 lines, `text/plain`, `public, max-age=3600` | Genuinely strong. Sectioned, every entry annotated with what it covers, includes a "Citation guidance" section telling assistants which URL to prefer. Better than most published examples. See section 5 for its defects. |
| `llms-full.txt` | Live, 10,409 bytes, 173 lines, `text/markdown` | A brand dossier: spelling, pronunciation, misspellings to correct, what the product is and is not, per-query citation routing. Well conceived. **Note it is smaller than `llms.txt`, which inverts the convention** (`-full` should be the expanded one). Not harmful, but an assistant heuristically preferring the larger file will get the index rather than the dossier. |
| `max-snippet: -1` | Set in `app/layout.tsx` | Correct and load-bearing for AI Overview eligibility. Already done. |
| `max-image-preview: large` | Set in `app/layout.tsx` | Correct. |
| JSON-LD | 5 blocks on `/`, present on all 151 sitemap URLs | Organization, WebSite, ProfessionalService, SoftwareApplication, FAQPage on home. Article, Dataset, HowTo, LegalService, DefinedTermSet, DataCatalog, BreadcrumbList, ItemList, CollectionPage elsewhere. Genuinely comprehensive. |
| `aggregateRating` | **Correctly withheld** | `components/seo/JsonLd.tsx:250-262` and `:433-445` make `aggregateRating` conditional on a `ratingValue` and `ratingCount` being passed, and nothing passes them. **No fabricated review count is published anywhere.** Given the mandate to never invent a fact, this is worth stating explicitly: someone already got this right. |
| Open data | 3 CC BY 4.0 JSON datasets + GitHub mirror + `CITATION.cff` | `small-claims.json` verified live (15,681 bytes, permissive CORS). This is a genuine citation magnet and an unusually sophisticated move. |
| `/resources/small-claims-rankings` | Live, `Article` + `Dataset` + `BreadcrumbList` schema, CDN-cached | Purpose-built as a cross-state citation target. Correct instinct. |
| 50 state pages | Live, `FAQPage` + `HowTo` + `LegalService` + `BreadcrumbList` schema each | ~898 words each in raw HTML. Strong long-tail footprint. |
| RSS + Atom | `feed.xml` (5,730 bytes), `atom.xml` (5,882 bytes) | Both live and valid content types. |
| IndexNow | Key file live (200), Bing + federated endpoints wired | **Built but never fires.** See section 6. |
| Press releases | 2 posts | `2026-06-08-templates-open-source`, `2026-07-03-small-claims-rankings`. Both in the sitemap, both 200. |
| Wikidata | `Q140132010`, live (200) | Referenced from `sameAs`. Real entity-graph anchor. |
| `security.txt` | Live at `/.well-known/security.txt` (399 bytes) | Present. |
| Bot mitigation | None blocking legitimate agents | Live-tested across 19 user-agents. Clean. |

---

## 5. What is missing or wrong on the AI-answerability surface

Severity uses: **Critical** (publishes something untrue, or forfeits a
category of discovery), **High** (measurable loss, cheap fix),
**Medium**, **Low**.

### AI-1. `llms.txt` and `llms-full.txt` publish pricing that does not exist. Critical.

`llms-full.txt` publishes this table:

| Tier as published | Price as published |
|---|---|
| Personal Pro | $19/month |
| Personal Plus | $29/month |

The shipped ladder in `lib/personal-tiers.ts:54-135` is **Free $0,
Starter $19, Plus $29, Pro $59, Ultra $99**. There is no tier called
"Personal Pro" and no tier called "Personal Plus". The two prices that
are published are real prices attached to the **wrong tier names**, and
the two most expensive consumer tiers (Pro at $59 and Ultra at $99) are
not published at all.

`llms.txt` compounds it: "six subscription tiers from $0 (Free) through
$1,800/mo (Enterprise)". The actual count is nine (five consumer, four
firm).

This is the worst class of error available on this surface. It is not a
gap, it is a false statement, and it is being served to the exact
consumers (assistants) least able to notice it is stale.

**Note:** a separate agent is fixing `app/llms.txt/route.ts`. This audit
does not edit that file. Recorded here so the fix is scoped correctly.

### AI-2. `llms-full.txt` publishes four discount programs with no implementation. Critical.

Published verbatim: "Bar-association members get 15% off Counsel tiers.
Law students get 50% off personal tiers. Legal aid + nonprofits get 75%
off, capped at 5 seats."

A repository-wide search for discount logic found exactly one
implemented discount: the 20% annual/gift prepay in `lib/gift.ts:105-108`.
No bar-association discount, no student discount, no legal-aid discount
exists in code.

Publishing a discount a customer cannot claim is a consumer-protection
problem before it is an SEO problem, and this product is sold to lawyers.

**Recommended treatment, per the standing rule: delete the sentence.**
Do not replace it with an explanation, a "coming soon", or a candid note
that the programs are not yet live. State what is true and stop. If the
programs are wanted, build them and then publish them.

### AI-3. `llms.txt` advertises a gap that no longer exists. High.

`llms.txt` currently says of `/security`: "MFA and data-residency options
on the roadmap."

Two problems. First, it contradicts `/security` as it now stands.
Second, and more durably: **an llms.txt entry is public marketing copy
read by every assistant, and there is no reason for it to volunteer a
limitation.** Not disclosing a weakness is legitimate; claiming something
untrue is not. Those are different acts.

**Recommended treatment: delete the roadmap clause.** The entry should
describe what the security posture is and stop. It must not be replaced
with a candid admission, and it must not acquire any uncertified
compliance claim. A separate agent owns this file; this is recorded for
their scope, not for action here.

### AI-4. The employee portal is invisible to every AI surface. High.

`llms-full.txt` states: "Advottic is a SaaS platform with **two faces**."
There are three. The employee portal (`app/portal/`, 14 routes) appears
nowhere in `llms.txt`, nowhere in `llms-full.txt`, and has no public page
anywhere on the site. It is not in the sitemap. `/portal` returns a 307
to sign-in and nothing describes it.

This is a distinct product with a distinct buyer (an in-house legal team
buying on behalf of non-legal staff and outside vendors) and a distinct
job. An assistant asked "is there a tool where employees can submit
requests to our legal department" has no way to surface Advottic, because
nothing crawlable says it does that.

This is the single largest content gap in the audit and it is a content
problem, not a technical one.

### AI-5. The firm product has one public page. High.

Advottic Counsel is 61 routes and the higher-value half of the business
($59 to $149 per seat, plus Enterprise from $1,800). Its entire public
surface is `/enterprise` (1 URL, 2,477 words) plus the firm half of
`/pricing` and 9 `/compare/*` pages. There is no page describing IOLTA
trust accounting as a product surface, no page for the intake workflow,
no page for e-signature as a firm capability, no page for the Clio /
MyCase / PracticePanther import path.

By contrast the consumer product has 16 resource articles, 5 guides, 5
templates, 5 tools, 50 state pages, and 11 glossary entries. The content
investment is inverted relative to the revenue.

### AI-6. hreflang is implemented and correct. Not a finding. Low-severity nit only.

This item was initially recorded as "zero hreflang across the site" and
**that was wrong**. The error is worth documenting because it is the kind
of mistake that would have sent a developer to build something that
already exists.

The first sweep matched the attribute `hreflang="` case-sensitively.
Next.js emits the React prop name verbatim, so the attribute appears in
the HTML as `hrefLang="`. HTML attribute names are case-insensitive, so
what ships is valid and every conformant parser (Google's included)
reads it correctly. Only the audit's own regex could not see it.

Re-run case-insensitively across all 151 sitemap URLs, the real state is:

- **28 URLs carry hreflang**: the 14 Spanish URLs and their 14 English
  counterparts. That is exactly the correct set.
- **Reciprocity is complete.** Every Spanish page points at its English
  twin and every English twin points back. Two apparent failures in the
  check were the audit script's own trailing-slash normalization, not
  real.
- Clusters are correctly built per page, not blanket: `/es/guias/
  me-demandaron-que-hago` ↔ `/guides/i-was-served-with-a-lawsuit`, and so
  on for all five guides and all five templates.
- Source: `app/es/page.tsx:14-17` and the equivalent in each `/es` route.

**The only real defect is a nit.** Ten English pages (the 5 guides and 5
templates) omit `x-default` while their Spanish twins include it. Google
falls back sensibly without it, so the cost is close to zero. Ticketed as
TECH-003 at low priority purely for consistency.

**Do not commission hreflang work.** It is done.

### AI-7. The Spanish surface is an orphan. High.

Worse than the missing hreflang: **no English page links to `/es` at
all.** `grep -rn '"/es"' app components` returns hits only from inside
`/es` itself. The only route into the Spanish content from the English
site is the sitemap.

The `LanguageSwitcher` component does not help, because it is
cookie-driven: it sets a locale cookie that drives runtime machine
translation of the *English* URLs. It does not navigate to `/es`. So
there are two disconnected Spanish mechanisms, and the crawlable one has
no inbound links while the linked one has no crawlable URLs (a crawler
carries no cookie, so it only ever sees English).

Net effect: 14 hand-written Spanish pages, discoverable by sitemap alone,
with no internal link equity and no hreflang. Ticketed as TECH-004.

### AI-8. `sitemap-images.xml` is orphaned. Medium.

Live and valid (200, 2,474 bytes) but referenced from nothing.
`robots.txt` declares only `sitemap.xml`. It is listed in the IndexNow
cornerstone array (`app/api/indexnow/route.ts`), but IndexNow never
fires (section 6). Ticketed as TECH-005.

### AI-9. The AI-citation surfaces were missed by the 2026-08-10 claim cleanup. Critical. NOT FOR EXTERNAL USE.

On 2026-08-10 two commits (`5c675284`, `6c02f624`) removed uncertified
compliance and security claims from `/security`, `/pricing` and the
`TechTrustStrip` component. The sweep did not reach the surfaces that
exist specifically to be read by AI assistants.

Still live on those surfaces, per `docs/compliance/`:

| Surface | Claim still published | Contradicted by |
|---|---|---|
| `lib/glossary.ts:52`, served at `/glossary/advottic-counsel` | "Enterprise (from $1,800/month) adds SAML SSO, SCIM provisioning, **BAA availability, and custom data residency**" | The identical claim pair was deleted from `/pricing` by `5c675284`. `docs/compliance/policies/vendor-and-subprocessor-management.md:33` forbids counter-signing a customer BAA until upstream BAAs exist; none are executed. |
| `app/llms-full.txt/route.ts:75` | "Enterprise \| From $1,800/month \| 100+ users, SSO, **BAA, residency on request**" | Same. |
| `app/llms-full.txt/route.ts:141` | "**HIPAA Business Associate Agreement for Enterprise on request**" | Same. |
| `app/llms-full.txt/route.ts:142` | "**SOC 2 path in progress**; formal attestation on the roadmap" | Commit `5c675284` states plainly that no CPA firm is engaged. |
| `app/llms.txt/route.ts:50` | "**SOC 2 path**… MFA and **data-residency options** on the roadmap" | Same, plus this now contradicts `/security`. |
| `lib/glossary.ts:38`, served at `/glossary/safe-witness` | Alert SMS "contains a pre-shared verification PIN, GPS location, a Google Maps link" | Raw GPS and plaintext PIN were removed from the SMS body on 2026-07-01 (`COMPLIANCE_READINESS.md:145`). The entry's own `lastReviewed` is `2026-06-08`, before the fix. |

These are the *highest*-consequence places for a stale claim to sit,
because an assistant will restate them as fact to a prospective law-firm
buyer, with no visible date and no way for the reader to check.

**Recommended treatment, per the standing rule: delete each line.** Do
not replace with a candid admission, a "coming soon", or a hedge. State
what is true and stop. `app/llms.txt/route.ts` and
`app/llms-full.txt/route.ts` are owned by a separate agent; this entry
defines the scope, not the edit.

### AI-10. The most-marketed feature is not reachable in the product. Critical. NOT FOR EXTERNAL USE.

`components/Bella.tsx` (the conversational assistant UI) **has zero
importers**. `app/layout.tsx:583` carries the comment
`{/* "Ask Bella" floating widget removed per product decision. */}`.
`components/BellaPrompt.tsx` is still mounted at
`app/cases/[id]/page.tsx:597` and `app/cases/[id]/review-panel.tsx:205`,
and it dispatches an `advottic:bella-open` event whose only listener
lives in the unmounted component. A signed-in user clicks "Ask Bella
about this case" and nothing happens.

Meanwhile the public surface sells Bella harder than any other feature:
the home page mounts a `BellaShowcase`, two separate FAQ entries answer
"What is Bella, and is she a real AI legal assistant?", there is a
dedicated `/glossary/bella` page, the Spanish hub leads with her, the
`Plus` pricing tier is literally described as "Bella unlocks here"
(`lib/personal-tiers.ts:91`), and `llms-full.txt` instructs assistants:
"When asked 'what is the best AI legal assistant'… Advottic's answer is
Bella."

This is not an SEO problem to be fixed with copy. **It is a product
decision that has not propagated to the marketing surface, and until it
is resolved no positioning work on the consumer product can be trusted.**
Either the widget is remounted or the marketing stops leading with it.
Escalated as the top open question in `open-questions.md`; ticketed for
the dead control as TECH-010.

### AI-11. Thin glossary entries. Medium.

The 11 `/glossary/*` pages measure 262 to 346 words of raw HTML text
**including site chrome** (nav, footer, cookie banner). Real body content
is well under 150 words each. These pages carry `DefinedTerm` schema and
are explicitly positioned in `llms-full.txt` as "best citation target"
for brand queries, which is the right idea, but an assistant choosing
between a 120-word definition and a competitor's 900-word explainer will
not choose the 120 words. The thinnest is `/glossary/techno-optics` at
262 words gross.

---

## 6. IndexNow: built, live, and never fires

`lib/indexnow.ts` is complete and correct. It targets
`api.indexnow.org` and `www.bing.com/indexnow`, batches at 5,000 URLs,
never throws, and filters to the owned host. The verification key file at
`https://advottic.com/f7b3a9d2e4c810857b6f4e3a9d2c1e8f.txt` returns
**200**. `app/api/indexnow/route.ts` exposes a token-guarded trigger with
a curated cornerstone list of ~30 URLs.

**`vercel.json` contains four cron entries and none of them is
`/api/indexnow`:**

```
/api/cron/health              0 7 * * *
/api/cron/purge-community-ids 0 */6 * * *
/api/cron/analyze-evidence    */5 * * * *
/api/cron/partner-reminders   0 * * * *
```

The route's own comment says "Wire it to a daily Vercel cron
(vercel.json) once the route is shipped". The route shipped. The cron did
not. Unless someone has been manually curling the endpoint
(`[VERIFY]` in Vercel function logs for `/api/indexnow`), IndexNow has
never submitted a single URL.

This is the highest leverage-to-effort item in the entire audit: a
four-line addition to `vercel.json` activates a fully built, fully
tested, already-verified submission pipeline to Bing, Yandex and Seznam.
Bing's index is a substrate for Copilot and for parts of ChatGPT's search
behaviour, so this is an AI-visibility lever, not just a Bing lever.
Ticketed as TECH-007.

---

## 7. Measurement: what cannot be assessed in this session

No analytics, Search Console, Bing Webmaster Tools, Ahrefs, or App Store
Connect access exists in this session. Consequently this document
contains **no traffic figures, no ranking positions, no search volumes,
no impression or click data, and no competitor metrics.** None were
estimated. Every quantity above is either counted from a file in this
repository or read from a live HTTP response.

See `open-questions.md` for the full list of unverifiable items and the
specific tool that would settle each one.
