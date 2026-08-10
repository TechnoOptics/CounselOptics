# Open questions

> **INTERNAL DOCUMENT. NOT FOR PUBLICATION OR DISTRIBUTION.**
> For the Advottic owner and team only. Several questions reference
> security gaps, unexecuted agreements or unmet compliance controls and
> are marked **NOT FOR EXTERNAL USE**. Do not paste any part of this file
> into a customer-facing document.

Raised by the 2026-08-10 GTM audit on branch `docs/gtm-audit`.

Everything below is something the audit **could not verify**, not
something it chose not to. Each entry names the exact tool, dashboard or
person that would settle it. **Nothing here has been estimated, inferred
or filled in with a plausible-sounding number.** Where a figure was
needed and unavailable, the field is blank.

Three other agents take the later workstreams. **Q1 through Q4 block
positioning work and should be answered before any of them starts.**

---

## Blocking: answer before positioning work begins

### Q1. Is Bella a live feature, or is it retired? OWNER DECISION.

**Why it blocks everything.** `components/Bella.tsx` has zero importers.
`app/layout.tsx:583` records that the widget was "removed per product
decision". `components/BellaPrompt.tsx` is still mounted on two paid
consumer surfaces and dispatches an event nothing listens for, so the
button does nothing.

Meanwhile Bella is the most heavily marketed thing on the site: a home
page showcase, two home page FAQ entries, a dedicated `/glossary/bella`
page, the Spanish hub's lead, the Plus tier described in code as "Bella
unlocks here" (`lib/personal-tiers.ts:91`), and an explicit instruction
in `llms-full.txt` telling assistants that Advottic's answer to "what is
the best AI legal assistant" is Bella.

**The consumer product's entire positioning currently rests on a feature
that is not reachable in the product.** Every downstream workstream
(messaging, content, AI answerability) would be building on it.

**Who settles it**: the owner. There is no file that can.

**Three possible answers and what each implies**

| Answer | Implication |
|---|---|
| Bella is coming back | Remount the widget, close TECH-010, keep the marketing. Give a date, because the paid entitlement description depends on it. |
| Bella is retired and replaced by something | Name the replacement. Every Bella reference across `app/page.tsx`, `lib/glossary.ts`, both llms files, `lib/personal-tiers.ts` and the Spanish hub has to change together. |
| Bella is retired with nothing in its place | The Plus tier's stated value proposition ("Bella unlocks here") no longer exists and the tier needs redefining before it is marketed. |

---

### Q2. Which of the three products is the priority for the next two quarters? OWNER DECISION.

The audit established that there are three products with three different
buyers (`context-block.md` section 3). It cannot establish which one the
programme should serve.

The evidence is contradictory. Content investment is overwhelmingly
consumer (92 public content pages) while revenue per customer is
overwhelmingly firm ($59 to $149 per seat, plus Enterprise from $1,800).
The employee portal has zero content and the clearest enterprise buyer of
the three.

**A single positioning statement across all three would be wrong.** So
would three equally-resourced programmes.

**Who settles it**: the owner. Informed by revenue data the audit does
not have (Q5).

---

### Q3. Which city is the registered address, Minneapolis or Edina?

Organization JSON-LD publishes Minneapolis. `llms-full.txt` publishes
Edina. Both are live simultaneously.

**Who settles it**: the Minnesota Secretary of State business filing for
Techno Optics LLC. Ticket TECH-011.

---

### Q4. Are `twitter.com/advottic` and `linkedin.com/company/advottic` owned by the company?

`https://twitter.com/advottic` returns **HTTP 404**, yet it is published
in the Organization `sameAs` array and as `twitter:site` and
`twitter:creator` in `app/layout.tsx`.

`linkedin.com/company/advottic` returned HTTP 999, which is LinkedIn's
standard anti-bot response and tells us nothing either way.

**Who settles it**: the owner, by opening both in a browser while signed
out. If the X handle is unregistered, it is both a broken entity-graph
edge and an open brand-squatting opportunity.

---

## Measurement: no analytics access exists in this session

**This is stated plainly rather than worked around.** No Google
Analytics, no Google Search Console, no Bing Webmaster Tools, no Ahrefs,
no Semrush, no Vercel Analytics and no App Store Connect access was
available. Consequently this audit produced **no traffic figures, no
rankings, no search volumes, no impression or click data, and no
competitor metrics.**

### Q5. What is the current traffic and revenue baseline?

Needed before any target can be set. All blank.

| Unknown | Tool that answers it |
|---|---|
| Sessions, sources, top landing pages | Google Analytics or Vercel Analytics |
| Signups, trial starts, trial-to-paid conversion | Product analytics or the Supabase dashboard. **Do not query the production database to obtain this**; use the analytics layer |
| Paying customers, MRR, ARPU, churn | Stripe dashboard |
| Number of firms live, number of seats sold | Stripe plus the admin console at `hq.advottic.com` |
| CAC and LTV | Owner, from spend plus Stripe |

### Q6. Is the site verified in Google Search Console and Bing Webmaster Tools?

**No evidence of either was found in the repository.** No verification
meta tag, no `google-site-verification` file, no BingSiteAuth.xml.

This matters more than it looks. Without Search Console there is no way
to know how many of the 151 URLs are actually indexed, whether the
sitemap has been submitted, whether the `lastmod` problem (TECH-014) has
already caused Google to discount the freshness signal, or whether any
manual action exists. Without Bing Webmaster Tools there is no way to
confirm TECH-007 works after the cron is wired.

**Action, not just a question**: verify both properties. It is a
prerequisite for measuring anything this programme does.

| Unknown | Tool |
|---|---|
| Indexed page count vs the 151 submitted | Search Console, Pages report |
| Whether `sitemap.xml` has ever been submitted | Search Console, Sitemaps report |
| Whether `lastmod` is being ignored | Search Console, crawl stats |
| Existing impressions, clicks, average position | Search Console, Performance report |
| Any manual action or security issue | Search Console |
| Whether IndexNow submissions land | Bing Webmaster Tools |

### Q7. Has `/api/indexnow` ever been triggered manually?

The route is complete, the key file is live, and no cron calls it. If
someone has been curling it by hand, some URLs have been submitted.

**Tool**: Vercel function logs, filtered to `/api/indexnow`.

---

## Product and commercial facts the repository cannot settle

### Q8. What are the actual annual prices?

`app/pricing/page.tsx:348` and `:414` publish "20% off with annual
prepay". `_ANNUAL` Stripe price ids exist in `lib/entitlements.ts:70-76`.
**No annual dollar amount exists anywhere in the codebase.** The only
implemented 20% is in `lib/gift.ts:105-108` for gift purchases.

Nothing may publish an annual price until this is confirmed.

**Tool**: the Stripe dashboard, product catalogue.

### Q9. How many document templates are there really?

"13+ templates" is published in `llms-full.txt`, `lib/glossary.ts` and
`app/pricing/page.tsx:148`. `lib/legal-templates.ts` contains 9.
`lib/templates.ts` contains 5. No 13-item array was found.

Either the number is wrong or it counts something the audit did not find.
**Do not reuse "13+" in any new copy until this is settled.**

**Tool**: the owner, or whoever wrote the claim.

### Q10. What is the current App Store review status?

The iOS app is verifiably not live: the iTunes Lookup API for id
`6769638076` returns `resultCount: 0` and a store search for "advottic"
returns three unrelated apps. `lib/app-links.ts` gates every iOS surface
behind `NEXT_PUBLIC_IOS_APP_LIVE`, which is off.

Whether a submission is in review, approved, or rejected again cannot be
determined from outside.

**Tool**: App Store Connect.

### Q11. Are there any secondary domains, ccTLDs or vanity redirects?

The repository knows about `advottic.com`, `www`, `hq.`, `enterprise.`
and per-firm tenant subdomains. Anything registered but not wired into
the codebase is invisible to this audit.

**Tool**: the domain registrar account.

### Q12. Is there a Google Business Profile, and do the directory listings agree?

`docs/DIRECTORY_LISTINGS.md` exists in the repository but the audit did
not confirm any listing is live or that the details match the JSON-LD.
Given the Minneapolis/Edina conflict in Q3, they may not.

**Tool**: Google Business Profile, plus a manual check of each listing in
`docs/DIRECTORY_LISTINGS.md`.

### Q13. Existing reviews, ratings and press.

None are claimed anywhere on the site, and `aggregateRating` is correctly
withheld from all JSON-LD (`components/seo/JsonLd.tsx:250-262`,
`:433-445`). That is the right posture and should not change until a real
rating exists.

Unknown: whether any G2, Capterra, Trustpilot or Google Play reviews
exist, and whether any third-party press coverage exists. The repository
contains two self-published press posts and no third-party coverage.

**Tool**: those consoles, and the owner.

**Constraint**: no rating may be added to structured data until a real,
sourced one exists. An invented rating would be the single most damaging
thing this programme could publish.

---

## Compliance questions that bound what may be said. NOT FOR EXTERNAL USE.

### Q14. Is any customer processing PHI in production today?

`docs/compliance/hipaa/security-risk-assessment.md:39` states Advottic is
"not yet HIPAA-ready to accept PHI in production" and that "PHI intake
should be limited/avoided or gated to non-production pilots under written
agreement."

`COMPLIANCE_READINESS.md:42` states PHI can appear in
`cases.description`, `exhibits` and `ai_reviews`, and the risk assessment
instructs treating all case content as potential PHI.

**If any real customer is using the product for a personal-injury,
disability, medical-malpractice or employment-health matter, PHI is
already in production against the company's own stated position.** The
audit could not and did not check, because querying the production
database was out of scope.

**Who settles it**: the owner. This is a compliance question, not a
marketing one, but it hard-bounds what the firm-side programme may say
about healthcare-adjacent practice areas.

### Q15. Has any customer BAA been counter-signed?

`docs/compliance/policies/vendor-and-subprocessor-management.md:33`:
"No customer BAA may be counter-signed until every 'Yes' row above has an
executed BAA and HIPAA-eligible plan." **Every BAA and DPA cell in that
register is an unchecked box.**

Yet `app/enterprise/page.tsx:1296` publishes "Full DPA + BAA on request"
and has done since at least 2026-07-13.

**Who settles it**: the owner. If any customer has been given a
counter-signed BAA on the strength of that page, this stops being a
marketing correction and becomes a legal matter. Ticket TECH-012 removes
the claim either way.

### Q16. Who is the named Security Official?

`docs/compliance/hipaa/security-risk-assessment.md:3` reads "Owner:
Security Official (to be named)" and the sign-off lines at `:44-45` are
blank. `information-security-policy.md:3` is unsigned.

Nothing may be published about the security programme's governance until
someone is named. **Who settles it**: the owner.

---

## Questions for the workstreams that follow this one

Recorded so the next three agents do not each rediscover them.

### Q17. Should the firm product get its own content programme, or share the consumer one?

The firm product has 61 routes and 11 public content pages. The consumer
product has 92. The two have nothing in common commercially: one is a
$29 self-serve purchase by a person in distress, the other is a $149
per-seat considered purchase by a practice manager. Bearing on Q2.

### Q18. Should the employee portal be marketed at all, or stay a firm-tier upgrade lever?

It has zero public presence today. Two defensible strategies:
market it as its own product with its own demand-side queries, or keep it
purely as a Small Firm upgrade argument inside `/enterprise` and
`/pricing`. The first is a larger content investment with a larger
ceiling. **Owner decision, informed by Q2.**

### Q19. What is the competitive set, and is `docs/PRICING.md`'s competitor table still accurate?

`docs/PRICING.md` contains a competitor table of unknown vintage, and its
own tier definitions are provably stale (they describe a three-tier
consumer ladder that no longer ships). The 9 `/compare/*` pages name
Clio, Spellbook, MyCase, Smokeball, DocuSign, Harvey, CoCounsel,
LegalZoom and Rocket Lawyer, with "Updated May 2026" and "Updated June
2026" stamps.

**No competitor data was gathered by this audit and none was estimated.**
Every competitor price and feature claim on those 9 live pages should be
re-verified against the competitor's own current pricing page before the
comparison programme is extended, because a stale competitor price on a
page headed "Honest side-by-side" is the same class of error as C-2.

**Tool**: each competitor's public pricing page, plus an owner decision
on the intended competitive set.

### Q20. Does the `no-store` caching fix risk leaking personalized content?

TECH-006 proposes making `/`, `/pricing` and `/enterprise` CDN-cacheable.
The root layout currently reads `headers()` to render the user menu,
notification count and token balance. **Any caching change must be
verified not to serve one user's personalized chrome to another
visitor.** This is the reason TECH-006 is ranked below the XS items
despite a clear benefit. Flagged for whoever picks it up.
