# Advottic - Unit Economics

What a user actually costs us, and what each tier nets.

Honest mid-band estimates. Real numbers will move with usage
patterns, prompt-cache hit rate, and how heavily users lean on Bella
- a junior attorney drafting all day costs us 2-3x what an admin
who logs in twice a month does. The averages here assume a normal
mix.

All prices in USD. All costs are direct variable costs (COGS) - no
salaries, marketing, or overhead allocation. Margins below are
gross margins; operating margin is your call once you've sized the
team.

## Cost components

### 1. Hosting (Vercel)

Pro plan: $20 / mo base for the org. Then serverless function
invocations + edge function compute + bandwidth.

- Per active user serverless invocations: 2k - 8k / mo
- Compute cost: $0.30 - $2.50 / user / mo on average
- Bandwidth: typically inside the 100GB/mo Pro included pool
- Edge requests (middleware): negligible - $0.05 / user / mo

### 2. Database + storage (Supabase)

Pro plan: $25 / mo base.

- Database CPU + queries: $0.10 - $0.40 / user / mo (depends on
  case + chat + document volume)
- Storage at $0.021 / GB / mo:
  - Light user (Free, ~10 MB used): negligible
  - Personal Pro (100 MB - 1 GB): $0.002 - $0.021 / mo
  - Counsel attorney (5 GB documents): $0.10 / mo
  - Heavy firm partner (50 GB): $1.05 / mo
- Egress at $0.09 / GB beyond first 250GB: $0.05 - $0.50 / mo
- Auth + realtime + edge functions: included
- Connection pooling: included

### 3. Bella (Anthropic Sonnet 4.5)

THE biggest variable cost. Pricing:

- Input: $3 / MTok
- Output: $15 / MTok
- 90% discount on cached input (we use prompt caching aggressively
  on the system prompt + tool definitions; ~40-60% effective input
  reduction)

Realistic averages, accounting for tool calls, search results,
case-law citations, document drafts:

| User type | Turns / mo | Cost / mo |
|---|---|---|
| Free user (Bella sample) | ~5 | $0.05 |
| Personal Pro | ~30-60 | $1.50 - $3.50 |
| Personal Plus | ~80-150 | $3.50 - $6.00 |
| Solo attorney | ~100-300 | $5 - $15 |
| Small Firm avg user | ~150 | $8 - $20 |
| Growing Firm avg user | ~200 | $10 - $25 |

The variance is real. A 5-user firm where the partner does heavy
discovery review and document drafting drives $40+ / mo of API
spend on that one seat; the paralegals using Bella for case lookup
land at $2 / mo. Tier averages assume a normal partner-to-staff
mix.

### 4. Email (Resend)

Free: 3k / mo. Paid: $20 / mo for 50k.

- Per user emails sent: 5 - 50 / mo (notifications, signing
  request emails, password resets)
- Effective cost: $0.02 - $0.20 / user / mo

### 5. Stripe

2.9% + $0.30 per transaction. Only on paid subscriptions; the
total spread depends on billing cadence.

| Tier | Stripe cut / month |
|---|---|
| Personal Pro $19 | $0.85 |
| Personal Plus $39 | $1.43 |
| Solo $59 | $2.01 |
| Small Firm $99 | $3.18 |
| Growing Firm $149 | $4.62 |

Annual prepay reduces this proportionally - one $228 charge for
Personal Pro = $6.91 annually = $0.58 / mo amortized.

### 6. Other infrastructure

- Domain registrations (advottic.com + DNS): $20 / yr total - negligible
- GitHub: free
- CourtListener API: free with token
- Web push (VAPID): free
- pdf-lib / @anthropic-ai/sdk / @supabase/ssr: open source
- Sentry / observability: $26 / mo flat. Allocate $0.05 / user / mo.
- Vercel Analytics: included in Pro

### 7. Customer support (allocate by tier)

Not direct COGS, but real OpEx that scales with users. One CSM at
$80k / yr can effectively support 400 paid customers = $200 / user /
yr = $16.67 / user / mo. We don't allocate this against COGS in
the table below (most SaaS doesn't), but factor it into your
operating-margin calculation.

## Per-tier COGS table (mid-band)

All values in $ / user / month.

| Tier | Vercel | Supabase | Bella | Email | Stripe | Sentry | TOTAL COGS |
|---|---|---|---|---|---|---|---|
| Free | $0.30 | $0.10 | $0.05 | $0.02 | $0 | $0.05 | **$0.52** |
| Personal Pro $19 | $0.80 | $0.25 | $2.50 | $0.10 | $0.85 | $0.05 | **$4.55** |
| Personal Plus $39 | $1.20 | $0.35 | $4.50 | $0.15 | $1.43 | $0.05 | **$7.68** |
| Solo $59 | $1.50 | $0.40 | $10.00 | $0.20 | $2.01 | $0.05 | **$14.16** |
| Small Firm $99 | $2.00 | $0.50 | $14.00 | $0.30 | $3.18 | $0.05 | **$20.03** |
| Growing Firm $149 | $2.50 | $0.70 | $18.00 | $0.40 | $4.62 | $0.05 | **$26.27** |
| Enterprise ~$200 | $3.00 | $1.00 | $22.00 | $0.50 | $0* | $0.05 | **$26.55** |

\* Enterprise is invoiced via wire / ACH, no Stripe percentage. Add
$2 / user / mo for invoicing + AR overhead instead.

## Gross margin

| Tier | Price / mo | COGS / mo | Gross profit / mo | Gross margin |
|---|---|---|---|---|
| Free | $0 | $0.52 | -$0.52 | (acquisition spend) |
| Personal Pro | $19 | $4.55 | **$14.45** | **76.1%** |
| Personal Plus | $39 | $7.68 | **$31.32** | **80.3%** |
| Solo | $59 | $14.16 | **$44.84** | **76.0%** |
| Small Firm | $99 | $20.03 | **$78.97** | **79.8%** |
| Growing Firm | $149 | $26.27 | **$122.73** | **82.4%** |
| Enterprise | $200+ | $26.55 | **$173.45+** | **86.7%+** |

Healthy SaaS gross margin lands 70-80%. We sit comfortably in that
band on every paid tier.

## Annual run-rate per user

| Tier | ARR / user | COGS / yr | Gross profit / yr |
|---|---|---|---|
| Personal Pro | $228 | $54.60 | $173.40 |
| Personal Plus | $468 | $92.16 | $375.84 |
| Solo | $708 | $169.92 | $538.08 |
| Small Firm | $1,188 | $240.36 | $947.64 |
| Growing Firm | $1,788 | $315.24 | $1,472.76 |
| Enterprise | $2,400+ | $318.60 | $2,081.40+ |

## Firm-level economics (the leverage tier)

A typical Small Firm customer is **5-15 users**. The math:

| Firm size | ARR | Annual COGS | Annual gross profit |
|---|---|---|---|
| 5 users | $5,940 | $1,201.80 | $4,738.20 |
| 10 users | $11,880 | $2,403.60 | $9,476.40 |
| 25 users | $29,700 | $6,009.00 | $23,691.00 |

A single 25-user firm clears nearly **$24k / yr gross profit**.
That covers a quarter of one engineer; we need ~5 such firms per
engineer to be sustainable on dev costs alone.

## Free tier economics

Free users cost **~$0.52 / mo, $6.24 / yr**.

For free → paid conversion math:

- 10% conversion within 12 months
  Blended cost: 10 free * $6.24 + 1 Personal Pro = $62.40 + $54.60 = $117 cost
  Blended revenue: 1 Personal Pro * 14 month avg lifetime * $19 = $266 revenue
  Net contribution: $149 over 14 months = positive

- 5% conversion (worst case)
  Blended cost: 20 free * $6.24 + 1 Personal Pro = $179.40
  Blended revenue: $266
  Net: $87 - still positive

The free tier pays for itself as long as conversion stays above
**~3.5%**. Industry benchmark for freemium SaaS is 2-5%, so the
range is workable but conversion is the metric to watch obsessively.

## LTV / CAC

Lifetime value at 76-86% gross margin:

| Tier | Avg lifetime | Gross LTV |
|---|---|---|
| Personal Pro | 14 months | $202 |
| Personal Plus | 18 months | $564 |
| Solo (firm) | 36 months | $1,614 |
| Small Firm (firm) | 42 months | $3,983 / user |
| Growing Firm (firm) | 48 months | $5,891 / user |

Acceptable CAC at 3:1 LTV / CAC ratio:

| Tier | Max CAC |
|---|---|
| Personal Pro | $67 |
| Personal Plus | $188 |
| Solo | $538 |
| Small Firm (per user) | $1,328 |
| Small Firm (5-user firm avg) | $6,640 |
| Growing Firm (per user) | $1,964 |

The Small Firm tier is the obvious investment lever: a $5k blended
acquisition cost (sales rep + 2 demos + 60-day pilot + onboarding)
is comfortable when each acquired firm averages 8 users * $42k LTV.

## Marketplace + add-on revenue (pure margin)

These ride on top of subscription and have near-zero variable cost:

- Inbound lead fee: $50 - $99 per accepted lead × ~5% lead-to-firm
  conversion at 200 leads / mo = ~$5,000 / mo recurring after we
  reach steady-state lead flow
- Co-counsel referral 2% platform fee: variable; high-margin
  passthrough on Stripe Connect
- E-sign overage at $1-$2 / request: hits our $0.02 in Vercel
  function cost; ~99% margin
- Contract review overage at $9.99: hits our ~$1.20 in Bella API
  cost; ~88% margin
- Discovery overage at $0.05 / doc: hits our ~$0.005 in Bella API
  cost; ~90% margin

Conservative add-on revenue runs **$15-$30 / paid user / month** on
top of subscription, at 85-95% margin.

## Sensitivity to Bella usage

The single biggest cost lever is Anthropic API spend. If a Small
Firm tier user goes from average (~150 turns / mo) to heavy (300
turns / mo), Bella cost roughly doubles to $28 / mo, dropping the
gross margin from 79.8% to ~67%. Still profitable, but closer to
the floor.

Mitigations we already have:

1. Prompt caching on system + tool definitions (~50% input
   reduction)
2. Tool-only responses skip the chat-completion step entirely
3. Document drafting reuses the template skeleton (Bella doesn't
   regenerate boilerplate)

Mitigations to ship if Bella spend creeps over 25% of revenue:

1. Tier-cap Bella turns / mo (Personal Pro = 200, Personal Plus =
   500, Counsel = unlimited - which is already the case)
2. Move long-context discovery review to Haiku 4.5 ($1 / MTok input,
   $5 / MTok output - 3x cheaper)
3. Cap individual response length on consumer tiers (no 4000-token
   answers for $19 / mo)

## Bottom line

| Tier | Monthly profit / user | Annual profit / user |
|---|---|---|
| Personal Pro | **$14.45** | **$173.40** |
| Personal Plus | **$31.32** | **$375.84** |
| Solo | **$44.84** | **$538.08** |
| Small Firm | **$78.97** | **$947.64** |
| Growing Firm | **$122.73** | **$1,472.76** |
| Enterprise (~$200) | **$173.45+** | **$2,081.40+** |

100 Personal Pro + 50 Small-Firm seats (across ~10 firms) =
**$84,895 monthly gross profit, $1.02M annual gross profit**.

That's the ARR you can support a 4-engineer team + 1 founder + 1
CSM on. Revenue scales with the marketplace + add-ons; the dollar
multiplier on a 25-user Small Firm customer is roughly 5x what one
Personal Pro user adds.

---

## How to use this doc

1. **When pricing changes**: update PRICING.md, then propagate the
   new prices into the table here, then recompute gross margin.
2. **When Anthropic / Vercel / Supabase prices move**: update the
   cost-component sections, recompute COGS, update tier table.
3. **When investors ask "what's your gross margin"**: give them
   the per-tier numbers. The blended figure depends on customer
   mix, which we'll know in 12-18 months.
4. **When sales asks "what's a good discount on Small Firm"**: any
   discount that keeps the gross margin above 65% (so down to
   ~$71 / user / mo, a 28% discount) is fine for new customers.
   Bigger discounts only for genuine multi-year prepay or
   strategic anchor accounts.
