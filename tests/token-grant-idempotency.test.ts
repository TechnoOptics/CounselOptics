import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  /** null models "no profiles row with that id", i.e. an UPDATE that matches nothing. */
  profile: { token_balance: number; token_quota_period_end: string | null } | null;
  /**
   * Set to model an UPDATE that PostgREST answers with an error. `applied`
   * distinguishes a statement the database rejected (false) from one that ran
   * and whose response was lost (true) - the case the caller cannot tell apart
   * and must not double-credit on.
   */
  profileWriteError: { message: string; applied: boolean } | null;
  grants: Set<string>; // enforces UNIQUE(user_id, period_end)
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
                    if (table === 'profiles') {
                      return { data: s.profile ? { ...s.profile } : null };
                    }
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
          // update().eq().select('id') mirrors PostgREST's own answers: a
          // matched row comes back in `data`, a statement that matched nothing
          // comes back as an EMPTY ARRAY with no error, and a rejected
          // statement comes back as `{ error }` without throwing.
          update(patch: Record<string, unknown>) {
            return {
              eq: () => ({
                select: async () => {
                  const s = getState();
                  if (table !== 'profiles') return { data: [{ id: 'x' }], error: null };
                  if (s.profileWriteError) {
                    if (s.profileWriteError.applied && s.profile) {
                      s.profile = { ...s.profile, ...patch } as NonNullable<State['profile']>;
                    }
                    return {
                      data: null,
                      error: { message: s.profileWriteError.message },
                    };
                  }
                  if (!s.profile) return { data: [], error: null };
                  s.profile = { ...s.profile, ...patch } as NonNullable<State['profile']>;
                  return { data: [{ id: 'u1' }], error: null };
                },
              }),
            };
          },
          delete() {
            return {
              match: async (m: Record<string, string>) => {
                const s = getState();
                if (table === 'token_monthly_grants') {
                  s.claimDeletes.push(m);
                  s.grants.delete(`${m.user_id}|${m.period_end}`);
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
    profileWriteError: null,
    grants: new Set<string>(),
    ledger: [],
    claimInserts: 0,
    claimDeletes: [],
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
    expect(s.profile?.token_balance).toBe(500_000);
    expect(s.grants.size).toBe(1);
  });

  it('sequential re-delivery of the same period is a no-op', async () => {
    const first = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const second = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(s.ledger).toHaveLength(1);
    expect(s.profile?.token_balance).toBe(500_000);
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
    expect(s.profile?.token_balance).toBe(900_000);
  });
});

/**
 * The claim above stops a double grant. It also, before this guard, made a
 * DROPPED grant permanent: the credit write's result was never read, so a write
 * that matched no row looked identical to a successful one, the claim row
 * survived, and every later delivery of the same period took the 23505 branch
 * and returned without crediting. The customer had paid, the receipt said
 * granted, and no tokens existed - while a token_ledger row asserted a
 * balance_after nobody held.
 */
describe('grantTierMonthlyTokens dropped-credit recovery', () => {
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

  it('surfaces a credit that matched no row instead of reporting a grant', async () => {
    h.ref.state = freshState({ profile: null }); // no profiles row for this id
    const res = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(res.granted).toBe(false);
    // Requirement: no ledger row may assert a balance that was never written.
    expect(s.ledger).toHaveLength(0);
    expect(errors.some((e) => e.includes('did not land'))).toBe(true);
  });

  it('releases the claim so the SAME period can be granted on a later delivery', async () => {
    h.ref.state = freshState({ profile: null });
    const first = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    expect(first.granted).toBe(false);

    const s = h.ref.state as State;
    expect(s.claimDeletes).toHaveLength(1);
    expect(s.grants.size).toBe(0); // claim gone: the period is claimable again

    // The underlying cause is fixed (the profile row now exists) and the same
    // period is delivered again. Without the release this second call 23505s on
    // the surviving claim and returns ok-but-uncredited forever.
    s.profile = { token_balance: 0, token_quota_period_end: null };
    const second = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });

    expect(second.granted).toBe(true);
    expect(second.balance).toBe(500_000);
    expect(s.profile?.token_balance).toBe(500_000);
    expect(s.ledger).toHaveLength(1); // exactly one, for the credit that landed
  });

  it('does not double-credit when the write landed and only the response was lost', async () => {
    // The ambiguous case: releasing the claim is safe ONLY because the same
    // UPDATE stamps token_quota_period_end and the fast path short-circuits on
    // it. This is the test that would catch losing that property.
    h.ref.state = freshState({
      profileWriteError: { message: 'connection reset', applied: true },
    });
    const first = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });
    const s = h.ref.state as State;

    expect(first.granted).toBe(false);
    expect(s.ledger).toHaveLength(0); // unconfirmed: nothing asserted
    expect(s.profile?.token_balance).toBe(500_000); // the write did land
    expect(s.grants.size).toBe(0); // claim released

    s.profileWriteError = null;
    const second = await grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD });

    expect(second.granted).toBe(false); // stopped by the period stamp
    expect(s.profile?.token_balance).toBe(500_000); // still one grant, not two
    expect(s.ledger).toHaveLength(0);
    expect(s.claimInserts).toBe(1); // never even reached the claim table again
  });

  it('drops the credit for exactly one racer, and the loser stays a no-op', async () => {
    // Both deliveries race a NEW period against a user whose profile row is
    // missing. One wins the claim and finds nothing to credit; the other loses
    // with 23505. Neither may write a ledger row, and the period must be left
    // claimable.
    h.ref.state = freshState({ profile: null });
    const [a, b] = await Promise.all([
      grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD }),
      grantTierMonthlyTokens({ userId: 'u1', tier: 'pro', periodEnd: PERIOD }),
    ]);
    const s = h.ref.state as State;

    expect(a.granted).toBe(false);
    expect(b.granted).toBe(false);
    expect(s.claimInserts).toBe(2); // the race really happened
    expect(s.ledger).toHaveLength(0);
    expect(s.grants.size).toBe(0);
  });
});
