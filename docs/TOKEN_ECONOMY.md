# Advottic - Bella Token Economy

How we meter Bella usage, why every tier should be on it, and how
top-ups grow margin instead of eroding it.

The plumbing already exists. lib/storage.ts ships
`consumeTokensForCurrentUser()`, `getTokenBalance()`,
`grantProMonthlyTokens()`, the `token_ledger` table, and the
`profiles.token_balance` column. Bella already calls
`consumeTokensForCurrentUser` after every turn. The problem is the
gate: today only the Pro tier is metered; Free / Basic / Standard
are unmetered, and the new Solo / Small Firm / Growing Firm /
Enterprise tiers I designed in PRICING.md aren't wired in. This
doc fixes both.

## Token = Anthropic-equivalent cost unit

We treat **1 user-facing token = 1 Anthropic input/output token**.
That keeps the math debuggable: if a turn used 5,000 input + 1,000
output tokens, we debit 6,000 from the user. We add a small markup
on output tokens (which cost us 5x more than fresh input) so heavy
output workloads bill proportionally to our cost.

### Cost per Anthropic token (Sonnet 4.5)

| Token type | Anthropic price | Our reference cost |
|---|---|---|
| Fresh input | $3.00 / MTok | $0.000003 / token |
| Cached input (90% off) | $0.30 / MTok | $0.0000003 / token |
| Output | $15.00 / MTok | $0.000015 / token |

We weight metered usage:
- Cached input: 0.5× (rounded up so we cover overhead)
- Fresh input: 1.0×
- Output: 5.0× (matches Anthropic's pricing ratio)

So a turn with 3,000 cached + 2,000 fresh + 1,000 output tokens
debits: 1,500 + 2,000 + 5,000 = **8,500 user tokens**, costing us
~$0.018 ($0.001 cached + $0.006 fresh + $0.015 output).

### Token unit pricing for the user

We position **1,000 user tokens = our $0.001 cost reference**.
Bigger packs = better effective price for the user, but every pack
sits comfortably above our blended COGS so we earn margin.

| What it buys | User-facing | Tokens | Our COGS | Margin |
|---|---|---|---|---|
| ~5 light turns | $4.99 (Boost) | 200,000 | $1.80 | **64%** |
| ~25 turns | $19.99 (Boost+) | 1,000,000 | $9.50 | **52%** |
| ~75 turns | $49.99 (Power) | 3,000,000 | $28.50 | **43%** |
| ~175 turns | $99.99 (Mega) | 7,000,000 | $66.50 | **33%** |

Bigger packs trade margin % for total absolute profit dollars; a
$99.99 Mega pack still earns $33.49 of profit per unit, vs $3.19
on a Boost. Volume buyers create more total margin while feeling
they're getting a deal.

## Per-tier monthly grants

Every paid tier gets a Bella token grant baked into the
subscription. The grant covers expected normal usage so the user
isn't constantly hitting top-up paywalls. Heavy users naturally
buy top-ups - that's where the margin growth lives.

| Tier | Monthly grant | Our COGS | Roughly covers |
|---|---|---|---|
| Free | 25,000 | $0.10 | 5-8 light Bella turns / mo |
| Personal Pro $19 | 500,000 | $4.50 | 100-150 normal turns |
| Personal Plus $39 | 1,500,000 | $13.50 | 350-500 turns |
| Solo $59 | 2,500,000 | $22.50 | 600-900 turns / seat |
| Small Firm $99 | 4,000,000 / user | $36 / user | 1,000-1,500 turns / seat (pooled) |
| Growing Firm $149 | 8,000,000 / user | $72 / user | 2,000-3,000 turns / seat (pooled) |
| Enterprise $200+ | 15,000,000+ / user | $135+ / user | Unlimited in practice (pooled) |

A few notes on these numbers:

- Small / Growing / Enterprise grants are **pooled across the firm**.
  A 5-seat Small Firm has 20M total tokens / mo. If the partner uses
  10M and the four paralegals use 1M each, total is 14M - the firm
  has 6M reserve for spikes. This eliminates the awkward case
  where one user hits the cap while colleagues have unused tokens.

- Roll-over: Personal Pro and up roll over unused tokens, capped at
  2× the monthly grant. Free tier resets to 25,000 every period (no
  roll-over - prevents Free users from stockpiling).

- Auto top-up (off by default; opt-in): when balance drops below
  10% of monthly grant, charge $4.99 for 200,000 tokens (Boost
  pack). User retains control via a toggle.

## Why this grows margin

Pure subscription margin (from PRICING.md + UNIT_ECONOMICS.md):

| Tier | Subscription gross margin |
|---|---|
| Personal Pro | 76.1% |
| Personal Plus | 80.3% |
| Solo | 76.0% |
| Small Firm | 79.8% |
| Growing Firm | 82.4% |
| Enterprise | 86.7%+ |

Top-up margin (per pack):

| Pack | Margin |
|---|---|
| Boost $4.99 | 64% |
| Boost+ $19.99 | 52% |
| Power $49.99 | 43% |
| Mega $99.99 | 33% |

The catch: top-up margins are still high in absolute dollars but
lower as a percentage than the subscription, because we engineered
the grant to cover normal use. Users buying top-ups are by
definition heavy users; we *want* them to use more (it's
stickiness), so we pass some of the margin back as a volume
discount on bigger packs.

### Blended margin scenario

A Personal Pro user who never tops up: $19 - $4.55 COGS = **$14.45
profit (76%)**.

A Personal Pro user who tops up Boost+ once a month: $19 + $19.99
- ($4.55 + $9.50) = **$24.94 profit on $38.99 (64%)**. Lower
margin %, but **+72% absolute profit** vs the non-top-up user.

A Small Firm 25-seat customer where 5 users top up Power monthly:
$99 × 25 + $49.99 × 5 - ($21.48 × 25 + $28.50 × 5) = $2,724.95 -
$679.50 = **$2,045.45 / mo (75% blended)**. The plain
subscription would have been $1,938.30. Top-ups added **$107.15 of
pure additional profit per month** while consuming $142.50 more in
API spend.

The model rewards heavy users, doesn't penalize light ones, and
keeps margin firmly in healthy SaaS territory under both
scenarios.

## What needs to land in code

Most of the plumbing exists; what's missing:

### 1. Tier grants beyond Pro

`grantProMonthlyTokens()` in lib/storage.ts hardcodes
`PRO_MONTHLY_TOKEN_GRANT = 1,500,000`. Replace with a
`MONTHLY_TOKEN_GRANT` map keyed by tier slug, including the new
tiers (Personal Pro, Personal Plus, Solo, Small Firm, Growing
Firm, Enterprise). Stripe webhook on
`customer.subscription.created` / renewal calls the grant function
with the user's actual tier.

### 2. Metering gate covers every tier

`getProTokenGate()` returns null for non-Pro. Replace with
`getTokenGate()` that returns the gate for any tier the user
actually subscribes to. Free users get the 25k grant on signup
and are debited as normal - this is what protects us from "Free
user runs Bella in a loop" abuse.

### 3. Firm-pool variant

Add `firms.token_pool_balance` + `firms.token_pool_period_end`.
When a user is acting in firm context, debits hit the firm pool
first, falling back to the user's personal balance only if firm
pool is exhausted. Stripe webhook on the firm subscription credits
the pool with `seats × per_seat_grant`.

### 4. Top-up Stripe products

Four Stripe Products + Prices for Boost / Boost+ / Power / Mega.
Webhook on `payment_intent.succeeded` calls
`adjustTokens({delta: pack.tokens, reason: 'topup_*'})`. Pure
revenue passthrough; no subscription changes.

### 5. Auto top-up

Add `profiles.auto_topup_enabled` + `profiles.auto_topup_threshold`
+ `profiles.auto_topup_package`. Inside `consumeTokensForCurrentUser`
post-debit, if `new_balance < threshold` and the flag is on, fire
a Stripe charge for the saved pack against the user's default
payment method. Standard Stripe-saved-card pattern.

### 6. UI: balance gauge + low-balance prompt

`<TokenBalanceGauge>` component drops into the consumer header (and
the Bella chat surface). Renders a small ring filling from full
to empty as tokens are consumed. At <10% remaining, shows a "Top
up" CTA inline. At 0, the next Bella message returns "out of
tokens" with a quick top-up button.

### 7. UI: firm pool dashboard

`/counsel/billing/tokens` for owners + admins: shows the firm pool
balance, per-user usage breakdown (top consumer first), monthly
trend, and "buy more" buttons that credit the firm pool not a
personal one. Aimed at the partner who wants to see "is the team
using Bella enough to justify the spend".

## Sticky behaviors that compound margin

- **Top-up prompt at the moment of value**. When the user hits
  empty mid-task ("Bella, draft my demand letter"), a $5 top-up
  feels cheap; a $5 monthly increase feels expensive. Hit them at
  the value moment.
- **Roll-over at 2× cap**. Banks unused tokens; user feels they're
  getting more for their subscription dollar; we don't have to pay
  out anything extra (we already amortized the grant in the
  subscription price).
- **Auto top-up = pure recurring add-on revenue**. Even at $4.99 /
  mo per opted-in user, it materially shifts ARPU. A 20% opt-in
  rate on Personal Pro adds $1 / mo blended ARPU at ~64% margin.
- **Firm-pool visibility for partners**. Showing the partner
  "your team used 8.4M of 50M tokens this month" anchors them on
  the upgrade tier the moment they hit 80%.

## Implementation note

The schema additions are small (3 columns on profiles + 2 columns
on firms + 4 Stripe Product / Price entries). The library changes
fit in 200-300 lines across lib/storage.ts. The bulk of the work
is the UI for the gauge + dashboard, plus the Stripe webhook
extensions for the top-up products.

If we ship the backend pieces first (this commit), the existing
billing page already renders a token balance card for Pro users
- it just needs the gate widened so other tiers see the same
component, and the top-up Stripe Products defined.
