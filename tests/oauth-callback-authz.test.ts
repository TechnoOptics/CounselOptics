import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/integrations/{provider}/callback, the request that stores a
 * firm's mailbox and calendar credentials.
 *
 * The write at the end of that route is a service-role upsert into
 * firm_integrations keyed on a firm id, so whatever decides that id is the
 * only authorization there is. It used to be decided by the `state`
 * parameter, which is the caller's own material: it leaves on a URL, goes
 * through the provider, and comes back on a URL. The nonce cookie beside it
 * proves the browser started SOME flow, and the person who started it reads
 * their own nonce off their own consent URL, so a self-serve signup could
 * present their own cookie next to a state naming a victim firm and
 * overwrite that firm's connection with their own tokens.
 *
 * These tests drive the real route. The REAL lib/firm-authz.ts runs, over a
 * firm_members table, so what is being exercised is the decision the product
 * actually makes rather than a mock of it. What is faked is the two Supabase
 * clients, the session, and the provider's HTTP endpoints.
 *
 * Every refusal asserts that NOTHING was written, not merely that the user
 * saw an error page. A route that refuses after the upsert has already
 * refused nothing.
 */

const db = vi.hoisted(() => ({
  /** The signed-in session at the callback, as lib/supabase/server reports it. */
  user: { id: 'user-owner', email: 'owner@hale.test' } as {
    id: string;
    email: string;
  } | null,
  members: [] as Array<{ firm_id: string; user_id: string; role: string }>,
  /** Every upsert firm_integrations was actually asked to run. */
  upserts: [] as Array<Record<string, unknown>>,
  reset() {
    this.user = { id: 'user-owner', email: 'owner@hale.test' };
    this.members = [
      { firm_id: 'firm-hale', user_id: 'user-owner', role: 'owner' },
      { firm_id: 'firm-hale', user_id: 'user-para', role: 'paralegal' },
      // The attacker: a real account, with a real firm of their own.
      { firm_id: 'firm-attacker', user_id: 'user-attacker', role: 'owner' },
    ];
    this.upserts = [];
  },
}));

/** The state cookie this browser is carrying, by cookie name. */
const jar = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      name in jar.value ? { name, value: jar.value[name] } : undefined,
    set: () => {},
  }),
}));

class Query {
  private rows: Array<Record<string, unknown>>;
  constructor(private table: string) {
    this.rows = table === 'firm_members' ? [...db.members] : [];
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  upsert(payload: Record<string, unknown>) {
    if (this.table === 'firm_integrations') db.upserts.push(payload);
    return Promise.resolve({ data: null, error: null });
  }
}

const client = { from: (table: string) => new Query(table) };

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => db.user,
  createServerSupabase: () => client,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => client,
}));
vi.mock('@/lib/integration-tokens', () => ({
  encryptTokenForDb: (v: string) => `enc(${v})`,
}));

process.env.MICROSOFT_CLIENT_ID = '11111111-2222-3333-4444-555555555555';
process.env.MICROSOFT_CLIENT_SECRET = 'a-secret-long-enough-to-be-real';

const { GET } = await import('@/app/api/integrations/[provider]/callback/route');

const ctx = { params: { provider: 'microsoft' } };

/** The provider's token + profile endpoints, always cooperative. */
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes('/token')) {
    return new Response(
      JSON.stringify({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'Calendars.ReadWrite',
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ mail: 'owner@hale.test' }), {
    headers: { 'content-type': 'application/json' },
  });
});

function state(over: Partial<Record<string, string>> = {}) {
  const payload = {
    nonce: 'nonce-abc',
    firmId: 'firm-hale',
    userId: 'user-owner',
    origin: 'https://advottic.com',
    ...over,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function callback(stateB64: string) {
  const url = `https://advottic.com/api/integrations/microsoft/callback?code=authcode&state=${stateB64}`;
  return GET(new Request(url) as never, ctx);
}

/** The message the route sent the caller back to the calendar with. */
function refusal(res: Response): string {
  const dest = new URL(res.headers.get('location') ?? '', 'https://advottic.com');
  return dest.searchParams.get('integration_error') ?? '';
}

beforeEach(() => {
  db.reset();
  jar.value = { adv_oauth_microsoft: 'nonce-abc' };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('a state naming a firm the caller has nothing to do with', () => {
  it('stores nothing for the victim firm', async () => {
    // The whole attack, in one request. The attacker holds their OWN
    // cookie and their own nonce, because they started their own flow and
    // read it off their own consent URL. The only forged field is the
    // firm.
    db.user = { id: 'user-attacker', email: 'mal@elsewhere.test' };
    const res = await callback(
      state({ firmId: 'firm-hale', userId: 'user-attacker' }),
    );
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('owner or admin');
    // Refused before the code was ever exchanged, so the provider was
    // never asked for tokens on the victim's behalf either.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a member of the firm whose role does not own its connections', async () => {
    // Membership is not entitlement. firm_integrations is owner/admin for
    // writes at the database, and the code gate says the same thing.
    db.user = { id: 'user-para', email: 'para@hale.test' };
    const res = await callback(state({ userId: 'user-para' }));
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('owner or admin');
  });
});

describe('a state whose userId is not the caller', () => {
  it('refuses, so a forwarded consent cannot finish as somebody else', async () => {
    // The attacker is an owner of their own firm, so the firm check alone
    // would pass for firm-attacker. What fails here is that the flow was
    // started by a different person than the one completing it.
    db.user = { id: 'user-attacker', email: 'mal@elsewhere.test' };
    const res = await callback(
      state({ firmId: 'firm-attacker', userId: 'user-owner' }),
    );
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('different account');
  });
});

describe('a callback with no session at all', () => {
  it('refuses rather than trusting the identity written in the state', async () => {
    db.user = null;
    const res = await callback(state());
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('Sign in');
  });
});

describe('a replayed or expired state', () => {
  it('is refused once the nonce cookie is gone', async () => {
    // What expiry looks like from here: the 30-minute cookie is the
    // state's only lifetime, and a spent or lapsed one leaves nothing to
    // compare against.
    jar.value = {};
    const res = await callback(state());
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('state mismatch');
  });

  it('is refused once a newer flow has rotated the nonce', async () => {
    jar.value = { adv_oauth_microsoft: 'nonce-newer' };
    const res = await callback(state());
    expect(db.upserts).toEqual([]);
    expect(refusal(res)).toContain('state mismatch');
  });
});

describe('the owner who actually started the flow', () => {
  it('connects, and the row is written for their own firm', async () => {
    const res = await callback(state());
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]).toMatchObject({
      firm_id: 'firm-hale',
      provider: 'microsoft',
      connected_by: 'user-owner',
      access_token_encrypted: 'enc(at)',
      revoked_at: null,
    });
    expect(res.headers.get('location')).toContain('connected=microsoft');
  });

  it('spends the nonce on the response it returns', async () => {
    // Single use is what ends the replay window at the first successful
    // connection rather than at the cookie's own lifetime, so the expiry
    // has to ride on THIS redirect.
    const res = await callback(state());
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('adv_oauth_microsoft=');
    expect(setCookie).toMatch(/Max-Age=0/i);
  });

  it('attributes the connection to the session, not to the state', async () => {
    // connected_by is read by the firm as "who did this". It must not be
    // a field the caller wrote.
    await callback(state({ userId: 'user-owner' }));
    expect(db.upserts[0].connected_by).toBe('user-owner');
  });
});
