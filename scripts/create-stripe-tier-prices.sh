#!/usr/bin/env bash
# One-time setup: create the 6 new-tier Stripe Products + their
# monthly and annual (20%-off prepay) Prices.
#
# Run from the repo root with STRIPE_SECRET_KEY in the env, e.g.:
#   set -a && source .env.production.local && set +a && bash scripts/create-stripe-tier-prices.sh
#
# Idempotency: each product is tagged with metadata.advottic_tier_slug.
# Re-running creates duplicates - check the Stripe dashboard first if
# you suspect this has run before. The script prints every Price ID
# at the end so you can paste them into Vercel env vars.

set -euo pipefail

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "STRIPE_SECRET_KEY missing. Pull env first:"
  echo "  npx vercel env pull --environment=production .env.production.local"
  echo "  set -a && source .env.production.local && set +a"
  exit 1
fi

STRIPE_BASE="https://api.stripe.com/v1"
KEY="$STRIPE_SECRET_KEY"

# Helper: create a Product + monthly Price + annual Price (20% off).
# Args: tier_slug display_name unit_amount_monthly_cents per_seat ("yes"|"no") description
make_tier() {
  local slug="$1"
  local name="$2"
  local monthly_cents="$3"
  local per_seat="$4"
  local description="$5"

  local annual_cents
  annual_cents=$(( monthly_cents * 12 * 80 / 100 ))

  echo
  echo "=== $name ($slug) ==="
  echo "  Monthly: \$$(printf "%.2f" "$(echo "$monthly_cents / 100" | bc -l)")"
  echo "  Annual (20% off): \$$(printf "%.2f" "$(echo "$annual_cents / 100" | bc -l)")"

  # Create the product.
  local prod_resp
  prod_resp=$(curl -sS "$STRIPE_BASE/products" \
    -u "$KEY:" \
    -d "name=$name" \
    -d "description=$description" \
    -d "metadata[advottic_tier_slug]=$slug" \
    --data-urlencode "statement_descriptor_prefix=ADVOTTIC")
  local prod_id
  prod_id=$(echo "$prod_resp" | python -c "import json, sys; print(json.load(sys.stdin).get('id', ''))")
  if [[ -z "$prod_id" ]]; then
    echo "ERROR creating product: $prod_resp"
    return 1
  fi
  echo "  Product: $prod_id"

  # Monthly price.
  local args_monthly=(
    -u "$KEY:"
    -d "product=$prod_id"
    -d "currency=usd"
    -d "unit_amount=$monthly_cents"
    -d "recurring[interval]=month"
    -d "metadata[advottic_tier_slug]=$slug"
    -d "metadata[advottic_cadence]=monthly"
    -d "nickname=$name (monthly)"
  )
  if [[ "$per_seat" == "yes" ]]; then
    args_monthly+=( -d "recurring[usage_type]=licensed" )
  fi
  local price_monthly_resp
  price_monthly_resp=$(curl -sS "$STRIPE_BASE/prices" "${args_monthly[@]}")
  local price_monthly_id
  price_monthly_id=$(echo "$price_monthly_resp" | python -c "import json, sys; print(json.load(sys.stdin).get('id', ''))")
  echo "  Price (monthly): $price_monthly_id"

  # Annual price (20% prepay discount).
  local args_annual=(
    -u "$KEY:"
    -d "product=$prod_id"
    -d "currency=usd"
    -d "unit_amount=$annual_cents"
    -d "recurring[interval]=year"
    -d "metadata[advottic_tier_slug]=$slug"
    -d "metadata[advottic_cadence]=annual"
    -d "nickname=$name (annual, 20% off prepay)"
  )
  if [[ "$per_seat" == "yes" ]]; then
    args_annual+=( -d "recurring[usage_type]=licensed" )
  fi
  local price_annual_resp
  price_annual_resp=$(curl -sS "$STRIPE_BASE/prices" "${args_annual[@]}")
  local price_annual_id
  price_annual_id=$(echo "$price_annual_resp" | python -c "import json, sys; print(json.load(sys.stdin).get('id', ''))")
  echo "  Price (annual):  $price_annual_id"

  # Append to summary at the end.
  echo "$slug|$price_monthly_id|$price_annual_id" >> /tmp/advottic-prices.txt
}

> /tmp/advottic-prices.txt

# Consumer tiers (flat monthly, no per-seat).
make_tier "personal_pro"          "Advottic Personal Pro"        1900   "no"  "20 cases or contracts + 500K Bella tokens / month. Pro se litigant tier."
make_tier "personal_plus"         "Advottic Personal Plus"       2900   "no"  "50 cases or contracts + 1.5M Bella tokens / month, family share, $1,000 yr Counsel credit."

# Firm tiers (per-seat licensed).
make_tier "counsel_solo"          "Advottic Counsel Solo"        5900   "yes" "30 matters / attorney + 2.5M tokens / mo. 1 attorney + 1 staff."
make_tier "counsel_small_firm"    "Advottic Counsel Small Firm"  9900   "yes" "50 matters / attorney + 4M tokens / seat firm pool. Up to 25 users."
make_tier "counsel_growing"       "Advottic Counsel Growing"     14900  "yes" "100 matters / attorney + 6M tokens / seat firm pool. 26-100 users."
make_tier "counsel_enterprise"    "Advottic Counsel Enterprise"  180000 "no"  "Base from \$1,800/month. 100+ users, SSO, SLA, BAA, custom data residency."

echo
echo "================================================================"
echo "SUMMARY - paste these into Vercel env vars"
echo "================================================================"
cat /tmp/advottic-prices.txt | awk -F'|' '{
  slug = toupper($1)
  printf "STRIPE_PRICE_%-30s = %s\n", slug, $2
  printf "STRIPE_PRICE_%-30s = %s\n", slug "_ANNUAL", $3
}'
echo
echo "Vercel env var names map to slugs:"
echo "  personal_pro       -> STRIPE_PRICE_PERSONAL_PRO / _ANNUAL"
echo "  personal_plus      -> STRIPE_PRICE_PERSONAL_PLUS / _ANNUAL"
echo "  counsel_solo       -> STRIPE_PRICE_COUNSEL_SOLO / _ANNUAL"
echo "  counsel_small_firm -> STRIPE_PRICE_COUNSEL_SMALL_FIRM / _ANNUAL"
echo "  counsel_growing    -> STRIPE_PRICE_COUNSEL_GROWING / _ANNUAL"
echo "  counsel_enterprise -> STRIPE_PRICE_COUNSEL_ENTERPRISE / _ANNUAL"
