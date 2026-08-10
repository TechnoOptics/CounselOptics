import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * The firm pool had a fully tested grant helper and no caller, so the whole
 * idempotency suite passed while multi-seat firms were never credited for the
 * recurring entitlement they pay for. tests/firm-pool-grant-idempotency.test.ts
 * cannot catch that - it calls grantFirmPoolTokens directly, which is exactly
 * the thing production never did.
 *
 * So this drives the real Stripe webhook handler with a real firm-tier event
 * and asserts the pool is actually credited. Mocking stops at the module
 * boundaries the webhook talks to (Stripe, storage, token-economy); the
 * webhook route and lib/firm-billing.ts are the real code under test.
 */

const PERIOD_END_UNIX = 1_785_000_000; // fixed; no clock in the assertions
const PERIOD_END_ISO = new Date(PERIOD_END_UNIX * 1000).toISOString();

type FirmRow = { id: string; created_at: string };

const h = vi.hoisted(() => ({
  grantFirmPoolTokens: vi.fn(async () => ({ granted: true, balance: 0 })),
  grantTierMonthlyTokens: vi.fn(async () => ({ granted: true, balance: 0 })),
  /** What tierSlugFromPriceId resolves the event's price to. */
  tierSlug: { value: null as string | null },
  /** Rows the admin client returns for `firms where created_by = <user>`. */
  firms: { rows: [] as FirmRow[], activeFirmId: null as string | null },
  event: { value: null as unknown },
  subscription: { value: null as unknown },
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => h.event.value },
    subscriptions: { retrieve: async () => h.subscription.value },
    checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
  }),
  getWebhookSecret: () => 'whsec_test',
  tierFromPriceId: () => 'pro',
  tierSlugFromPriceId: () => h.tierSlug.value,
}));

vi.mock('@/lib/token-economy', () => ({
  grantTierMonthlyTokens: h.grantTierMonthlyTokens,
  grantFirmPoolTokens: h.grantFirmPoolTokens,
  applyTopupPurchase: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  upsertSubscriptionFromStripe: vi.fn(async () => undefined),
  userIdForStripeCustomer: vi.fn(async () => null),
  grantProMonthlyTokens: vi.fn(async () => undefined),
  adjustTokens: vi.fn(async () => undefined),
}));

vi.mock('@/lib/item-limits', () => ({
  applyMonthlyOverageDebit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => undefined) }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                // firms lookup by created_by
                order: async () =>
                  table === 'firms'
                    ? { data: h.firms.rows, error: null }
                    : { data: [], error: null },
                // profiles.active_firm_id tie-break
                maybeSingle: async () =>
                  table === 'profiles'
                    ? { data: { active_firm_id: h.firms.activeFirmId } }
                    : { data: null },
              };
            },
          };
        },
        insert: async () => ({ error: null }),
      };
    },
  }),
}));

import { POST } from '@/app/api/stripe/webhook/route';
import { firmFundedBySubscriber, seatsFromSubscription } from '@/lib/firm-billing';

/** The webhook only reads the signature header and the raw body. */
function fakeRequest(): NextRequest {
  return {
    headers: new Headers({ 'stripe-signature': 'sig' }),
    text: async () => '{}',
  } as unknown as NextRequest;
}

function subscriptionFixture(quantity: number | null) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: false,
    current_period_end: PERIOD_END_UNIX,
    metadata: { supabase_user_id: 'user_owner' },
    items: { data: [{ price: { id: 'price_counsel_small_firm' }, quantity }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.tierSlug.value = 'small_firm';
  h.firms.rows = [{ id: 'firm_1', created_at: '2026-01-01T00:00:00.000Z' }];
  h.firms.activeFirmId = null;
  h.subscription.value = subscriptionFixture(7);
});

describe('the Stripe webhook credits the firm pool', () => {
  it('grants the pool on a renewal, sized by billed seats', async () => {
    h.event.value = {
      type: 'invoice.payment_succeeded',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_1' } },
    };

    const res = await POST(fakeRequest());

    expect(res.status).toBe(200);
    expect(h.grantTierMonthlyTokens).toHaveBeenCalledTimes(1);
    expect(h.grantFirmPoolTokens).toHaveBeenCalledWith({
      firmId: 'firm_1',
      tier: 'small_firm',
      seats: 7,
      periodEnd: PERIOD_END_ISO,
    });
  });

  it('grants the pool on the first period too, not only on renewal', async () => {
    h.event.value = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          mode: 'subscription',
          customer: 'cus_1',
          subscription: 'sub_1',
          amount_total: 69_300,
          metadata: { supabase_user_id: 'user_owner' },
          customer_details: { email: 'owner@firm.example' },
        },
      },
    };

    const res = await POST(fakeRequest());

    expect(res.status).toBe(200);
    expect(h.grantFirmPoolTokens).toHaveBeenCalledWith({
      firmId: 'firm_1',
      tier: 'small_firm',
      seats: 7,
      periodEnd: PERIOD_END_ISO,
    });
  });

  it('leaves personal-ladder subscribers alone', async () => {
    h.tierSlug.value = 'premium';
    h.event.value = {
      type: 'invoice.payment_succeeded',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_1' } },
    };

    await POST(fakeRequest());

    expect(h.grantTierMonthlyTokens).toHaveBeenCalledTimes(1);
    expect(h.grantFirmPoolTokens).not.toHaveBeenCalled();
  });

  it('does not credit a pool for a subscriber who owns no firm', async () => {
    h.firms.rows = [];
    h.event.value = {
      type: 'invoice.payment_succeeded',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_1' } },
    };

    await POST(fakeRequest());

    expect(h.grantFirmPoolTokens).not.toHaveBeenCalled();
  });

  it('Solo has no pool, so a Solo renewal never claims one', async () => {
    h.tierSlug.value = 'solo';
    h.event.value = {
      type: 'invoice.payment_succeeded',
      data: { object: { billing_reason: 'subscription_cycle', subscription: 'sub_1' } },
    };

    await POST(fakeRequest());

    // Guarded before the firm lookup: a zero per-seat grant is not a grant.
    expect(h.grantFirmPoolTokens).not.toHaveBeenCalled();
  });
});

describe('seatsFromSubscription', () => {
  it('reads the billed quantity for per-seat firm tiers', () => {
    expect(seatsFromSubscription(subscriptionFixture(12) as never)).toBe(12);
  });

  it('falls back to one seat for a flat-rate item', () => {
    expect(seatsFromSubscription(subscriptionFixture(null) as never)).toBe(1);
  });
});

describe('firmFundedBySubscriber', () => {
  it('resolves the single firm the subscriber created', async () => {
    expect(await firmFundedBySubscriber('user_owner')).toBe('firm_1');
  });

  it('prefers the active firm when the subscriber created several', async () => {
    h.firms.rows = [
      { id: 'firm_old', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'firm_new', created_at: '2026-05-01T00:00:00.000Z' },
    ];
    h.firms.activeFirmId = 'firm_new';
    expect(await firmFundedBySubscriber('user_owner')).toBe('firm_new');
  });

  it('falls back to the oldest firm so repeat renewals stay on one claim key', async () => {
    h.firms.rows = [
      { id: 'firm_old', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'firm_new', created_at: '2026-05-01T00:00:00.000Z' },
    ];
    h.firms.activeFirmId = 'firm_unrelated';
    expect(await firmFundedBySubscriber('user_owner')).toBe('firm_old');
  });
});
