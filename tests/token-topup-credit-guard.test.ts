import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * applyTopupPurchase is the paid-token money path: Stripe takes the customer's
 * money, the webhook calls this, and the tokens are supposed to appear.
 *
 * The purchase is claimed insert-first on UNIQUE(stripe_payment_intent_id) so a
 * redelivered webhook cannot credit twice. Before this guard the credit that
 * followed the claim was fire-and-forget: no `.select()`, result never read.
 * PostgREST answers a statement that matched no row with an empty row set and
 * no error, and supabase-js resolves with `{ error }` rather than throwing, so a
 * dropped credit was indistinguishable from a good one - and the receipt row it
 * left behind made the loss permanent, because the next delivery took the
 * duplicate-key branch and returned ok. A token_ledger row was written either
 * way, asserting a balance_after nobody ever held.
 *
 * The mock below is a stateful fake enforcing exactly that UNIQUE constraint,
 * with three separately controllable write outcomes: matched (a row comes back),
 * matched-nothing (empty array, no error) and rejected (`{ error }`).
 */

type Outcome = 'ok' | 'no_row' | 'error';

type State = {
  profileBalance: number;
  firmBalance: number;
  /** How the profiles / firms UPDATE answers. */
  userWrite: Outcome;
  firmWrite: Outcome;
  receipts: Set<string>; // enforces UNIQUE(stripe_payment_intent_id)
  receiptInserts: number;
  receiptDeletes: string[];
  ledger: Array<Record<string, unknown>>;
};

const h = vi.hoisted(() => {
  const ref: { state: unknown } = { state: undefined };

  function makeAdmin(getState: () => State) {
    return {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => {
                    const s = getState();
                    if (table === 'profiles') return { data: { token_balance: s.profileBalance } };
                    if (table === 'firms') {
                      return { data: { token_pool_balance: s.firmBalance } };
                    }
                    return { data: null };
                  },
                };
              },
            };
          },
          insert: async (row: Record<string, unknown>) => {
            const s = getState();
            if (table === 'token_topup_purchases') {
              s.receiptInserts += 1;
              const key = String(row.stripe_payment_intent_id);
              if (s.receipts.has(key)) return { error: { code: '23505', message: 'dup' } };
              s.receipts.add(key); // atomic claim, like the DB unique index
              return { error: null };
            }
            if (table === 'token_ledger') {
              s.ledger.push(row);
              return { error: null };
            }
            return { error: null };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: () => ({
                select: async () => {
                  const s = getState();
                  const outcome = table === 'firms' ? s.firmWrite : s.userWrite;
                  if (outcome === 'error') {
                    return { data: null, error: { message: 'connection reset' } };
                  }
                  if (outcome === 'no_row') return { data: [], error: null };
                  if (table === 'firms') {
                    s.firmBalance = Number(patch.token_pool_balance);
                  } else {
                    s.profileBalance = Number(patch.token_balance);
                  }
                  return { data: [{ id: 'row' }], error: null };
                },
              }),
            };
          },
          delete() {
            return {
              match: async (m: Record<string, string>) => {
                const s = getState();
                if (table === 'token_topup_purchases') {
                  const key = m.stripe_payment_intent_id;
                  s.receiptDeletes.push(key);
                  s.receipts.delete(key);
                }
                return { error: null };
              },
            };
          },
        };
      },
    };
  }

  return { ref, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(() => h.ref.state as State),
}));

import { applyTopupPurchase } from '../lib/token-economy';
import { TOKEN_PACKAGES } from '../lib/token-packages';

const PACK = TOKEN_PACKAGES[0];
const INTENT = 'pi_test_1';

function freshState(overrides?: Partial<State>): State {
  return {
    profileBalance: 0,
    firmBalance: 0,
    userWrite: 'ok',
    firmWrite: 'ok',
    receipts: new Set<string>(),
    receiptInserts: 0,
    receiptDeletes: [],
    ledger: [],
    ...overrides,
  };
}

function buy(over?: { userId?: string | null; firmId?: string | null }) {
  return applyTopupPurchase({
    paymentIntentId: INTENT,
    packageId: PACK.id,
    userId: 'u1',
    firmId: null,
    amountCents: PACK.priceCents ?? 0,
    ...over,
  });
}

describe('applyTopupPurchase happy path and idempotency', () => {
  beforeEach(() => {
    h.ref.state = freshState();
  });

  it('credits the user once and records one ledger row', async () => {
    const res = await buy();
    const s = h.ref.state as State;

    expect(res.ok).toBe(true);
    expect(res.tokens).toBe(PACK.tokens);
    expect(s.profileBalance).toBe(PACK.tokens);
    expect(s.ledger).toHaveLength(1);
    expect(s.ledger[0].balance_after).toBe(PACK.tokens);
  });

  it('a redelivered webhook for the same intent does not credit twice', async () => {
    await buy();
    const second = await buy();
    const s = h.ref.state as State;

    expect(second.ok).toBe(true); // idempotent success
    expect(s.profileBalance).toBe(PACK.tokens);
    expect(s.ledger).toHaveLength(1);
  });

  it('two concurrent deliveries of the same intent credit exactly once', async () => {
    const [a, b] = await Promise.all([buy(), buy()]);
    const s = h.ref.state as State;

    expect(a.ok && b.ok).toBe(true);
    expect(s.receiptInserts).toBe(2); // both really raced the claim
    expect(s.profileBalance).toBe(PACK.tokens);
    expect(s.ledger).toHaveLength(1);
  });
});

describe('applyTopupPurchase dropped-credit handling', () => {
  let errors: string[];

  beforeEach(() => {
    h.ref.state = freshState();
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not report success, or write a ledger row, when the credit matched no row', async () => {
    h.ref.state = freshState({ userWrite: 'no_row' });
    const res = await buy();
    const s = h.ref.state as State;

    expect(res.ok).toBe(false);
    expect(s.profileBalance).toBe(0);
    // The ledger is what an audit or a disputed charge is read from. It must
    // not carry a balance_after that was never reached.
    expect(s.ledger).toHaveLength(0);
    expect(errors.some((e) => e.includes('did not land'))).toBe(true);
  });

  it('releases the receipt so a provably-uncredited purchase can be applied again', async () => {
    h.ref.state = freshState({ userWrite: 'no_row' });
    await buy();
    const s = h.ref.state as State;

    expect(s.receiptDeletes).toEqual([INTENT]);
    expect(s.receipts.size).toBe(0);

    // Cause fixed, purchase reapplied. Without the release this second call
    // takes the 23505 branch and returns ok:true having credited nothing -
    // the customer paid and the receipt says delivered.
    s.userWrite = 'ok';
    const second = await buy();

    expect(second.ok).toBe(true);
    expect(s.profileBalance).toBe(PACK.tokens);
    expect(s.ledger).toHaveLength(1); // exactly one, for the credit that landed
  });

  it('KEEPS the receipt when the write could not be proved absent', async () => {
    // An errored write may have been applied and only lost its response. The
    // top-up credit is a relative increment with no per-payment stamp on the
    // balance row, so the receipt is the only thing making it exactly-once.
    // Releasing it here would turn a possible single credit into a possible
    // double credit; we keep it and name the intent for reconciliation.
    h.ref.state = freshState({ userWrite: 'error' });
    const res = await buy();
    const s = h.ref.state as State;

    expect(res.ok).toBe(false);
    expect(s.ledger).toHaveLength(0);
    expect(s.receiptDeletes).toHaveLength(0);
    expect(s.receipts.has(INTENT)).toBe(true);
    expect(errors.some((e) => e.includes('reconcile this payment intent by hand'))).toBe(true);
  });

  it('applies the same guard to the firm pool credit', async () => {
    h.ref.state = freshState({ firmWrite: 'no_row' });
    const res = await buy({ firmId: 'f1' });
    const s = h.ref.state as State;

    expect(res.ok).toBe(false);
    expect(s.firmBalance).toBe(0);
    expect(s.ledger).toHaveLength(0);
    expect(s.receipts.size).toBe(0); // released, retryable
    expect(errors.some((e) => e.includes('did not land'))).toBe(true);
  });
});
