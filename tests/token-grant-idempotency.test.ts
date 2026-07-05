import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stage-3 test for grantTierMonthlyTokens' concurrency safety.
 *
 * The old implementation gated only on a read of profiles.token_quota_period_end,
 * so two deliveries for a NEW period could both pass the check and both credit
 * the balance / write the ledger. The fix claims (user_id, period_end) via an
 * insert against a UNIQUE index first, so only the first delivery credits.
 *
 * We can't hit a real Postgres here, so we mock the admin client with a stateful
 * fake that enforces exactly that UNIQUE constraint (the second insert for the
 * same key returns a 23505), and prove: concurrent grants credit once; the
 * legacy period_end fast-path still short-circuits without touching the claim
 * table (so a post-deploy re-delivery doesn't re-grant existing subscribers).
 */

type State = {
  profile: { token_balance: number; token_quota_period_end: string | null };
  grants: Set<string>; // enforces UNIQUE(user_id, period_end)
  ledger: Array<Record<string, unknown>>;
  claimInserts: number;
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
                    if (table === 'profiles') return { data: { ...s.profile } };
                    return { data: null };
                  },
                };
              },
            };
          },
          // insert() is awaited directly by the code under test.
          insert: async (row: Record<string, unknown>) => {
            const s = getState();
            if (table === 'token_monthly_grants') {
              s.claimInserts += 1;
              const key = `${row.user_id}|${row.period_end}`;
              if (s.grants.has(key)) return { error: { code: '23505' } };
              s.grants.add(key); // atomic claim, like the DB unique index
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
              eq: async () => {
                const s = getState();
                if (table === 'profiles') {
                  s.profile = { ...s.profile, ...patch } as State['profile'];
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

import { grantTierMonthlyTokens } from '../lib/token-economy';

const PERIOD = '2026-08-01T00:00:00.000Z';

function freshState(overrides?: Partial<State>): State {
  return {
    profile: { token_balance: 0, token_quota_period_end: null },
    grants: new Set<string>(),
    ledger: [],
    claimInserts: 0,
    ...overrides,
  };
}

describe('grantTierMonthlyTokens concurrency', () => {
  beforeEach(() => {
    h.ref.state = freshState();
  });

  it('credits exactly once when two deliveries race the same new period', async () => {
    const s = h.ref.state as State;

    const [a, b] = await Promise.all([
      grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD }),
      grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD }),
    ]);

    // Exactly one delivery granted; the other is an idempotent no-op.
    const granted = [a, b].filter((r) => r.granted);
    expect(granted).toHaveLength(1);

    // Both claim inserts were attempted (the race really happened)...
    expect(s.claimInserts).toBe(2);
    // ...but only ONE ledger row and ONE credit landed. 500K = MONTHLY_TOKEN_GRANT['pro'].
    expect(s.ledger).toHaveLength(1);
    expect(s.profile.token_balance).toBe(500_000);
    expect(s.grants.size).toBe(1);
  });

  it('sequential re-delivery of the same period is a no-op', async () => {
    const first = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const second = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(s.ledger).toHaveLength(1);
    expect(s.profile.token_balance).toBe(500_000);
  });

  it('legacy fast-path: already-granted period skips WITHOUT a claim insert', async () => {
    // Models a subscriber granted for the current period BEFORE the claim table
    // existed: profile stamped, but no claim row. Must not re-grant.
    h.ref.state = freshState({
      profile: { token_balance: 500_000, token_quota_period_end: PERIOD },
    });
    const res = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(res.granted).toBe(false);
    expect(res.balance).toBe(500_000);
    expect(s.claimInserts).toBe(0); // never touched the claim table
    expect(s.ledger).toHaveLength(0);
  });

  it('rolls over prior balance under the 2x cap on a genuinely new period', async () => {
    h.ref.state = freshState({
      profile: { token_balance: 400_000, token_quota_period_end: '2026-07-01T00:00:00.000Z' },
    });
    const res = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    // grant 500K + carryOver min(400K, cap(1M)-500K=500K)=400K -> 900K, under 2x cap.
    expect(res.granted).toBe(true);
    expect(s.profile.token_balance).toBe(900_000);
  });
});
