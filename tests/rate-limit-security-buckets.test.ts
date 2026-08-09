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
  // The two ways delivery can be unavailable: no credential at all, and a
  // credential that fails on the wire.
  emailConfigured: true,
  sendFails: false,
  // Makes the firm_signup_requests insert fail, which is the branch that used
  // to report a queued request that was never queued.
  insertFails: false,
  // Every row this action writes, so "refused before writing anything" is an
  // assertion rather than a hope.
  inserts: [] as string[],
  reset() {
    this.mode = 'allow';
    this.employees = new Set<string>();
    this.sent = [];
    this.emailConfigured = true;
    this.sendFails = false;
    this.insertFails = false;
    this.inserts = [];
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
      insert: async () => {
        // postgrest-js resolves with { error } rather than throwing, so this
        // is what a failed write actually looks like to the caller.
        if (store.insertFails && name === 'firm_signup_requests') {
          return { error: { message: 'duplicate key value violates unique constraint' } };
        }
        store.inserts.push(name);
        return { error: null };
      },
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
  isEmailConfigured: () => store.emailConfigured,
  sendEmail: async (input: { to: string; subject: string }) => {
    // Mirrors the real sendEmail, which reports a missing key as ok:false
    // rather than throwing.
    if (!store.emailConfigured) {
      return { ok: false as const, error: 'RESEND_API_KEY not configured.' };
    }
    if (store.sendFails) return { ok: false as const, error: 'Resend HTTP 500' };
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

  /** Blank out the caller's own address so two different callers compare. */
  function anonymise(
    res: Awaited<ReturnType<typeof ask>>,
    address: string,
  ): unknown {
    return res.ok
      ? { ok: res.ok, message: res.message.split(address).join('<address>') }
      : res;
  }

  // The message echoes the address the caller typed, so the property is not
  // "two different addresses get the same string". It is "ONE address gets the
  // same answer whether or not it has an account", which is the thing an
  // enumerator is actually trying to tell apart. Holding the address constant
  // and toggling only the account state tests exactly that.
  it('answers the same for one address whether or not it is already a member', async () => {
    const address = 'maybe@anderson.test';

    const unknown = await ask(address);

    store.reset();
    store.employees.add(address);
    const known = await ask(address);

    expect(known).toEqual(unknown);
    expect(known).toEqual({
      ok: true,
      message:
        'Thanks. We have emailed maybe@anderson.test with what happens next. Check your inbox, and your spam folder if it is not there.',
    });
  });

  it('gives an internal and an external address the same answer apart from their own address', async () => {
    const internal = await ask('newhire@anderson.test');
    const external = await ask('outsider@example.test');
    // Whether the firm treats the domain as internal decides whether the person
    // is provisioned outright or queued for approval, and that must not show.
    expect(anonymise(internal, 'newhire@anderson.test')).toEqual(
      anonymise(external, 'outsider@example.test'),
    );
  });

  it('carries no field that could stand in for the answer', async () => {
    store.employees.add('already@anderson.test');
    const known = await ask('already@anderson.test');
    expect(Object.keys(known).sort()).toEqual(['message', 'ok']);
    expect(known).not.toHaveProperty('kind');
  });

  it('is still a uniform answer when the outcome could not be delivered', async () => {
    // The uniformity property has to survive the failure path too, or the
    // refusal becomes the oracle the success message no longer is.
    const address = 'maybe@anderson.test';

    store.sendFails = true;
    const unknown = await ask(address);

    store.reset();
    store.sendFails = true;
    store.employees.add(address);
    const known = await ask(address);

    expect(known).toEqual(unknown);
    expect(known.ok).toBe(false);
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

describe('the join form never says an email was sent when none was', () => {
  /**
   * A separate property from the uniformity above, and a separate bug. The
   * uniform message states flatly that an email went out, so it may only be
   * returned when one actually did. Otherwise this is the same shape as a
   * "Revoked" badge with no revoke behind it: copy written for the happy path
   * that lies when the mechanism is missing, on a screen where the person is
   * already locked out and has nowhere else to go.
   */
  const COULD_NOT_FINISH =
    'We could not finish that just now. Please try again in a few minutes, or contact your legal team directly.';

  it('refuses, and writes nothing, when there is no credential to send with', async () => {
    store.emailConfigured = false;
    const res = await requestWorkspaceAccessAction(joinForm('newhire@anderson.test'));

    expect(res).toEqual({ ok: false, error: COULD_NOT_FINISH });
    // Fails closed BEFORE the work: no employee provisioned, no request queued,
    // so nobody is left half-created with no way to be told about it.
    expect(store.inserts).toEqual([]);
    expect(store.sent).toEqual([]);
  });

  it('refuses when the send itself fails, rather than claiming delivery', async () => {
    store.sendFails = true;
    const res = await requestWorkspaceAccessAction(joinForm('outsider@example.test'));

    expect(res).toEqual({ ok: false, error: COULD_NOT_FINISH });
    expect(store.sent).toEqual([]);
  });

  it('does not report a queued request when the write failed', async () => {
    // The other hollow-success path: the insert fails, so no row exists and no
    // email goes out, and this used to answer with the success sentence anyway.
    store.insertFails = true;
    const res = await requestWorkspaceAccessAction(joinForm('outsider@example.test'));

    expect(res).toEqual({ ok: false, error: COULD_NOT_FINISH });
    expect(store.sent).toEqual([]);
  });

  it('never returns a message asserting an email exists unless one was sent', async () => {
    // The claim and the send have to move together in every mode, which is the
    // invariant the old code broke. Checked against the string itself so a
    // future edit that reintroduces a happy-path claim is caught here.
    for (const mode of ['configured', 'unconfigured', 'send-fails'] as const) {
      store.reset();
      if (mode === 'unconfigured') store.emailConfigured = false;
      if (mode === 'send-fails') store.sendFails = true;

      const res = await requestWorkspaceAccessAction(joinForm('someone@example.test'));
      const shown = res.ok ? res.message : res.error;

      expect(shown.includes('emailed')).toBe(store.sent.length > 0);
    }
  });

  it('leaves the operator a log line rather than failing quietly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.emailConfigured = false;
    await requestWorkspaceAccessAction(joinForm('newhire@anderson.test'));
    expect(errors).toHaveBeenCalledWith(
      '[access-request] refused: RESEND_API_KEY is not configured, so no outcome could be delivered',
    );
    errors.mockRestore();
  });
});
