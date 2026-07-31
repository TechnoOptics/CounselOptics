/**
 * One-time setup: create the four NEW consumer ("personal") plan Products and
 * their monthly + annual (20%-off prepay) Prices in Stripe: Starter ($19),
 * Plus ($29), Pro ($59), Ultra ($99). Free needs no Stripe price.
 *
 * Run from the repo root with STRIPE_SECRET_KEY in process.env:
 *   npx vercel env pull --environment=production .env.production.local
 *   node --env-file=.env.production.local scripts/create-personal-tier-prices.mjs
 *
 * Idempotent: each product is tagged metadata.advottic_tier_slug; a re-run
 * finds the existing product and reuses it (it still mints fresh Price rows,
 * so run once, capture the ids, and paste them into Vercel).
 *
 * At the end it prints the exact Vercel env vars to set. Copy those in.
 */

import https from 'node:https';
import { URLSearchParams } from 'node:url';

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('STRIPE_SECRET_KEY missing. Pull env first:');
  console.error('  npx vercel env pull --environment=production .env.production.local');
  console.error('  node --env-file=.env.production.local scripts/create-personal-tier-prices.mjs');
  process.exit(1);
}

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

// Mirrors lib/personal-tiers.ts. `envMonthly`/`envAnnual` are the Vercel keys.
const TIERS = [
  {
    slug: 'personal_starter',
    name: 'Advottic Starter',
    description: '3 cases + 150K Bella tokens / month. PDF export, find counsel.',
    monthlyCents: 1900,
    envMonthly: 'STRIPE_PRICE_PERSONAL_STARTER',
    envAnnual: 'STRIPE_PRICE_PERSONAL_STARTER_ANNUAL',
  },
  {
    slug: 'personal_plus8',
    name: 'Advottic Plus',
    description: '8 cases + 500K tokens / month. Bella AI assistant unlocks here.',
    monthlyCents: 2900,
    envMonthly: 'STRIPE_PRICE_PERSONAL_PLUS8',
    envAnnual: 'STRIPE_PRICE_PERSONAL_PLUS8_ANNUAL',
  },
  {
    slug: 'personal_pro15',
    name: 'Advottic Pro',
    description: '15 cases + 1.5M tokens / month. Advottic Review + invite your firm.',
    monthlyCents: 5900,
    envMonthly: 'STRIPE_PRICE_PERSONAL_PRO15',
    envAnnual: 'STRIPE_PRICE_PERSONAL_PRO15_ANNUAL',
  },
  {
    slug: 'personal_ultra',
    name: 'Advottic Ultra',
    description: '40 cases + 3M tokens / month. Everything in Pro, at scale.',
    monthlyCents: 9900,
    envMonthly: 'STRIPE_PRICE_PERSONAL_ULTRA',
    envAnnual: 'STRIPE_PRICE_PERSONAL_ULTRA_ANNUAL',
  },
];

const fmt = (c) => `$${(c / 100).toFixed(2)}`;

async function findExistingProductBySlug(slug) {
  const path = `/products/search?query=${encodeURIComponent(
    `metadata['advottic_tier_slug']:'${slug}'`,
  )}`;
  const resp = await stripeRequest(path);
  return resp.data?.[0] ?? null;
}

async function createPrice(productId, slug, name, cents, interval) {
  return stripeRequest('/prices', 'POST', {
    product: productId,
    currency: 'usd',
    unit_amount: String(cents),
    'recurring[interval]': interval,
    'metadata[advottic_tier_slug]': slug,
    'metadata[advottic_cadence]': interval === 'month' ? 'monthly' : 'annual',
    nickname: `${name} (${interval === 'month' ? 'monthly' : 'annual, 20% off prepay'})`,
  });
}

const envLines = [];

for (const tier of TIERS) {
  console.log(`\n=== ${tier.name} (${tier.slug}) ===`);
  const annualCents = Math.floor((tier.monthlyCents * 12 * 80) / 100);
  console.log(`  Monthly: ${fmt(tier.monthlyCents)}   Annual (20% off): ${fmt(annualCents)}`);

  let product = await findExistingProductBySlug(tier.slug);
  if (product) {
    console.log(`  ✓ Product exists: ${product.id}`);
  } else {
    product = await stripeRequest('/products', 'POST', {
      name: tier.name,
      description: tier.description,
      'metadata[advottic_tier_slug]': tier.slug,
      statement_descriptor: 'ADVOTTIC',
    });
    console.log(`  + Product: ${product.id}`);
  }

  const monthlyPrice = await createPrice(product.id, tier.slug, tier.name, tier.monthlyCents, 'month');
  console.log(`  + Price (monthly): ${monthlyPrice.id}`);
  const annualPrice = await createPrice(product.id, tier.slug, tier.name, annualCents, 'year');
  console.log(`  + Price (annual):  ${annualPrice.id}`);

  envLines.push(`${tier.envMonthly}=${monthlyPrice.id}`);
  envLines.push(`${tier.envAnnual}=${annualPrice.id}`);
}

console.log('\n================================================================');
console.log('Add these to Vercel (Production) env, then redeploy:\n');
console.log(envLines.join('\n'));
console.log('\n================================================================');
