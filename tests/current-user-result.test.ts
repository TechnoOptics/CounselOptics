import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auth-sensitive: keep "no session" distinct from "session read threw".
 *
 * getCurrentUser() historically swallowed ANY exception and returned
 * null, so a transient read failure (corrupted cookie, Edge decode
 * error, a stale-bundle hiccup mid-deploy) was indistinguishable from
 * a real logout - and the counsel/portal layout gates evicted the
 * user to /sign-in on a hiccup ("crashed the app and signed me out").
 *
 * getCurrentUserResult() preserves the distinction:
 *   - read succeeds with a user  -> { user }
 *   - read succeeds, no session   -> { user: null }   (definitive)
 *   - read THROWS                 -> { error }         (NOT a logout)
 *
 * getCurrentUser() must stay backward-compatible: collapse both the
 * no-session and the thrown cases to null for its many best-effort
 * callers.
 */

const h = vi.hoisted(() => {
  // Mutable knob the mocked supabase client reads on each call.
  const auth: { behavior: 'user' | 'null' | 'throw' } = { behavior: 'null' };
  return { auth };
});

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      // Mirrors supabase.auth.getUser()'s shape: { data: { user } }.
      getUser: async () => {
        if (h.auth.behavior === 'throw') {
          throw new Error('Invalid UTF-8 sequence');
        }
        if (h.auth.behavior === 'user') {
          return { data: { user: { id: 'user-123' } }, error: null };
        }
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

// createServerSupabase() touches cookies()/headers(); stub them so the
// client can be constructed outside a request scope.
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => undefined }),
  headers: () => ({ get: () => null }),
}));

// cookie-domain is pulled in transitively by server.ts.
vi.mock('../lib/supabase/cookie-domain', () => ({
  cookieDomainForHost: () => undefined,
}));

const CONFIGURED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
};

let server: typeof import('../lib/supabase/server');

beforeEach(async () => {
  Object.assign(process.env, CONFIGURED_ENV);
  h.auth.behavior = 'null';
  vi.resetModules();
  server = await import('../lib/supabase/server');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCurrentUserResult', () => {
  it('returns { user } when the read succeeds with a session', async () => {
    h.auth.behavior = 'user';
    const result = await server.getCurrentUserResult();
    expect('error' in result).toBe(false);
    expect('user' in result && result.user).toEqual({ id: 'user-123' });
  });

  it('returns { user: null } for a genuine signed-out visitor', async () => {
    h.auth.behavior = 'null';
    const result = await server.getCurrentUserResult();
    expect(result).toEqual({ user: null });
  });

  it('returns { error } - NOT { user: null } - when the read throws', async () => {
    h.auth.behavior = 'throw';
    const result = await server.getCurrentUserResult();
    expect('error' in result).toBe(true);
    // The load-bearing distinction: a thrown read is NOT a signed-out
    // answer, so the layout gate can refuse to redirect.
    expect('user' in result).toBe(false);
    if ('error' in result) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('treats an unconfigured deployment as a definitive no-session', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
    const fresh = await import('../lib/supabase/server');
    const result = await fresh.getCurrentUserResult();
    expect(result).toEqual({ user: null });
    Object.assign(process.env, CONFIGURED_ENV);
  });
});

describe('getCurrentUser (backward-compatible)', () => {
  it('returns the user object when the read succeeds', async () => {
    h.auth.behavior = 'user';
    expect(await server.getCurrentUser()).toEqual({ id: 'user-123' });
  });

  it('returns null for a genuine signed-out visitor', async () => {
    h.auth.behavior = 'null';
    expect(await server.getCurrentUser()).toBeNull();
  });

  it('collapses a thrown read to null (unchanged best-effort contract)', async () => {
    h.auth.behavior = 'throw';
    // Silence the intentional console.warn on the error path.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await server.getCurrentUser()).toBeNull();
    warn.mockRestore();
  });
});
