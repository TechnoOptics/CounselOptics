# Context block

> **INTERNAL DOCUMENT. NOT FOR PUBLICATION OR DISTRIBUTION.**
> Written for the Advottic owner and team only. This is a working brief,
> not marketing copy. Do not lift sentences from it into a deck, a
> webpage, a pitch, or a customer email. Sections marked
> **NOT FOR EXTERNAL USE** describe gaps, unexecuted agreements or unmet
> controls and must never leave this repository.

Compiled 2026-08-10 on branch `docs/gtm-audit`. Audit only, no code
changed. Every field below is cited to a file path in this repository or
to a live URL fetched on the audit date. Fields that are genuinely not
derivable are marked `[OWNER INPUT NEEDED]`. Nothing is estimated.

---

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Product name | **Advottic** | `package.json:2` (`"name": "advottic"`) |
| Repository name | **CounselOptics** | Working directory; first commit `d224aed6` (2026-04-24) is titled "Initial commit" and names the CounselOptics MVP |
| Relationship between the two | CounselOptics is the **historical repository name only**. It was the MVP working title and was never the product name in shipped code. `package.json` has said `advottic` since. There is no user-facing surface, domain, entity or trademark using "CounselOptics". Treat it as an internal repo alias with zero GTM relevance. | `package.json:2`; git log |
| Legal entity | **Techno Optics LLC**, dba Advottic | `components/seo/JsonLd.tsx` Organization `legalName`; `app/layout.tsx` `publisher: 'Techno Optics LLC'`; global footer at `app/layout.tsx:732` |
| Jurisdiction of the entity | Minnesota, USA | `llms-full.txt` live: "Techno Optics LLC, registered in Minnesota" |
| Founder | Abel Muchai, Founder and CEO | Organization JSON-LD `founder`, live on `/`; `/people/abel-muchai` |
| Founding year | 2025 (brand launch) | Organization JSON-LD `foundingDate: "2025"` |
| Wikidata entity | `Q140132010` (verified live, HTTP 200) | Organization `sameAs` |

### Address discrepancy. NOT FOR EXTERNAL USE.

Two different cities are published for the same company:

- Organization JSON-LD (live on every page): `addressLocality: "Minneapolis", addressRegion: "MN"`
- `llms-full.txt` (live): "Location: **Edina**, Minnesota, USA"

Both are served to search engines and AI assistants simultaneously.
Inconsistent name/address data measurably weakens entity resolution and
is the kind of detail a knowledge-graph builder treats as a signal that
the entity is unreliable. One of the two is wrong and only the owner can
say which. Ticketed as TECH-011. `[OWNER INPUT NEEDED]`. The registered
address on the Minnesota Secretary of State filing settles it.

---

## 2. Domains

| Domain | Role | Robots policy | Verified |
|---|---|---|---|
| `advottic.com` | Canonical apex. All public content. | Open to crawlers on marketing paths | Live, HTTP 200 |
| `www.advottic.com` | Alias | Redirects to apex | Live. **Redirect is HTTP 307 (temporary), not 301/308.** See TECH-008 |
| `hq.advottic.com` | Staff console (`/admin/*`) | `Disallow: /` | Verified live; correct |
| `enterprise.advottic.com` | Host alias for `/counsel/*` | `Disallow: /` | Verified live; correct |
| `<firm>.advottic.com` | Per-firm tenant subdomains | `Disallow: /` | `app/robots.ts` non-apex branch; tenant routing in `middleware.ts` |

Subdomain routing lives in `middleware.ts`; the `www` collapse is in
`next.config.mjs` `redirects()` with `permanent: false`. The code comment
there says "Promote to `permanent: true` after a clean week". It has not
been promoted.

No secondary marketing domain, no ccTLDs, no vanity redirect domains were
found. `[OWNER INPUT NEEDED]` if any exist outside this repository.

---

## 3. The three products

**This is the central fact of the brief.** Advottic is not one product
with one buyer. It is three products sharing one domain, one auth system
and one billing spine. A single positioning statement across all three
would be wrong, and the current public surface is written as if there
were two.

`llms-full.txt` states verbatim: "Advottic is a SaaS platform with **two
faces**." That is the error to correct.

### 3.1 Consumer case-building app

| | |
|---|---|
| **Where** | `app/cases`, `app/action-center`, `app/war-room`, `app/deadlines`, `app/vault`, `app/contracts`, `app/inbox`, `app/file-exhibits`, `app/decoder`, `app/safe`, `app/review-my-document`, `app/profile`, `app/billing` |
| **Buyer** | An individual handling their own legal matter, usually without a lawyer. Single-seat: `lib/personal-tiers.ts` has no seat field at all. |
| **Job to be done** | Turn scattered evidence into a dated, coherent, exhibit-numbered record that can be taken to court or handed to an attorney. |
| **Emotional context** | The user arrives in legal distress. This governs all copy (section 8). |
| **Evidence for the buyer definition** | `app/features/page.tsx:22-24` "calm case preparation for people handling their own matter"; `lib/personal-tiers.ts:59` "Start a single case"; `app/cases/page.tsx:26-35` explicitly redirects firm users away from this surface |
| **Distinctive features** | Auto-numbered exhibit packet PDF; Decoder (photograph a court notice, get plain English); Safe Witness personal-safety alerting with a Wear OS watch app; case timeline; group/community cases; free tier links out to `/find-counsel` and public-defender directories |

### 3.2 Firm practice-management product (Advottic Counsel)

| | |
|---|---|
| **Where** | `app/counsel`, **61 page routes** |
| **Buyer** | A law firm. Sold per seat. Roles: owner, admin, legal, plus a scoped `counsel_guest` co-counsel persona (`lib/persona.ts:40-55`) |
| **Job to be done** | Run the whole practice in one audited workspace: intake with conflict check, matters, documents, contracts, letters on firm letterhead, e-signature, calendar and deadlines, IOLTA trust accounting with three-way reconciliation, time and billing |
| **Evidence** | `lib/menu-config.ts:41-110`, a 7-section, 28-item rail: Overview, Matters, Self-service, People, Growth, Finance, Support. `lib/glossary.ts` `advottic-counsel`: "the firm-side product inside the Advottic platform" |
| **Entry points** | `/counsel/onboarding` (self-serve Solo and Small Firm), `/counsel/request` (sales-led Growing and Enterprise) |
| **Notable** | Per-firm menu customization stored in `firms.metadata.menuConfig`; `hide_time_billing` flag; tenant subdomains from Small Firm up; CSV and bulk import from Clio, MyCase and PracticePanther |

### 3.3 Employee portal (Employee Hub)

| | |
|---|---|
| **Where** | `app/portal`, 14 page routes |
| **Buyer** | **Not separately bought.** It is a feature of the Small Firm tier and up, purchased by the firm or in-house legal team on behalf of people who are not on the legal team |
| **User** | In-house non-legal staff, and approved outside collaborators and vendors |
| **Job to be done** | Its own layout comment states it (`app/portal/layout.tsx:24-27`): "a workspace for everyone who is NOT on the legal team". `app/portal/page.tsx:29-32` names the question it answers: "who do I tell about this, and is the thing I already told them about moving" |
| **Capabilities** | File a request to legal across 12 request families (`lib/portal-request-families.ts:64-75`: new matter, contract/agreement, internal review, safekeeping, trademark/IP, NDA review, vendor/MSA, employment, compliance, litigation hold, demand letter, other); check a document against the firm's policy library; track requests; read and download documents; self-service fill-sign-download forms; calendar; assigned trainings |
| **Access model** | `externalView` (`app/portal/page.tsx:~60`) collapses the hub to status and documents for vendors. Design rule in code: "a capability the firm has not granted is absent rather than present and dead" |

**GTM consequence.** This third product has **no public page, no sitemap
entry, no llms.txt mention and no marketing copy anywhere.** It is the
product with the clearest enterprise buyer (an in-house legal team with a
request backlog) and it is entirely invisible. See
`audit-current-state.md` finding C-4.

---

## 4. Feature inventory

Derived from `lib/menu-config.ts`, `app/portal/layout.tsx:180-272` and
the route tree. Counts are measured, not estimated.

### Firm surface (`lib/menu-config.ts:41-110`, 28 items in 7 sections)

- **Overview**: Dashboard, Impact (firm-wide case analytics), Advottic Aid (ask about cases and law), Calendar, Import data
- **Matters**: Request inbox, New intake (with conflict check), Letters (AI letters on firm letterhead), Analyze (contract breakdown and risk), Cases, Projects, Documents (case-linked vault), Contracts (repo and review), Signing
- **Self-service**: Document templates, Employee forms, Document approvals, Policy library
- **People**: Clients, Employees, Access requests, Team, Chat
- **Growth**: Leads (inbound from `/find-counsel`), Referrals (co-counsel and fee splits)
- **Finance**: Time, Billing, Trust (IOLTA ledger)
- **Support**: Help and support

Every one of the 28 hrefs resolves to a real page file. No dead links.

### Consumer surface

Cases (create, timeline, packet, courtroom, community), voice case
capture (`/cases/new/speak`), Action Center, War Room, Deadline Radar,
Decoder, Safe Witness (web plus Wear OS press-and-hold), exhibit filing,
document vault, contracts, inbox, e-signature as signer, find counsel,
public defender directory, gift a subscription, watch pairing.

### Employee portal surface

Home hub with open-request counts, ask legal (12 request families), check
a document against policy, my requests, documents, forms, calendar,
trainings, feedback, profile.

### Native and wearable

- Android: live on Google Play (`com.advottic.app`), verified 200
- Wear OS watch app: cases list, voice notes, Safe Witness press-and-hold, courtroom mode, hearing-deadline complications
- iOS: **not live.** See section 6

---

## 5. Pricing and tiers

Code is the source of truth. `docs/PRICING.md` is **stale strategy
material and must not be used as a price sheet** (see the drift table at
the end of this section).

### Consumer ladder: `lib/personal-tiers.ts:54-135`

| Slug | Display name | Price/mo | Cases | Monthly tokens | Bella | AI Review | Collaborators | Timeline | Group cases |
|---|---|---|---|---|---|---|---|---|---|
| `free` | Free | $0 | 1 | 25,000 | no | no | no | no | no |
| `starter` | Starter | $19 | 3 | 150,000 | no | no | no | no | no |
| `plus` | Plus | $29 | 8 | 500,000 | yes | no | no | no | no |
| `premium` | **Pro** | $59 | 15 | 1,500,000 | yes | yes | yes | no | no |
| `ultra` | Ultra | $99 | 40 | 3,000,000 | yes | yes | yes | yes | yes |

Note the slug/name mismatch: internal slug `premium` displays as "Pro"
(`lib/personal-tiers.ts:105-106`). Single-seat throughout; no seat field
exists. Ladder confirmed in-file on 2026-07-07.

### Firm ladder: `lib/firm-pricing.ts:35-67`

| Id | Name | Price per user/mo | Seat band | Matters per attorney | Tokens |
|---|---|---|---|---|---|
| `solo` | Solo | $59 | 1 attorney | 30 | 2.5M |
| `small_firm` | Small Firm | $99 | up to 25 | 50 | 4M/seat firm pool |
| `growing_firm` | Growing Firm | $149 | 26 to 100 | 100 | 6M/seat |
| `enterprise` | Enterprise | negotiated, **from $1,800/mo** | 101+ | uncapped | 15M+/seat |

### Other commercial facts

- **Trial: 7 days**, on every paid tier (`app/pricing/page.tsx:85,99,114,130,158,186,212`). Not 14.
- **Annual: "20% off with annual prepay"** is published copy (`app/pricing/page.tsx:348,414`). `_ANNUAL` Stripe price ids exist in `lib/entitlements.ts:70-76` but **no annual dollar amount exists anywhere in code**. `[VERIFY]` the actual annual prices in the Stripe dashboard before publishing any.
- Token top-up packs: 200K, 1M, 3M, 7M (`lib/token-packages.ts:51-86`)
- Apple IAP sells only two products and **no firm tier** (`lib/entitlements.ts:182-186`); iOS is a reader-model surface with no in-app purchase
- Legacy `STRIPE_PRICE_PRO` deliberately maps to a null slug so grandfathered subscribers keep a 1.5M grant (`lib/entitlements.ts:20-25`)

### Published pricing that is wrong. NOT FOR EXTERNAL USE.

| Surface | Published | Actual |
|---|---|---|
| Home page `SoftwareApplication` JSON-LD (`components/seo/JsonLd.tsx:198-250`) | "Personal Pro" $19, "Personal Plus" $29 | No such tiers. $19 is Starter, $29 is Plus. Pro is $59 and Ultra is $99, both omitted entirely |
| `/pricing` `Product` JSON-LD (`components/seo/JsonLd.tsx:411-440`) | `offerCount: 6`; description "Six tiers from $19/month" while `lowPrice: '0'` in the same object | Nine tiers. Free is $0, contradicting its own object |
| `llms-full.txt` pricing table | "Personal Pro $19", "Personal Plus $29" | Same stale names |
| `llms.txt` | "six subscription tiers" | Nine |
| `llms-full.txt` | Bar-association 15% off, law students 50% off, legal aid 75% off capped at 5 seats | **No discount logic exists in code** except the 20% annual/gift prepay in `lib/gift.ts:105-108` |
| `llms-full.txt`, `lib/glossary.ts`, `app/pricing/page.tsx:148` | "13+ templates" | `lib/legal-templates.ts` has 9; `lib/templates.ts` has 5. No 13-item array was found. `[VERIFY]` before reuse |

### `docs/PRICING.md` drift

`docs/PRICING.md` (dated May 2026) describes a three-tier consumer ladder
with a $39 family tier, "unlimited cases" on Personal Pro, a 14-day
trial, a $200/user Enterprise floor, per-lead marketplace pricing and
five discount programs. **None of that ships.** Use it for the competitor
table and the COGS/margin math only. Do not use its tier definitions.

---

## 6. Stage

| Signal | Evidence |
|---|---|
| Repository age | First commit 2026-04-24 (`d224aed6`). **Under four months old.** |
| Commit volume | 1,404 commits on `main` |
| Brand launch | 2025 (Organization JSON-LD `foundingDate`) |
| Web product | Live in production at `advottic.com`, actively deployed |
| Android | **Live** on Google Play, `com.advottic.app`, verified HTTP 200 |
| iOS | **Not live.** Two independent checks: the iTunes Lookup API for app id `6769638076` returns `resultCount: 0`, and a store search for "advottic" returns three unrelated apps. Consistent with `lib/app-links.ts`, which gates every iOS surface behind `NEXT_PUBLIC_IOS_APP_LIVE` and sets `APP_STORE_URL` to `null` until then. |
| iOS review history | Six App Store rejections across 2.1(a), 3.1.2(c), 2.3.10, 2.1(b)/4.2 and 3.1.1. Resolved by removing Apple in-app purchase entirely and adopting a reader model. `docs/IOS_APP_STORE.md`, `docs/APPLE_ROUND7_HANDOVER.md` |
| Current App Store status | `[OWNER INPUT NEEDED]`. Only the App Store Connect dashboard can say whether the resubmission is in review, approved or rejected again |

**Stage verdict: pre-launch to very early launch.** A four-month-old
codebase, a live web product, one of two mobile stores, and a marketing
surface that has never been indexed long enough to have a track record.
Every discoverability decision should be read through that lens: this
brand has no incumbency to defend and nothing to lose from being crawled.

`[OWNER INPUT NEEDED]` for all of: funding stage, revenue, paying
customers, active firms, signups, and whether any customer is live in
production. None of it is derivable from the repository, and none of it
has been estimated.

---

## 7. Geographies and languages

### Geography: United States only, and deliberately so

`lib/format.ts:44` pins `US_LOCALE = 'en-US'` as "the one locale this
product formats in". The rationale in the file (`:19-24`) is worth
quoting in full because it is a positioning statement, not a technical
note: "Advottic is a United States legal product: matters are filed in US
courts, on US dates, in US dollars… That is deliberately independent of
the UI language: the app translates its words (including a Spanish
surface), but a Spanish-speaking user in the United States still files on
a US calendar, so the numbers keep their US shape."

Pinned formats: dates `3/4/2026` and `Mar 4, 2026`; times 12-hour AM/PM;
money USD hardcoded, stored in cents; **distance in feet and miles**, not
metres and kilometres. Time zone is deliberately **not** pinned, because
a 9:00 AM hearing must read as 9:00 AM to the person attending it.

Enforced in CI by `scripts/test/us-format-invariants.mjs`, which fails
the build on any new locale-less `toLocale*` call. The rationale given:
"03/04/2026 is March 4th in the United States and April 3rd almost
everywhere else. On a filing deadline or a court exhibit that is a
correctness defect, not a preference."

`ProfessionalService` JSON-LD declares `areaServed: { Country: "United
States" }`. Support and sales contact points declare `areaServed: "US"`.

### Language: three separate mechanisms, only one of them indexable

| Mechanism | Where | Indexable? |
|---|---|---|
| **A. `/es` static Spanish pages** | 6 route files producing 14 URLs: hub, `que-es-advottic`, `guias` + 5 guides, `plantillas` + 5 templates | **Yes.** All 14 in the sitemap, all 200, all with correct bidirectional hreflang |
| **B. `AutoTranslate` runtime machine translation** | `components/i18n/AutoTranslate.tsx`, scoped to consumer routes only (`app/layout.tsx:210-219`) | **No.** Cookie-driven, no URL change. A crawler carries no cookie, so it only ever sees English |
| **C. Dictionary `<T>` / `useT()` under `LocaleProvider`** | 40 files, all under `app/counsel/**` | **No.** Behind auth |

**What `/es` actually is**: six hand-written Spanish content pages. It is
not a Spanish version of the product, and the page says so to users
(`app/es/page.tsx:48-53`: "la aplicación en sí funciona en inglés después
de iniciar sesión"). Marketing must not describe `/es` as a Spanish
version of the app.

**The defect**: `/es` is an **orphan**. Zero anchor links from any
English page point to it, verified live on `/` and `/guides` and across
all 54 swept routes. hreflang exists and is correct, but no internal link
equity flows to the Spanish tree and an English-speaking visitor has no
route to it. Ticketed as TECH-004.

---

## 8. Compliance constraints on what marketing may say

**This section is the hard boundary on the entire program. NOT FOR
EXTERNAL USE in any part.**

### The publication ban

`docs/compliance/README.md:5`, verbatim: these documents make Advottic
audit-ready, "they do not by themselves make it 'certified' or
'compliant.' … **Do not publish 'SOC 2 / ISO 27001 / HIPAA compliant'
claims until they are actually attested/executed.**"

### Framework status

| Framework | In scope | Status |
|---|---|---|
| SOC 2 | Yes | **Not started.** No CPA firm engaged (commit `5c675284`, 2026-08-10) |
| ISO 27001 | Yes | **Not started.** No registrar engaged |
| HIPAA | **Yes** | **Not HIPAA-ready to accept PHI in production** (`docs/compliance/hipaa/security-risk-assessment.md:39`) |
| GDPR / CCPA | Referenced, not scoped as a program | No status stated |
| PCI-DSS | Inherited from Stripe, not Advottic's | n/a |
| Penetration test | Yes | **Never performed.** `risk-register.md:19` R11 open |

### Why HIPAA is in scope

`COMPLIANCE_READINESS.md:42`: "health information can appear in
`cases.description`, `exhibits` (uploaded medical records), and
`ai_reviews`." `:98`: Advottic is a **Business Associate** and must
satisfy 45 CFR §164.308/310/312/314/316. The risk assessment instructs
treating all case content as potential PHI.

### Agreements: none executed

`docs/compliance/policies/vendor-and-subprocessor-management.md:17-33`.
**Every BAA cell and every DPA cell in the subprocessor register is an
unchecked box.** Zero executed, upstream or downstream. The policy's own
rule at `:33`: "No customer BAA may be counter-signed until every 'Yes'
row above has an executed BAA and HIPAA-eligible plan."

The highest-priority vendor gap is OpenAI (`:20`, `:35-63`): "Not
executed. No DPA, no BAA, no security report collected", while it
receives raw uploaded media files up to 25 MB and their original
filenames.

### Open control gaps that bound marketing claims

MFA exists as opt-in TOTP but **AAL2 enforcement is off by default**.
Disaster recovery is described in the policy as "the largest availability
gap", with no documented RPO/RTO and no restore drill ever performed.
There is **no data retention schedule**. **Individual view logging is not
implemented.** There is no upload malware scanning on exhibits. CSP is
still Report-Only. No Security Official has been named and the
information security policy is unsigned.

### The claims that are still published and must not be. NOT FOR EXTERNAL USE.

On 2026-08-10 two commits removed uncertified claims from `/security`,
`/pricing` and `TechTrustStrip`. **`app/enterprise/page.tsx` was not
touched by that sweep** (its last commit is 2026-07-13). Still live:

| Line | Claim | Why it cannot stand |
|---|---|---|
| `app/enterprise/page.tsx:1296` | "Full DPA + BAA on request" | Zero DPAs and zero BAAs executed. The identical claim was deleted from `/pricing` the same day |
| `app/enterprise/page.tsx:710` | "Zero-retention configured on Anthropic Claude" | Commit `5c675284` ruled this "not a claim we can make" and stripped it from `/security` |
| `app/enterprise/page.tsx:1286`, `:1087` | "Every read… is logged" | `/security:136` says view logging is not in place. The same wording was removed from `TechTrustStrip` in `6c02f624` |
| `app/enterprise/page.tsx:1270` | "TLS 1.3" and "private VPCs in the United States" | Everything else in the codebase says TLS 1.2+. No VPC claim appears anywhere in `docs/compliance/` |
| `app/enterprise/page.tsx:445` | "never expose privileged content to a vendor outside your DPA" | No DPA exists |
| `lib/glossary.ts:52`, `llms.txt`, `llms-full.txt` | BAA availability, custom data residency, "SOC 2 path in progress" | All three removed from the HTML pages, all three still live on the AI-citation surfaces |

Ticketed as TECH-012 (`/enterprise`) and covered by AI-9 in
`ai-search-eligibility.md`.

### The standing rule for remediation

**Delete, do not confess.** Removing a false line is correct. Replacing
it with a candid admission of the gap is not required and is usually
worse: it converts a silent gap into published marketing about the gap.
Never add an uncertified compliance claim. Never volunteer a limitation
that no existing claim requires correcting.

---

## 9. Brand voice

There is **no `CLAUDE.md` in this repository** (verified: `find . -name
CLAUDE.md` returns nothing, `.gitignore:12` ignores `.claude`). The copy
rules live in `docs/DESIGN_SYSTEM.md` §7 and in `docs/launch/`.

### Hard rules

| Rule | Source |
|---|---|
| **Calm, plainspoken, present-tense, never breathless** | `docs/DESIGN_SYSTEM.md:733` |
| **No em dashes anywhere user-facing.** Use a hyphen, comma, colon, or rephrase. "Em-dashes read as machine-generated" | `:742-743` |
| **No emoji in product copy.** The brand reads as calm-professional | `:795-797` |
| **One number per claim, no superlatives.** "'AES-256 at rest' not 'bank-grade security'" | `:739-740` |
| **Banned words: leverage, synergize, world-class, best-in-class** | `:744-745` |
| **Cost transparency.** "'$19/mo' not 'starting at $19'" | `:746-747` |
| **Headlines name the feeling first, the feature second** | `:736-738` |
| **Name the free alternative when the paid product is not right.** "If you face possible incarceration, request a public defender at your first court appearance" | `:748-751` |
| **Plural-aware copy.** "1 case" / "20 cases", never "1 case(s)" | `:741` |

### Writing for people in legal distress

`docs/launch/SEO_CONTENT_PLAN.md:3`: "plain, calm, reassuring. Every
brief and title below is written for someone in real legal stress: **no
alarmist language, no jokes, no 'scary.'** Reassure, orient, and give the
next concrete step."

`:11` names the governing constraint for the whole content programme:
"we are not a law firm and we do not give legal advice. Every page
carries a short, plain disclaimer ('This is general information, not
legal advice for your situation'). This is both an ethical requirement
and an E-E-A-T trust signal… for 'Your Money or Your Life' (YMYL) legal
content."

Handoff to the firm side must be "calm… never pushy, framed as one option
among several" (`:100`).

### The anti-overclaim rule for UI

`docs/PARITY-PAGE-RULES.md:37-49`. "A page only gets a pattern element it
has real data for." "**An invented number is worse than a plain
heading.**" "No badge without a state behind it." "A subtitle describes
what the page does, not what it might do one day." The file then lists
three real regressions this rule was written to stop.

This rule applies to marketing pages as much as product pages and is the
in-house articulation of the same standard this audit works to.

### Automated copy guards in CI

Run as `npm run test:audit-guards` (`package.json:22`), wired to
`.github/workflows/guards.yml`. Any new marketing copy must pass these.

| Guard | Enforces |
|---|---|
| `crisis-copy-invariants.mjs` | Crisis panels (911, National DV Hotline, 988, Crisis Text Line) must be legible in both light and dark themes; `sms:` links must be correctly formed or the message never prefills; **Safe Witness must not claim outcomes that did not happen**, banning four phrases and requires the phrases "We cannot confirm they have received it" and "The recording stays on this device" |
| `find-curly-titles.mjs` | Straight punctuation only in page titles, because titles travel into OG cards and email subjects where curly quotes survive inconsistently |
| `us-format-invariants.mjs` | No new locale-less `toLocale*` call |
| `i18n-a11y-invariants.mjs` | `data-no-translate` stays on streaming AI output and user data; `aria-live` stays on flagship consumer surfaces |
| `counsel-i18n-invariants.mjs` | Every dynamic `<T>` wrap is on an explicit allowlist, so client names and case titles are never shipped to a machine-translation engine |
| `bella-markdown.mjs` | Assistant output never renders literal asterisks or dead links "in front of a distressed reader" |
| `find-tight-br.mjs` | No `<br>` inside an `<h1>` without surrounding space, for screen readers |

### Required disclaimer

Live in the global footer (`app/layout.tsx:732-736`): "Advottic is a
service of Techno Optics LLC. Advottic Review and Bella generate
informational content automatically; outputs may be incomplete, outdated,
or wrong and are not legal advice. Always consult a licensed attorney in
your jurisdiction before acting. If you face possible incarceration, ask
the court for a public defender at your first court appearance."

### Product naming

**Bella** and **Advottic Review** are two different things, both current.
Bella is the conversational assistant; Advottic Review is AI issue
spotting on a case file. `/security:164` states both plainly. White-label
firms see "Document review" instead of "Advottic Review"
(`app/portal/layout.tsx:159`).

**However**: the Bella chat UI is currently unreachable in the product.
See `audit-current-state.md` finding C-3 and `open-questions.md` Q1. Do
not build positioning on Bella until that is resolved.

### Channel prohibitions

`docs/GO_TO_MARKET.md:240-258` deliberately excludes: free-trial
extensions and coupon spam ("burns the brand"), PR Newswire press
releases, TikTok and Instagram influencer marketing, and conferences in
the first 90 days.

---

## 10. `[OWNER INPUT NEEDED]`

Not derivable from this repository, the live site, or any public source.
Nothing below has been estimated.

| Item | Who or what can answer it |
|---|---|
| Budget for the GTM program | Owner |
| Team: who executes, how many hours per week, in-house or agency | Owner |
| Targets: signups, trials, paid conversions, firm seats, by when | Owner |
| CAC and LTV, current or target | Owner / Stripe |
| Traffic baseline: sessions, sources, top landing pages | Google Analytics or Vercel Analytics |
| Search baseline: impressions, clicks, average position, indexed page count | Google Search Console and Bing Webmaster Tools. **No evidence either property is verified** |
| Current signup and activation rates | Product analytics |
| Existing review counts on G2, Capterra, Trustpilot, Google Play | Those consoles. **Note: none are claimed anywhere on the site, and `aggregateRating` is correctly withheld from all JSON-LD. Do not introduce a rating until a real one exists** |
| Press coverage to date | Owner. The repo contains 2 self-published press posts and no third-party coverage |
| Email list size and platform | Owner |
| Whether any customer is live in production, and how many firms | Owner |
| Which city is the registered address, Minneapolis or Edina | Minnesota Secretary of State filing |
| Whether `twitter.com/advottic` and `linkedin.com/company/advottic` are owned | Owner. The Twitter/X URL published in `sameAs` returns **HTTP 404** |
| Current App Store review status | App Store Connect |
| Actual annual prices behind the "20% off" claim | Stripe dashboard |
| Whether `/api/indexnow` has ever been triggered manually | Vercel function logs |
| Competitor positioning, pricing and metrics | No competitor data was gathered. `docs/PRICING.md` contains a competitor table of unknown vintage; treat as unverified until re-sourced |
