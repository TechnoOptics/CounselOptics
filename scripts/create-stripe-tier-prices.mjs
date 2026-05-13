/**
 * One-time setup: create the 6 new-tier Stripe Products + their
 * monthly and annual (20%-off prepay) Prices.
 *
 * Run from the repo root with STRIPE_SECRET_KEY in process.env:
 *   npx vercel env pull --environment=production .env.production.local
 *   node --env-file=.env.production.local scripts/create-stripe-tier-prices.mjs
 *
 * Idempotency: each product is tagged with metadata.advottic_tier_slug.
 * Before creating, the script searches for an existing product with
 * the same slug and skips. Re-running is safe (won't create duplicates).
 */

import https from 'node:https';
import { URLSearchParams } from 'node:url';

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('STRIPE_SECRET_KEY missing. Pull env first:');
  console.error('  npx vercel env pull --environment=production .env.production.local');
  console.error('  node --env-file=.env.production.local scripts/create-stripe-tier-prices.mjs');
  process.exit(1);
}

// Minimal Stripe API wrapper - basic auth + form-encoded body.
function stripeRequest(path, method = 'GET', body = null) {
  const isForm = method !== 'GET' && body && typeof body === 'object';
  const bodyStr = isForm ? new URLSearchParams(body).toString() : '';
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        port: 443,
        path: `/v1${path}`,
        method,
        headers: {
          Authorization: `Bearer ${KEY}`,
          ...(isForm
            ? {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr),
              }
            : {}),
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(chunks);
            if (res.statusCode >= 400) {
              reject(new Error(`Stripe ${res.statusCode}: ${json.error?.message || chunks}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Bad Stripe response ${res.statusCode}: ${chunks.slice(0, 400)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (isForm) req.write(bodyStr);
    req.end();
  });
}

const TIERS = [
  {
    slug: 'personal_pro',
    name: 'Advottic Personal Pro',
    description:
      '20 cases or contracts + 500K Bella tokens / month. Pro se litigant tier.',
    monthlyCents: 1900,
    perSeat: false,
  },
  {
    slug: 'personal_plus',
    name: 'Advottic Personal Plus',
    description:
      '50 cases or contracts + 1.5M Bella tokens / month, family share, $1,000/yr Counsel credit.',
    monthlyCents: 2900,
    perSeat: false,
  },
  {
    slug: 'counsel_solo',
    name: 'Advottic Counsel Solo',
    description:
      '30 matters / attorney + 2.5M Bella tokens / month. 1 attorney + 1 staff.',
    monthlyCents: 5900,
    perSeat: true,
  },
  {
    slug: 'counsel_small_firm',
    name: 'Advottic Counsel Small Firm',
    description:
      '50 matters / attorney + 4M tokens / seat firm pool. Up to 25 users.',
    monthlyCents: 9900,
    perSeat: true,
  },
  {
    slug: 'counsel_growing',
    name: 'Advottic Counsel Growing',
    description:
      '100 matters / attorney + 6M tokens / seat firm pool. 26-100 users.',
    monthlyCents: 14900,
    perSeat: true,
  },
  {
    slug: 'counsel_enterprise',
    name: 'Advottic Counsel Enterprise',
    description:
      'Base from $1,800/month. 100+ users, SSO, SLA, BAA, custom data residency.',
    monthlyCents: 180000,
    perSeat: false,
  },
];

function fmt(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function findExistingProductBySlug(slug) {
  // Stripe products search by metadata. Returns first match or null.
  const path = `/products/search?query=${encodeURIComponent(
    `metadata['advottic_tier_slug']:'${slug}'`,
  )}`;
  const resp = await stripeRequest(path);
  return resp.data?.[0] ?? null;
}

async function createPrice(productId, slug, name, cents, interval, perSeat) {
  const cadence = interval === 'month' ? 'monthly' : 'annual';
  const body = {
    product: productId,
    currency: 'usd',
    unit_amount: String(cents),
    'recurring[interval]': interval,
    'metadata[advottic_tier_slug]': slug,
    'metadata[advottic_cadence]': cadence,
    nickname: `${name} (${interval === 'month' ? 'monthly' : 'annual, 20% off prepay'})`,
  };
  if (perSeat) {
    body['recurring[usage_type]'] = 'licensed';
  }
  return stripeRequest('/prices', 'POST', body);
}

const results = [];

for (const tier of TIERS) {
  console.log(`\n=== ${tier.name} (${tier.slug}) ===`);
  const annualCents = Math.floor((tier.monthlyCents * 12 * 80) / 100);
  console.log(`  Monthly: ${fmt(tier.monthlyCents)}`);
  console.log(`  Annual (20% off): ${fmt(annualCents)}`);

  // Idempotency: skip if a product with this slug already exists.
  let product = await findExistingProductBySlug(tier.slug);
  if (product) {
    console.log(`  ✓ Product exists, skipping creation: ${product.id}`);
  } else {
    product = await stripeRequest('/products', 'POST', {
      name: tier.name,
      description: tier.description,
      'metadata[advottic_tier_slug]': tier.slug,
      statement_descriptor: 'ADVOTTIC',
    });
    console.log(`  + Product: ${product.id}`);
  }

  const monthlyPrice = await createPrice(
    product.id,
    tier.slug,
    tier.name,
    tier.monthlyCents,
    'month',
    tier.perSeat,
  );
  console.log(`  + Price (monthly): ${monthlyPrice.id}`);

  const annualPrice = await createPrice(
    product.id,
    tier.slug,
    tier.name,
    annualCents,
    'year',
    tier.perSeat,
  );
  console.log(`  + Price (annual): ${annualPrice.id}`);

  results.push({
    slug: tier.slug,
    productId: product.id,
    monthlyPriceId: monthlyPrice.id,
    annualPriceId: annualPrice.id,
  });
}

console.log('\n================================================================');
console.log('SUMMARY - Vercel env vars to set');
console.log('================================================================');
for (const r of results) {
  const upper = r.slug.toUpperCase();
  console.log(`STRIPE_PRICE_${upper} = ${r.monthlyPriceId}`);
  console.log(`STRIPE_PRICE_${upper}_ANNUAL = ${r.annualPriceId}`);
}
console.log('\nDone.');
