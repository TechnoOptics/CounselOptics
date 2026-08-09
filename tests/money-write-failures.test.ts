import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Money-path writes that reported success without checking whether the write
 * landed. postgrest-js resolves with `{ error }` instead of throwing, so these
 * failures were invisible and the callers were told everything worked.
 *
 * Both cases below are reached from the Stripe webhook, which already has the
 * right convention for this (see app/api/stripe/webhook/route.ts: "Do NOT
 * acknowledge: a 2xx here discards the only notice we get"). These tests pin
 * the return values that convention depends on.
 */

type State = {
  gift: Record<string, unknown> & {
    id: string;
    status: string;
    email_sent_at: string | null;
  };
  profile: { token_balance: number; token_overage_period_end: string | null };
  counts: { cases: number; contracts: number };
  fail: { giftStatus?: boolean; profileUpdate?: boolean };
  emailsSent: number;
};

const h = vi.hoisted(() => {
  const ref: { state: unknown } = { state: undefined };

  function thenable(value: unknown) {
    const b: Record<string, unknown> = {
      eq: () => b,
      neq: () => b,
      is: () => b,
      not: () => b,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(value).then(res, rej),
    };
    return b;
  }

  function makeAdmin(getState: () => State) {
    return {
      from(table: string) {
        return {
          select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
            const s = getState();
            if (opts?.head) {
              const count =
                table === 'cases' ? s.counts.cases : s.counts.contracts;
              return thenable({ count, error: null });
            }
            return {
              eq() {
                return {
                  maybeSingle: async () => {
                    if (table === 'gift_subscriptions') {
                      return { data: { ...s.gift }, error: null };
                    }
                    if (table === 'profiles') {
                      return { data: { ...s.profile }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            const s = getState();
            if (table === 'gift_subscriptions') {
              if (s.fail.giftStatus) {
                return thenable({ error: { code: '500', message: 'write failed' } });
              }
              s.gift = { ...s.gift, ...patch } as State['gift'];
            }
            if (table === 'profiles') {
              if (s.fail.profileUpdate) {
                return thenable({ error: { code: '500', message: 'write failed' } });
              }
              s.profile = { ...s.profile, ...patch } as State['profile'];
            }
            return thenable({ error: null });
          },
          insert: async () => ({ error: null }),
          delete: () => thenable({ error: null }),
        };
      },
    };
  }

  return { ref, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(() => h.ref.state as State),
}));

vi.mock('../lib/email', () => ({
  sendEmail: async () => {
    (h.ref.state as State).emailsSent += 1;
    return { id: 'em_1' };
  },
}));

import { applyGiftPaid } from '../lib/gift-server';
import { applyMonthlyOverageDebit } from '../lib/item-limits';

const PERIOD = '2026-09-01T00:00:00.000Z';

function freshState(overrides?: Partial<State>): State {
  return {
    // Full row: the email builder reads every one of these, so a partial
    // fixture would blow up before the assertion it is meant to test.
    gift: {
      id: 'g1',
      status: 'pending_payment',
      email_sent_at: null,
      recipient_name: 'Sam',
      recipient_email: 'sam@example.com',
      recipient_phone: null,
      gifter_name: 'Alex',
      gifter_email: 'alex@example.com',
      personal_note: null,
      tier_slug: 'premium',
      duration_months: 3,
      amount_cents: 5000,
      redemption_token: 'tok_1',
    },
    profile: { token_balance: 100_000, token_overage_period_end: null },
    counts: { cases: 0, contracts: 0 },
    fail: {},
    emailsSent: 0,
    ...overrides,
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.ref.state = freshState();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('applyGiftPaid when the paid-status write fails', () => {
  it('reports failure so the webhook can decline to acknowledge', async () => {
    (h.ref.state as State).fail.giftStatus = true;

    const res = await applyGiftPaid({
      giftId: 'g1',
      paymentIntentId: 'pi_1',
      stripeSessionId: 'cs_1',
      amountCents: 5000,
    });

    // A 2xx here would end Stripe's retries and strand a paid gift in
    // pending_payment, which no later delivery would ever correct.
    expect(res.ok).toBe(false);
    expect((h.ref.state as State).gift.status).toBe('pending_payment');
  });
});

describe('applyMonthlyOverageDebit when the debit write fails', () => {
  it('does not report a debit it never applied', async () => {
    // 60 items on starter (limit 15) puts the user well over the cap.
    h.ref.state = freshState({
      counts: { cases: 60, contracts: 0 },
      fail: { profileUpdate: true },
    });

    const res = await applyMonthlyOverageDebit({
      userId: 'u1',
      tier: 'starter',
      periodEnd: PERIOD,
    });

    expect(res.debited).toBe(0);
    expect((h.ref.state as State).profile.token_balance).toBe(100_000);
  });

  it('still reports the debit it did apply when the write lands', async () => {
    h.ref.state = freshState({ counts: { cases: 60, contracts: 0 } });

    const res = await applyMonthlyOverageDebit({
      userId: 'u1',
      tier: 'starter',
      periodEnd: PERIOD,
    });

    expect(res.debited).toBeGreaterThan(0);
    expect((h.ref.state as State).profile.token_balance).toBeLessThan(100_000);
  });
});
