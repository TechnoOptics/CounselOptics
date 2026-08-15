import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A firm-bound API token is only good while its holder is still in that firm.
 *
 * Everything downstream of verifyApiToken is scoped by the token row's
 * `firm_id` and nothing else: /api/v1/documents, /api/v1/cases and
 * /api/v1/signing-requests all read through the SERVICE-ROLE client, which
 * answers to no RLS, filtered by `.eq('firm_id', verified.firmId)`. So the row
 * IS the authorization, and until this check existed the row was simply
 * believed.
 *
 * WHAT MADE THAT URGENT. public.api_tokens carried an RLS policy,
 * api_tokens_owner_write, that was `for all to authenticated` with the check
 * `user_id = auth.uid() OR <owner/admin of firm_id>`. `authenticated` also
 * held INSERT on the table. The OR is the defect: naming yourself in user_id
 * satisfies the check on its own and leaves firm_id and scopes unconstrained,
 * and there is no CHECK constraint on scopes and no trigger. So any signed-in
 * person could insert a row naming ANY firm with scopes ['admin'], then
 * present the plaintext whose sha256 they had just stored, and read that
 * firm's documents. The policy was dropped from production on 2026-08-15.
 *
 * These tests exist because dropping a policy is not a fix that a test can
 * hold: RLS lives in the database, and a `create policy` somebody runs next
 * month would reopen it with nothing going red. The membership re-check is the
 * half that lives in this repository, and this is what holds it.
 *
 * It closes an ordinary case too, one the policy had nothing to do with:
 * somebody who leaves a firm keeps every token they minted while a member. The
 * credential outlived the membership.
 *
 * Mutations that turn these red:
 *   - delete the `if (row.firm_id)` block from verifyApiToken: "refuses a
 *     firm-bound token whose holder is not a member" and "refuses a forged
 *     row" both go red.
 *   - drop the `if (!row.user_id) return null` line: NOTHING goes red, and
 *     that was checked rather than assumed. The lookup that follows would run
 *     `.eq('user_id', null)`, and `user_id = NULL` is never true in SQL, so a
 *     row with no holder is refused either way. The line stays because it says
 *     what it means instead of leaning on that, but it is belt to the lookup's
 *     braces and this file does not pretend otherwise.
 *   - make the membership query ignore firm_id (`.eq('firm_id', ...)`
 *     removed): "a membership in a DIFFERENT firm does not count" goes red.
 */

const h = vi.hoisted(() => {
  const ref: {
    tokenRow: Record<string, unknown> | null;
    memberships: Array<{ firm_id: string; user_id: string }>;
    memberQueries: Array<Record<string, string>>;
  } = { tokenRow: null, memberships: [], memberQueries: [] };

  function makeAdmin() {
    return {
      from(table: string) {
        if (table === 'firm_members') {
          const match: Record<string, string> = {};
          const builder = {
            select: () => builder,
            eq: (col: string, val: string) => {
              match[col] = val;
              return builder;
            },
            maybeSingle: async () => {
              ref.memberQueries.push({ ...match });
              const hit = ref.memberships.find(
                (m) =>
                  (match.firm_id === undefined || m.firm_id === match.firm_id) &&
                  (match.user_id === undefined || m.user_id === match.user_id),
              );
              return { data: hit ?? null, error: null };
            },
          };
          return builder;
        }
        // api_tokens
        const builder = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          maybeSingle: async () => ({ data: ref.tokenRow, error: null }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
        return builder;
      },
    };
  }

  return { ref, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

const FIRM = '11111111-1111-1111-1111-111111111111';
const OTHER_FIRM = '22222222-2222-2222-2222-222222222222';
const HOLDER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** A row as the real table would hold it. The hash is never checked here. */
function tokenRow(over: Record<string, unknown> = {}) {
  return {
    id: 'tok_1',
    firm_id: FIRM,
    user_id: HOLDER,
    scopes: ['read'],
    expires_at: null,
    revoked_at: null,
    ...over,
  };
}

describe('a firm-bound token is checked against the firm it names', () => {
  beforeEach(() => {
    h.ref.tokenRow = null;
    h.ref.memberships = [];
    h.ref.memberQueries = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function verify() {
    const { verifyApiToken } = await import('../lib/api-tokens');
    return verifyApiToken('Bearer adv_anything-at-all');
  }

  it('accepts a firm-bound token whose holder is still a member', async () => {
    h.ref.tokenRow = tokenRow();
    h.ref.memberships = [{ firm_id: FIRM, user_id: HOLDER }];
    const v = await verify();
    expect(v).not.toBeNull();
    expect(v?.firmId).toBe(FIRM);
  });

  it('refuses a firm-bound token whose holder is not a member', async () => {
    // The person left the firm, or was removed. The credential must not
    // outlive the membership.
    h.ref.tokenRow = tokenRow();
    h.ref.memberships = [];
    expect(await verify()).toBeNull();
  });

  it('refuses a forged row naming a firm the holder never joined', async () => {
    // The escalation in one line: a row the attacker wrote, pointing at
    // somebody else's firm, with the scopes they chose.
    h.ref.tokenRow = tokenRow({ firm_id: OTHER_FIRM, scopes: ['admin'] });
    h.ref.memberships = [{ firm_id: FIRM, user_id: HOLDER }];
    expect(await verify()).toBeNull();
  });

  it('a membership in a DIFFERENT firm does not count', async () => {
    // Guards the shape where the lookup forgets to constrain firm_id and any
    // membership anywhere satisfies it.
    h.ref.tokenRow = tokenRow({ firm_id: OTHER_FIRM });
    h.ref.memberships = [{ firm_id: FIRM, user_id: HOLDER }];
    expect(await verify()).toBeNull();
    const q = h.ref.memberQueries.at(-1);
    expect(q?.firm_id).toBe(OTHER_FIRM);
    expect(q?.user_id).toBe(HOLDER);
  });

  it('refuses a firm-bound token with no holder at all', async () => {
    // A forged row need not name a user. Refused by the explicit guard and,
    // failing that, by the lookup, since `user_id = NULL` matches nothing.
    h.ref.tokenRow = tokenRow({ user_id: null });
    h.ref.memberships = [];
    expect(await verify()).toBeNull();
  });

  it('leaves a personal token alone, since it grants no firm scope', async () => {
    // firm_id null means the token reaches only the endpoints that do not
    // require one; the firm endpoints refuse it themselves with a 403.
    h.ref.tokenRow = tokenRow({ firm_id: null });
    h.ref.memberships = [];
    const v = await verify();
    expect(v).not.toBeNull();
    expect(v?.firmId).toBeNull();
    expect(h.ref.memberQueries).toHaveLength(0);
  });

  it('still refuses an expired token before any of this', async () => {
    h.ref.tokenRow = tokenRow({ expires_at: '2020-01-01T00:00:00.000Z' });
    h.ref.memberships = [{ firm_id: FIRM, user_id: HOLDER }];
    expect(await verify()).toBeNull();
  });
});
