# Advottic - Pricing Strategy

Competitive analysis + recommended tiers. Living document; update
when a competitor moves prices or when we ship features that change
the value calculus.

## Where competitors price (May 2026)

### Practice management (firm side)

| Product | Tier | Per-user / mo |
|---|---|---|
| Clio Manage | Essentials / Advanced / Complete | $69 / $99 / $129 |
| Clio Grow (intake) | flat | $49-$99 |
| MyCase | Basic / Pro / Advanced | $49 / $69 / $89 |
| PracticePanther | Solo / Essential / Business | $49 / $69 / $89 |
| Smokeball | Boost / Grow / Prosper+ | $49 / $99 / $199 |
| Filevine | Core | $89+ |
| Rocket Matter | Essentials / Pro / Premier | $39 / $69 / $89 |
| Zola Suite | Core / Essentials / Advanced | $69 / $99 / $149 |
| CaseFleet | Solo / Pro / Enterprise | $40 / $80 / custom |
| Litify (Salesforce) | Enterprise | $$$$ (custom) |

Average sweet spot for the small-firm tier: **$69-$99/user/mo**. Most
charge a la carte for e-signature, document automation, and AI.

### Legal AI (the new wave)

| Product | Per-seat / mo |
|---|---|
| Spellbook (contract AI) | $108 |
| Casetext CoCounsel | $250 |
| Harvey AI | enterprise (rumored $200-$500/seat) |
| Lawmatics | $200 |
| LegalSifter | $30+ |

These prices are PURE AI overlay; they don't include practice
management. A firm running Clio Manage Advanced + Spellbook is
already at **$207/user/mo** for two products that don't share data.

### E-signature standalone

| Product | Tier | / mo |
|---|---|---|
| DocuSign | Personal / Standard / Business Pro | $10 / $25 / $45 |
| Adobe Sign | Std / Pro | $14.99 / $23.99 |
| PandaDoc | Essentials / Business / Enterprise | $19 / $49 / custom |
| Dropbox Sign | Essentials / Standard | $20 / $30 |

### Consumer

| Product | Model | Price |
|---|---|---|
| LegalZoom | Subscription | $79 / mo |
| Rocket Lawyer | Subscription | $39.99 / mo |
| DoNotPay | Subscription | $36 / yr |
| Trust & Will | One-time + maint | $159 + $39/yr |
| Hello Divorce | Flat by stage | $99-$2,999 |

## Advottic's pitch (why we can charge premium-mid)

We're the only platform that combines, in one tenant, on one data
model:

- Practice management (Clio-equivalent at the schema layer)
- Real-time team chat
- E-signature with UETA-aligned audit chain
- AI assistant (Bella) with: case research via CourtListener,
  document drafting (13 templates), tool-using agent that operates
  the practice
- Time tracking with auto-capture from Bella sessions
- Invoicing with Stripe payment links
- IOLTA trust accounting with 3-way reconciliation
- Conflict checking + matter intake
- Statute-of-limitations engine with cron alerts
- Court-form auto-fill (CA, NY, TX, FL, Federal so far)
- Discovery document review with privilege detection
- Two-sided marketplace (consumer leads to firms)
- Co-counsel referral with fee-split tracking
- Multi-tenant subdomains for white-label firms
- Public API
- Browser extension
- Web push + email + in-app notifications

A firm replacing Clio + DocuSign + Spellbook + Lawmatics with
Advottic is consolidating roughly **$300/user/mo of competitor
spend**. We can comfortably price at $99-$149 for the small-firm
sweet spot and still be the cheaper option AND the better product.

## Recommended tiers

### Consumer side (advottic.com)

**Free**
- Bella for general legal questions (limited turns/day)
- 1 case file (read + edit, no archival)
- Receive signing requests as a signer
- Inbox notifications
- View public marketplace (cannot submit lead)
- Pricing rationale: lead-gen surface; converts to Personal Pro
  the moment a real matter shows up

**Personal Pro - $19/mo or $190/yr**
*16% annual discount, 14-day free trial*
- Unlimited Bella turns
- Unlimited cases
- Bella drafts documents from 13 templates (and more we ship)
- E-sign as recipient (free, always)
- 5 contract reviews per month with Bella confidence rating
- Receipt vault: 10 GB
- Documents inbox: receive + send back signed PDFs
- Priority lawyer matching on /find-counsel
- Email + push notifications
- Pricing rationale: undercuts Rocket Lawyer ($39.99) by half;
  the AI-drafted-document-plus-review combo is what tips a person
  from "I'll Google" to "I'll just pay $19"

**Personal Plus / Family - $39/mo or $390/yr**
- Everything in Pro
- Family share: up to 4 members under one account
- Unlimited contract reviews
- 50 GB receipt vault
- $1,000 / year credit toward Advottic Counsel firms (kicks in if
  the matter escalates from self-help to needing a lawyer)
- Priority response from matched firms (24h vs 48h)
- Pricing rationale: family + escalation credit are the
  differentiators; competes with Rocket Lawyer Pro at $89.99
  while bundling actual lawyer-money credit

### Counsel side (per user / mo, billed annually with -20%)

**Solo - $59/user/mo (or $47 annual)**
- Up to 1 attorney + 1 staff seat
- 1 firm, 100 cases active
- All practice-management features (time tracking, invoicing,
  IOLTA, intake, conflict check, court forms, marketplace)
- Bella with full firm tools
- 25 GB document storage
- 10 e-sign requests / mo (additional at $2 each)
- Email + chat support
- Pricing rationale: undercuts Clio Essentials ($69) by $10 to
  pull in price-sensitive solos; the bundled AI is the moat

**Small Firm - $99/user/mo (or $79 annual)** ★ MOST POPULAR
- Up to 25 users (mix of attorneys + paralegals + staff)
- Unlimited cases + matters
- All Solo features +
  - IOLTA trust accounting (multi-account)
  - Co-counsel referral network with auto fee-split tracking
  - Marketplace lead boost (3x more matched leads)
  - Custom firm subdomain (`yourfirm.advottic.com`)
  - 250 GB document storage
  - 100 e-sign requests / mo bundled
  - Discovery document review (250 docs/mo)
  - Court-form auto-fill (unlimited)
- Priority email support
- Pricing rationale: matches Clio Manage Advanced ($99) but
  bundles Spellbook-equivalent AI ($108 alone) + DocuSign
  Business Pro ($45 alone). Effective spread vs. status quo:
  ~$150/user/mo

**Growing Firm - $149/user/mo (or $119 annual)**
- 26 to 100 users
- Everything in Small Firm +
  - Advanced analytics (matter profitability, attorney ROI,
    practice-area heat map)
  - Dedicated customer success manager
  - 1 TB document storage
  - 500 e-sign requests / mo bundled
  - Discovery review (1,000 docs/mo)
  - Custom Bella training on firm-specific drafting style
  - SAML SSO (when available)
  - Quarterly business review
- Pricing rationale: matches Smokeball Prosper+ ($199) and Zola
  Advanced ($149); the AI customization is the why-pay-more

**Enterprise - custom**
- 100+ users
- Everything in Growing Firm +
  - SSO with SAML / OIDC + SCIM provisioning
  - Custom data-residency (US-only, EU-only, on-prem)
  - HIPAA BAA available
  - 99.9% SLA
  - Dedicated infrastructure
  - White-label tenant subdomain with custom domain mapping
  - On-prem deployment option
  - Sandbox + staging environments
- Pricing rationale: pure room for sales conversation; floor at
  $200/user/mo with annual prepay

### Marketplace fees (firm side, additive)

- Inbound lead from /find-counsel: free for first match per matter,
  $50 per accepted lead thereafter (small firm), $99 per accepted
  lead (growing firm). Enterprise: included.
- Co-counsel referral fee split: 2% platform fee on the receiving
  firm's payout (industry standard for legal-tech marketplaces;
  Stripe Connect handles the destination charge).

### Add-on consumption

- E-sign requests beyond bundle: $2 / request (Solo / Pro tier),
  $1 / request (Small Firm and up)
- Contract review beyond bundle (consumer Personal Pro): $9.99 /
  contract
- Discovery document AI scan beyond bundle: $0.05 / document
- Receipt vault storage beyond bundle: $0.10 / GB / mo

### Discounts + retention levers

- 14-day free trial on every paid tier (no credit card on Free)
- Annual prepay: 20% off all paid tiers
- Pause subscription option: keep data + access to Free tier for
  90 days, resume on the same plan (cancel-killer)
- Bar-association discount: -15% for verified members of a state
  bar (we ask for the bar number; verifier on the back end)
- Education discount: -50% for verified law students
- Legal-aid + nonprofit: -75% (cap at 5 seats)
- Multi-firm discount: -10% per additional firm (M&A scenarios)

## Why the math works for us

A 25-attorney firm on Small Firm at $99/user/mo annual = $99 * 25 *
12 * 0.8 = **$23,760 / yr ARR**. With:

- ~$1.20 / user / mo Vercel + Supabase storage cost ($30 / firm / mo)
- ~$3 / user / mo Anthropic API cost for Bella (heavy users; lighter
  ones average less)
- ~$0.50 / user / mo Resend, Stripe, etc.
- ~~~$5 / user / mo all-in COGS

That's **$1,500 / firm / yr COGS vs $23,760 ARR** = ~94% gross
margin. Even after support headcount, partner program, and
infrastructure overhead, contribution margin lands at the 70-80%
range that matters for SaaS valuation.

For consumer Personal Pro at $19/mo: $228/yr ARR, COGS ~$3-5/mo
heavy use, ~85% gross margin.

## Next steps

1. Wire Stripe Products + Prices for each tier
2. Update /pricing page (this commit)
3. Update /billing page to support tier upgrade / downgrade
4. Add usage gates to: contract review (Personal Pro), discovery
   review (Small Firm+), court-form fill (Small Firm+),
   marketplace lead boost (Small Firm+)
5. Build the bar-association verifier (state-by-state public
   directories; mostly free APIs)
