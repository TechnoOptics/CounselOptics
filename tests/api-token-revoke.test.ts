import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

/**
 * Revoking an issued API token.
 *
 * `public.api_tokens` was SELECT-and-INSERT only: the verify path in
 * lib/api-tokens.ts already refuses a row whose `revoked_at` is set, and the
 * list already rendered a "Revoked" badge, but nothing anywhere ever wrote
 * that column. A leaked firm token, which carries the write scope the partner
 * API accepts, could not be killed through the product at all.
 *
 * These tests drive the action itself over a fake PostgREST, because every
 * part of this is the kind of control that fails quietly:
 *
 *   - The action is an export of a 'use server' module, so it is a public
 *     HTTP endpoint. Hiding the button is not a gate; the first statements of
 *     the action are.
 *   - postgrest-js does not raise when zero rows match. An `.update().eq()`
 *     that hit nothing resolves with `error: null`, which is the exact shape
 *     that silently dropped a month of security-audit writes in this repo.
 *     So the fake below returns a representation ONLY when the request asked
 *     for one, which is what the real server does, and a caller that drops
 *     the `.select()` gets `data: null` and has to treat it as a failure.
 *   - Revocation is a state change, not a delete. The row has to survive.
 *
 * The database and the session are faked. The authorization axis
 * (lib/firm-authz.ts) is mocked because the point of asserting on it is that
 * this action asks THAT module, rather than growing a second membership check
 * of its own.
 */

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  user_id: string | null;
  firm_id: string | null;
  revoked_at: string | null;
};

type Filter = [kind: string, column: string, value: unknown];

type World = {
  tokens: TokenRow[];
  /** Every update PostgREST was actually asked to run. */
  updates: Array<{
    payload: Record<string, unknown>;
    filters: Filter[];
    /** True when the request asked for the affected rows back. */
    askedForRows: boolean;
  }>;
  /** Rows ever removed. Nothing here may ever delete one. */
  deletes: number;
};

let world: World;

const auth = vi.hoisted(() => ({
  user: { id: 'user-owner' } as { id: string } | null,
}));

/** What the user-scoped read behind the list hands back. */
const listed = vi.hoisted(() => ({
  tokens: [] as Array<Record<string, unknown>>,
}));

const callerIsFirmAdmin = vi.hoisted(() =>
  vi.fn(async (_firmId: string) => false),
);

const logSecurityEvent = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => {}),
);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: () => new Headers({ 'user-agent': 'vitest' }),
}));
vi.mock('@/lib/security-audit', () => ({ logSecurityEvent }));
vi.mock('@/lib/firm-authz', () => ({ callerIsFirmAdmin }));
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => auth.user,
  // Just enough of the two user-scoped reads the list makes: the tokens
  // themselves, and the firms this user may mint an integration token for.
  createServerSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          limit: async () => ({
            data: table === 'api_tokens' ? listed.tokens : [],
          }),
        }),
        eq: () => ({ in: async () => ({ data: [] }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => fakeAdmin(),
  isServiceRoleConfigured: () => true,
}));

function matches(row: TokenRow, filters: Filter[]): boolean {
  const record = row as unknown as Record<string, unknown>;
  return filters.every(([kind, column, value]) =>
    kind === 'is'
      ? (record[column] ?? null) === value
      : record[column] === value,
  );
}

/** A supabase-js shaped client over `world`. Thenable, like the real one. */
function fakeAdmin() {
  const build = () => {
    const filters: Filter[] = [];
    let op: 'select' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    // PostgREST returns the affected rows only when the request asked for a
    // representation, which supabase-js does by chaining .select() onto the
    // write. Without it the response body is empty and `data` is null.
    let askedForRows = false;

    const run = async (): Promise<{ data: unknown; error: unknown }> => {
      const hits = world.tokens.filter((r) => matches(r, filters));
      if (op === 'update') {
        world.updates.push({ payload, filters: [...filters], askedForRows });
        for (const r of hits) Object.assign(r, payload);
        return {
          data: askedForRows ? hits.map((r) => ({ id: r.id })) : null,
          error: null,
        };
      }
      return { data: hits.map((r) => ({ ...r })), error: null };
    };

    const api: Record<string, unknown> = {
      select() {
        if (op === 'update') askedForRows = true;
        return api;
      },
      update(p: Record<string, unknown>) {
        op = 'update';
        payload = p;
        return api;
      },
      delete() {
        world.deletes += 1;
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push(['eq', column, value]);
        return api;
      },
      is(column: string, value: unknown) {
        filters.push(['is', column, value]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      async maybeSingle() {
        const { data, error } = await run();
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
      },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return run().then(res, rej);
      },
    };
    return api;
  };
  return { from: () => build() };
}

const { revokeTokenAction } = await import('../app/profile/api-tokens/actions');

function token(over: Partial<TokenRow> = {}): TokenRow {
  return {
    id: 'tok-1',
    name: 'Zinpro One integration',
    prefix: 'adv_AbCdEfGh',
    user_id: 'user-owner',
    firm_id: null,
    revoked_at: null,
    ...over,
  };
}

beforeEach(() => {
  world = { tokens: [token()], updates: [], deletes: 0 };
  auth.user = { id: 'user-owner' };
  callerIsFirmAdmin.mockReset();
  callerIsFirmAdmin.mockResolvedValue(false);
  logSecurityEvent.mockClear();
});

describe('revokeTokenAction', () => {
  it('sets revoked_at on the token its own issuer asks to kill', async () => {
    const res = await revokeTokenAction('tok-1');
    expect(res.ok).toBe(true);
    expect(world.tokens[0].revoked_at).toEqual(expect.any(String));
  });

  it('keeps the row, because the audit trail is a token that existed', async () => {
    await revokeTokenAction('tok-1');
    expect(world.deletes).toBe(0);
    expect(world.tokens).toHaveLength(1);
    expect(world.tokens[0].id).toBe('tok-1');
  });

  it('asks for the affected rows back, so a no-op cannot read as success', async () => {
    // The guard behind the assertion above. Drop the .select() from the
    // update and PostgREST answers with no body: the happy path above then
    // has nothing to confirm the write landed on, and must refuse.
    await revokeTokenAction('tok-1');
    expect(world.updates).toHaveLength(1);
    expect(world.updates[0].askedForRows).toBe(true);
  });

  it('reports a second revoke as a failure rather than a silent success', async () => {
    world.tokens = [token({ revoked_at: '2026-08-01T00:00:00.000Z' })];
    const res = await revokeTokenAction('tok-1');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    // The stored timestamp is the first one. A second revoke must not
    // rewrite when the token stopped working.
    expect(world.tokens[0].revoked_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('refuses a caller who neither owns the token nor administers its firm', async () => {
    world.tokens = [token({ user_id: 'someone-else', firm_id: 'firm-1' })];
    auth.user = { id: 'outsider' };
    callerIsFirmAdmin.mockResolvedValue(false);

    const res = await revokeTokenAction('tok-1');

    // The returned value is the weak half. The load-bearing assertion is
    // that no write was attempted at all: an action that refuses in its
    // message while still writing has failed in the only way that matters.
    expect(res.ok).toBe(false);
    expect(world.updates).toHaveLength(0);
    expect(world.tokens[0].revoked_at).toBeNull();
  });

  it('lets an owner or admin of the firm the token is scoped to revoke it', async () => {
    world.tokens = [token({ user_id: 'someone-else', firm_id: 'firm-1' })];
    auth.user = { id: 'firm-admin' };
    callerIsFirmAdmin.mockResolvedValue(true);

    const res = await revokeTokenAction('tok-1');

    expect(res.ok).toBe(true);
    expect(world.tokens[0].revoked_at).toEqual(expect.any(String));
    // Asked the one firm authorization axis in this codebase, about the
    // firm the TOKEN is bound to rather than one the caller supplied.
    expect(callerIsFirmAdmin).toHaveBeenCalledWith('firm-1');
  });

  it('refuses a plain firm member, which is the roles half of that check', async () => {
    world.tokens = [token({ user_id: 'someone-else', firm_id: 'firm-1' })];
    auth.user = { id: 'paralegal' };
    // callerIsFirmAdmin is the whole rule: a paralegal is a member and
    // still gets false back.
    callerIsFirmAdmin.mockResolvedValue(false);

    const res = await revokeTokenAction('tok-1');

    expect(res.ok).toBe(false);
    expect(world.updates).toHaveLength(0);
  });

  it('refuses a signed-out caller before it reads anything', async () => {
    auth.user = null;
    const res = await revokeTokenAction('tok-1');
    expect(res.ok).toBe(false);
    expect(world.updates).toHaveLength(0);
  });

  it('records the revocation as a security event', async () => {
    await revokeTokenAction('tok-1');
    expect(logSecurityEvent).toHaveBeenCalledTimes(1);
    const entry = logSecurityEvent.mock.calls[0][0] as {
      kind: string;
      userId: string | null;
      details: Record<string, unknown>;
    };
    expect(entry.kind).toBe('api_token_revoked');
    expect(entry.userId).toBe('user-owner');
    expect(entry.details.token_id).toBe('tok-1');
  });

  it('does not log a security event for a refused attempt', async () => {
    world.tokens = [token({ user_id: 'someone-else', firm_id: 'firm-1' })];
    auth.user = { id: 'outsider' };
    await revokeTokenAction('tok-1');
    expect(logSecurityEvent).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The control has to be reachable, not only correct.
 * ------------------------------------------------------------------ */

/** Every string in the returned tree, joined. */
function textOf(node: unknown, out: string[] = []): string {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
  } else if (node && typeof node === 'object') {
    const props = (node as ReactElement).props;
    if (props && typeof props === 'object') {
      textOf((props as { children?: unknown }).children, out);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Every element in the returned tree, in no particular order. */
function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const el = node as ReactElement;
  if (el.type !== undefined) found.push(el);
  if (el.props && typeof el.props === 'object') {
    elements((el.props as { children?: unknown }).children, found);
  }
  return found;
}

const { TokensPanel } = await import('../app/profile/api-tokens/tokens-panel');
const { RevokeTokenButton } = await import(
  '../app/profile/api-tokens/revoke-token-button'
);

describe('the tokens list', () => {
  it('offers a revoke control on a live token and none on a dead one', async () => {
    listed.tokens = [
      { ...token({ id: 'live-1' }), scopes: ['read'] },
      {
        ...token({ id: 'dead-1', revoked_at: '2026-08-01T00:00:00.000Z' }),
        scopes: ['read'],
      },
    ];

    const buttons = elements(await TokensPanel()).filter(
      (el) => el.type === RevokeTokenButton,
    );

    expect(buttons.map((b) => (b.props as { tokenId: string }).tokenId)).toEqual(
      ['live-1'],
    );
  });

  it('does not head a list holding revoked tokens with "Active tokens"', async () => {
    listed.tokens = [
      {
        ...token({ id: 'dead-1', revoked_at: '2026-08-01T00:00:00.000Z' }),
        scopes: ['read'],
      },
    ];

    const text = textOf(await TokensPanel());

    expect(text).toContain('Revoked');
    expect(text).not.toContain('Active tokens');
  });
});
