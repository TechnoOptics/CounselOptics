# Pricing change - Stripe rotation playbook

The in-app subscription prices changed:

| Tier | Was | Now |
|---|---|---|
| Basic | $25/mo | **$9/mo** |
| Standard | $50/mo | **$19/mo** |
| Pro | $100/mo | **$50/mo** |

Top-ups also rebalanced:

| Top-up | Was | Now |
|---|---|---|
| Quick (200k tokens) | $10 | **$5** |
| Steady (600k tokens) | $25 | **$12** |
| Power (1.5M tokens) | $50 | **$25** |

The code changes (`lib/types.ts`, `app/billing/topup-buttons.tsx`,
JSON-LD on the home page, webhook admin-email labels, App Store
listing description) shipped with the pricing-change commit.
**Stripe Price objects are immutable**, so the new dollar amounts
need new Price IDs - I cannot do that step from the codebase. Here
is the 10-minute manual playbook:

---

## 1. Create new Price objects in Stripe (5 min)

Open https://dashboard.stripe.com/products and find the existing
Advottic products. For each tier:

1. Open the product (Basic / Standard / Pro).
2. Under **Pricing → Add another price**, set:
   - **Price**: `9.00`, `19.00`, or `50.00` USD
   - **Billing period**: Monthly
   - **Type**: Recurring
3. Save. Copy the new Price ID (starts with `price_`).

Same drill for the three top-ups under their existing Top-up
product (or one product per top-up size if that is how they were
set up):

| Top-up size | New price |
|---|---|
| Small | $5.00 one-time |
| Medium | $12.00 one-time |
| Large | $25.00 one-time |

Top-ups are **one-time** charges, not recurring.

---

## 2. Update Vercel env vars (3 min)

Open https://vercel.com/technooptics-projects/counsel-optics →
**Settings → Environment Variables**. Replace the value of each:

| Env var | Paste the new Price ID |
|---|---|
| `STRIPE_PRICE_BASIC` | new Basic monthly Price ID |
| `STRIPE_PRICE_STANDARD` | new Standard monthly Price ID |
| `STRIPE_PRICE_PRO` | new Pro monthly Price ID |
| `STRIPE_PRICE_TOPUP_SMALL` | new Small top-up Price ID |
| `STRIPE_PRICE_TOPUP_MEDIUM` | new Medium top-up Price ID |
| `STRIPE_PRICE_TOPUP_LARGE` | new Large top-up Price ID |

Apply to **Production**, **Preview**, and **Development** for
each. Click Save, then **Redeploy** the latest production
deployment from Deployments → ⋯ → Redeploy. New env values take
effect on next request.

---

## 3. Archive the old Price objects (2 min)

In the Stripe dashboard, find the old `$25 / $50 / $100` Price IDs
and the old top-up Price IDs. Click into each → ⋯ → **Archive**.
This prevents anyone from accidentally being charged the old
amount via a stale checkout link.

Existing subscribers stay on whatever Price they signed up under
until they cancel or upgrade. Stripe handles that automatically -
archiving the price does not retro-cancel anyone.

---

## 4. Verify (2 min)

1. Open https://www.advottic.com/billing in an incognito window.
2. Confirm the tier cards show **$9 / $19 / $50**.
3. Click **Start Basic**. Stripe Checkout should open with a $9
   price (or $0 with a 7-day free trial banner).
4. Cancel out of checkout (browser back).
5. Sign up via a free trial. After 7 days the first real charge
   should be at the new price.

If a tier card shows the new dollar amount but checkout still
opens at the old amount, Vercel did not pick up the new env var
yet. Force a clean redeploy.

---

## 5. Communicate the change (optional)

If you have any users who signed up at the old prices and you
want to grandfather or reduce them to the new prices:

- Open the customer in Stripe → **Subscriptions** → the active
  sub → **Update subscription** → swap to the new Price ID.
- Stripe pro-rates the difference automatically.

For the first wave of beta testers from your `/invite` link, this
matters less - many of them are still on the 7-day free trial and
have never been charged.
