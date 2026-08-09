import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who may read and rotate a firm's partner webhook secret.
 *
 * `webhookSecret` is a credential, not a setting. It is the HMAC-SHA256 key
 * the firm's partner backend uses to prove an inbound event really came from
 * Advottic, so holding it is enough to forge status changes and legal replies
 * into that firm's partner app, and rotating it breaks the live integration
 * for everyone at the firm until the new value is pasted in by hand.
 *
 * Both exports are `'use server'` and therefore public HTTP endpoints called
 * with a caller-supplied firmId. They gated on a membership lookup made
 * through the SERVICE-ROLE client, which bypasses RLS: a membership question
 * answered by the service role is a hand-rolled authorization axis with no
 * policy behind it. The gate is now lib/firm-authz.ts, which reads
 * firm_members with the user-scoped client, at FIRM_ADMIN_ROLES.
 *
 * These tests drive the real actions against a fake Supabase client and a
 * fake firm-authz. They assert on the role set and on what the fakes were
 * asked to do, not on source text, so no comment or constant satisfies them.
 * The service-role client is held wide OPEN throughout: it answers every read
 * with a real firm row and every write with success, so the ONLY thing that
 * can refuse is the gate under test.
 *
 * Mutations that turn them red, each applied and observed:
 *   - drop the callerIsFirmAdmin check from getPartnerConfigAction: "refuses
 *     a caller who is not an owner or admin" and "a refused caller never
 *     reaches the firm row" go red.
 *   - drop it from savePartnerConfigAction: the three save refusal tests go
 *     red.
 *   - widen the gate by calling callerIsFirmMember instead: the attorney and
 *     paralegal cases go red.
 *   - drop `.select('id')` from the firms update: 2 red. The fake resolves
 *     the awaited builder with `data: null`, the old shape, so the zero-row
 *     guard fires on every save and both SAVE HAPPY PATHS go red. It is those,
 *     not the zero-row test, that catch this one, which is why both kinds are
 *     here.
 *   - drop the empty-result check after the update: 1 red, "a save that
 *     stored nothing is reported as a failure".
 */

const FIRM = 'firm-1';

const h = vi.hoisted(() => {
  const s = {
    /** What lib/firm-authz would answer for this caller. */
    isFirmAdmin: true,
    isFirmMember: true,
    /** Rows the fake reports the metadata update as having written. */
    updated: [{ id: 'firm-1' }] as Array<{ id: string }>,
  };
  const calls: string[] = [];

  function makeAdmin() {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push(`read:${table}`);
              return {
                data: {
                  metadata: {
                    partnerIntegration: {
                      ackMessage: 'Thanks, legal has your request.',
                      questions: [],
                      webhookUrl: 'https://partner.example.com/hook',
                      webhookSecret: 'whsec_existing_secret_value',
                      remindAfterHours: 24,
                    },
                  },
                },
                error: null,
              };
            },
          }),
        }),
        update: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              calls.push(`update:${table}`);
              return Promise.resolve({ data: s.updated, error: null });
            },
            // Awaiting the builder without selecting is the shape the
            // vulnerable version had: it resolves clean with nothing to
            // inspect. Kept so removing `.select('id')` fails an assertion
            // rather than the harness.
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`update:${table}`);
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  return { s, calls, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  requireUser: async () => ({ id: 'user-1' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
}));

vi.mock('../lib/firm-authz', () => ({
  callerIsFirmAdmin: async () => h.s.isFirmAdmin,
  // Held OPEN. Widening the gate to any member must be visible as a test
  // failure, not absorbed by a fake that refuses for the wrong reason.
  callerIsFirmMember: async () => h.s.isFirmMember,
  FIRM_ADMIN_ROLES: ['owner', 'admin'],
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { getPartnerConfigAction, savePartnerConfigAction } = await import(
  '../lib/partner-config'
);

function saveInput(rotateSecret = false) {
  return {
    ackMessage: 'Thanks, legal has your request.',
    questions: [],
    webhookUrl: 'https://partner.example.com/hook',
    remindAfterHours: 24,
    rotateSecret,
  };
}

/** Everything the fakes saw that touched the firms row. */
function dbCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('read:') || c.startsWith('update:'));
}

describe('getPartnerConfigAction', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.s.isFirmAdmin = true;
    h.s.isFirmMember = true;
    h.s.updated = [{ id: FIRM }];
  });

  it('refuses a caller who is not an owner or admin', async () => {
    // An attorney: a real member of the firm, holding no admin role.
    h.s.isFirmAdmin = false;
    h.s.isFirmMember = true;
    const res = await getPartnerConfigAction(FIRM);
    expect(res.ok).toBe(false);
    expect(res.config).toBeUndefined();
    expect(res.error).toMatch(/owners and admins/i);
  });

  it('a refused caller never reaches the firm row', async () => {
    h.s.isFirmAdmin = false;
    await getPartnerConfigAction(FIRM);
    // The secret is not read, so it cannot leak through a log or a partial
    // return on the way back out.
    expect(dbCalls()).toEqual([]);
  });

  it('still returns the config to an owner or admin', async () => {
    h.s.isFirmAdmin = true;
    const res = await getPartnerConfigAction(FIRM);
    expect(res.ok).toBe(true);
    expect(res.config?.webhookSecret).toBe('whsec_existing_secret_value');
    expect(dbCalls()).toContain('read:firms');
  });
});

describe('savePartnerConfigAction', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.s.isFirmAdmin = true;
    h.s.isFirmMember = true;
    h.s.updated = [{ id: FIRM }];
  });

  it('refuses a member who is not an owner or admin', async () => {
    h.s.isFirmAdmin = false;
    h.s.isFirmMember = true;
    const res = await savePartnerConfigAction(FIRM, saveInput());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owners and admins/i);
  });

  it('a refused caller cannot rotate the secret', async () => {
    // Rotation is destructive to a live integration even though it hands
    // nothing back, so it has to be refused before the write, not after.
    h.s.isFirmAdmin = false;
    const res = await savePartnerConfigAction(FIRM, saveInput(true));
    expect(res.ok).toBe(false);
    expect(res.config).toBeUndefined();
    expect(dbCalls()).toEqual([]);
  });

  it('a refused caller is told nothing about the current settings', async () => {
    h.s.isFirmAdmin = false;
    const res = await savePartnerConfigAction(FIRM, saveInput());
    expect(JSON.stringify(res)).not.toContain('whsec_');
  });

  it('still saves for an owner or admin, and preserves the secret', async () => {
    h.s.isFirmAdmin = true;
    const res = await savePartnerConfigAction(FIRM, saveInput());
    expect(res.ok).toBe(true);
    expect(res.config?.webhookSecret).toBe('whsec_existing_secret_value');
    expect(dbCalls()).toContain('update:firms');
  });

  it('rotates to a new minted secret when asked', async () => {
    h.s.isFirmAdmin = true;
    const res = await savePartnerConfigAction(FIRM, saveInput(true));
    expect(res.ok).toBe(true);
    expect(res.config?.webhookSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(res.config?.webhookSecret).not.toBe('whsec_existing_secret_value');
  });

  it('a save that stored nothing is reported as a failure', async () => {
    // PostgREST hands a zero-row update back as a success with a null error.
    // Returning ok here would show a rotated secret that is not stored.
    h.s.isFirmAdmin = true;
    h.s.updated = [];
    const res = await savePartnerConfigAction(FIRM, saveInput(true));
    expect(res.ok).toBe(false);
    expect(res.config).toBeUndefined();
    expect(res.error).toMatch(/could not be saved/i);
  });
});
