import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage-3 (firm-pool sibling) test for grantFirmPoolTokens' concurrency safety.
 * Same shape as tests/token-grant-idempotency.test.ts: a stateful admin-client
 * mock enforcing UNIQUE(firm_id, period_end) proves that two racing deliveries
 * for a new period both attempt the claim but only one credits the shared pool.
 */

type State = {
  /** null models "no firms row with that id", i.e. an UPDATE that matches nothing. */
  firm: { token_pool_balance: number; token_pool_period_end: string | null } | null;
  grants: Set<string>; // enforces UNIQUE(firm_id, period_end)
  ledger: Array<Record<string, unknown>>;
  claimInserts: number;
  claimDeletes: Array<Record<string, string>>;
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
                    if (table === 'firms') return { data: s.firm ? { ...s.firm } : null };
                    return { data: null };
                  },
                };
              },
            };
          },
          insert: async (row: Record<string, unknown>) => {
            const s = getState();
            if (table === 'token_firm_pool_grants') {
              s.claimInserts += 1;
              const key = `${row.firm_id}|${row.period_end}`;
              if (s.grants.has(key)) return { error: { code: '23505' } };
              s.grants.add(key);
              return { error: null };
            }
            if (table === 'token_ledger') {
              s.ledger.push(row);
              return { error: null };
            }
            return { error: null };
          },
          // update().eq().select('id') mirrors PostgREST: a matched row comes
          // back in `data`, a statement that matched nothing comes back as an
          // EMPTY ARRAY with no error.
          update(patch: Record<string, unknown>) {
            return {
              eq: () => ({
                select: async () => {
                  const s = getState();
                  if (table !== 'firms') return { data: [{ id: 'x' }], error: null };
                  if (!s.firm) return { data: [], error: null };
                  s.firm = { ...s.firm, ...patch } as NonNullable<State['firm']>;
                  return { data: [{ id: 'f1' }], error: null };
                },
              }),
            };
          },
          delete() {
            return {
              match: async (m: Record<string, string>) => {
                const s = getState();
                if (table === 'token_firm_pool_grants') {
                  s.claimDeletes.push(m);
                  s.grants.delete(`${m.firm_id}|${m.period_end}`);
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

import { grantFirmPoolTokens } from '../lib/token-economy';
import { FIRM_POOL_GRANT } from '../lib/token-packages';

const PERIOD = '2026-08-01T00:00:00.000Z';
// small_firm per-seat pool grant * 2 seats.
const PER_SEAT = FIRM_POOL_GRANT.small_firm;
const SEATS = 2;
const EXPECTED = PER_SEAT * SEATS;

function freshState(overrides?: Partial<State>): State {
  return {
    firm: { token_pool_balance: 0, token_pool_period_end: null },
    grants: new Set<string>(),
    ledger: [],
    claimInserts: 0,
    claimDeletes: [],
    ...overrides,
  };
}

describe('grantFirmPoolTokens concurrency', () => {
  beforeEach(() => {
    h.ref.state = freshState();
  });

  it('credits the pool once when two deliveries race the same new period', async () => {
    const s = h.ref.state as State;
    const [a, b] = await Promise.all([
      grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD }),
      grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD }),
    ]);

    expect([a, b].filter((r) => r.granted)).toHaveLength(1);
    expect(s.claimInserts).toBe(2); // both raced the claim
    expect(s.ledger).toHaveLength(1); // only one credited
    expect(s.firm?.token_pool_balance).toBe(EXPECTED);
    expect(s.grants.size).toBe(1);
  });

  it('sequential re-delivery of the same period is a no-op', async () => {
    const first = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });
    const second = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(s.ledger).toHaveLength(1);
    expect(s.firm?.token_pool_balance).toBe(EXPECTED);
  });

  it('legacy fast-path: already-granted period skips WITHOUT a claim insert', async () => {
    h.ref.state = freshState({
      firm: { token_pool_balance: EXPECTED, token_pool_period_end: PERIOD },
    });
    const res = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(res.granted).toBe(false);
    expect(s.claimInserts).toBe(0);
    expect(s.ledger).toHaveLength(0);
  });

  it('no grant when seats <= 0 (never claims)', async () => {
    const res = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: 0, periodEnd: PERIOD });
    const s = h.ref.state as State;
    expect(res.granted).toBe(false);
    expect(s.claimInserts).toBe(0);
  });
});

/**
 * A dropped pool credit used to be permanent: the claim survived, so every
 * later delivery of the period 23505'd and returned without crediting, while a
 * token_ledger row asserted a pool balance the firm never had.
 */
describe('grantFirmPoolTokens dropped-credit recovery', () => {
  let errors: string[];

  beforeEach(() => {
    h.ref.state = freshState({ firm: null }); // no firms row for this id
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the dropped credit and writes no ledger row', async () => {
    const res = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(res.granted).toBe(false);
    expect(s.ledger).toHaveLength(0);
    expect(errors.some((e) => e.includes('did not land'))).toBe(true);
  });

  it('leaves the period claimable so a later delivery credits the pool', async () => {
    await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });
    const s = h.ref.state as State;
    expect(s.claimDeletes).toHaveLength(1);
    expect(s.grants.size).toBe(0);

    s.firm = { token_pool_balance: 0, token_pool_period_end: null };
    const second = await grantFirmPoolTokens({ firmId: 'f1', tier: 'small_firm', seats: SEATS, periodEnd: PERIOD });

    expect(second.granted).toBe(true);
    expect(s.firm?.token_pool_balance).toBe(EXPECTED);
    expect(s.ledger).toHaveLength(1);
  });
});
