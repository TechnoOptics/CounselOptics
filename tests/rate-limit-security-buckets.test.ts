import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two security buckets that were calling the shared limiter without
 * asking it to fail closed, and the account-existence leak on the same
 * two paths.
 *
 * lib/rate-limit.ts was already correct: a bucket that passes
 * `failClosed: true` denies when the store errors, and one that does not
 * allows. The defect was that only six call sites asked, and neither the
 * sign-in code path nor the public join form was one of them.
 *
 * These tests do NOT mock checkRateLimit. They drive the real limiter through
 * a real store failure by making the admin client's `rpc` return an error,
 * which is the only way to prove the CALL SITE passes the flag rather than
 * proving a fake returns what the fake was told to return.
 *
 * The neighbouring-gate trap is handled by making every other gate pass:
 * the firm resolves, the admin client is present, generateLink succeeds and
 * the send succeeds. So if the limiter admitted the caller, the action would
 * run to a visibly successful outcome, and each test asserts the exact refusal
 * rather than merely "not ok".
 */

const store = vi.hoisted(() => ({
  // 'error' makes check_rate_limit fail the way an unreachable store does.
  // 'allow' lets every request through so the non-limiter behaviour is
  // observable on its own.
  mode: 'allow' as 'allow' | 'error',
  employees: new Set<string>(),
  sent: [] as Array<{ to: string; subject: string }>,
  reset() {
    this.mode = 'allow';
    this.employees = new Set<string>();
    this.sent = [];
  },
}));

function adminStub() {
  // Captures the value passed to .ilike('email', <value>) so firm_employees
  // can answer "is this address already a member" per address, which is the
  // whole point of the enumeration assertions below.
  function table(name: string) {
    let matched = '';
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      not: () => chain,
      order: () => chain,
      insert: async () => ({ error: null }),
      update: () => chain,
      ilike: (_col: string, value: string) => {
        matched = value;
        return chain;
      },
      maybeSingle: async () => {
        if (name === 'firm_employees' && store.employees.has(matched)) {
          return { data: { id: 'emp-1', deactivated_at: null } };
        }
        return { data: null };
      },
      limit: async () => ({ data: [] }),
    };
    return chain;
  }

  return {
    rpc: async () =>
      store.mode === 'error'
        ? { data: null, error: { message: 'rate limit store is unreachable' } }
        : { data: true, error: null },
    from: (name: string) => table(name),
    auth: {
      admin: {
        generateLink: async () => ({
          data: { properties: { email_otp: '12345678' } },
          error: null,
        }),
        getUserById: async () => ({ data: { user: { email: 'admin@firm.test' } } }),
      },
    },
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => adminStub(),
  isServiceRoleConfigured: () => true,
}));

vi.mock('@/lib/supabase/server', () => ({
  requireUser: async () => ({ id: 'user-1' }),
  getCurrentUser: async () => ({ id: 'user-1' }),
  createServerSupabase: () => adminStub(),
}));

vi.mock('@/lib/firm-authz', () => ({
  requireActiveFirm: async () => ({ id: 'firm-1' }),
}));

vi.mock('@/lib/firm-storage', () => ({
  getFirmBySlug: async () => ({
    id: 'firm-1',
    name: 'Anderson Foundation',
    // Drives classifyEmail: an @anderson.test address is internal and would
    // have been provisioned outright, anything else is external and queued.
    metadata: { internalDomains: ['anderson.test'] },
  }),
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: async () => undefined,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: async (input: { to: string; subject: string }) => {
    store.sent.push({ to: input.to, subject: input.subject });
    return { ok: true as const, id: 'msg-1' };
  },
  buildSignInCodeEmailHtml: () => '<p>code</p>',
}));

vi.mock('next/headers', () => ({
  headers: () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

const { requestSignInCode } = await import('@/lib/auth-actions');
const { requestWorkspaceAccessAction } = await import('@/lib/access-actions');

function joinForm(email: string, fullName = 'Jordan Rivera') {
  const fd = new FormData();
  fd.set('fullName', fullName);
  fd.set('email', email);
  fd.set('firmSlug', 'anderson');
  return fd;
}

beforeEach(() => {
  store.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sign-in code path fails closed when the limiter store is down', () => {
  it('refuses rather than minting a code', async () => {
    store.mode = 'error';
    const res = await requestSignInCode('someone@example.test');
    expect(res).toEqual({
      ok: false,
      error: 'Too many code requests. Wait a minute, then try again.',
    });
    // The refusal has to be the limiter's, not a send that quietly failed.
    expect(store.sent).toHaveLength(0);
  });

  it('still mints a code when the store is healthy, so the guard is not just refusing everything', async () => {
    const res = await requestSignInCode('someone@example.test');
    expect(res).toEqual({ ok: true, delivered: true });
    expect(store.sent).toHaveLength(1);
  });
});

describe('the public join form fails closed when the limiter store is down', () => {
  it('refuses rather than filing the request', async () => {
    store.mode = 'error';
    const res = await requestWorkspaceAccessAction(joinForm('someone@example.test'));
    expect(res).toEqual({
      ok: false,
      error: 'Too many requests right now. Please try again in a few minutes.',
    });
    expect(store.sent).toHaveLength(0);
  });

  it('still files the request when the store is healthy', async () => {
    const res = await requestWorkspaceAccessAction(joinForm('someone@example.test'));
    expect(res.ok).toBe(true);
    expect(store.sent.length).toBeGreaterThan(0);
  });
});

describe('the join form answers the same whether or not the address is already a member', () => {
  /**
   * The three outcomes that used to be distinguishable from the response:
   * an address already provisioned, an address on an internal domain that
   * gets provisioned now, and an external address that gets queued. Anybody
   * could tell them apart, so anybody could ask "does this person work here".
   */
  async function ask(email: string) {
    return requestWorkspaceAccessAction(joinForm(email));
  }

  it('gives a known member and an unknown address byte-for-byte the same answer', async () => {
    store.employees.add('already@anderson.test');

    const known = await ask('already@anderson.test');
    const unknown = await ask('nobody@example.test');

    expect(known).toEqual(unknown);
    expect(known).toEqual({
      ok: true,
      message:
        'Thanks. If this address can join Anderson Foundation, we have just emailed it with what happens next. Check your inbox, and your spam folder if it is not there.',
    });
  });

  it('gives an internal and an external address the same answer too', async () => {
    const internal = await ask('newhire@anderson.test');
    const external = await ask('outsider@example.test');
    expect(internal).toEqual(external);
  });

  it('carries no field that could stand in for the answer', async () => {
    store.employees.add('already@anderson.test');
    const known = await ask('already@anderson.test');
    expect(Object.keys(known).sort()).toEqual(['message', 'ok']);
    expect(known).not.toHaveProperty('kind');
  });

  it('still tells the address itself which case it was, on the private channel', async () => {
    store.employees.add('already@anderson.test');
    await ask('already@anderson.test');
    expect(store.sent).toEqual([
      { to: 'already@anderson.test', subject: 'You already have access to Anderson Foundation' },
    ]);

    store.sent = [];
    await ask('outsider@example.test');
    expect(store.sent.at(-1)).toEqual({
      to: 'outsider@example.test',
      subject: 'Your request to join Anderson Foundation',
    });
  });
});
