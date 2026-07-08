import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Auth-sensitive: a THROWN session read must not masquerade as a
 * definitive persona.
 *
 * getWorkspacePersona() historically collapsed a thrown session read
 * to `{ kind: 'none' }`, so a fully-provisioned employee saw the "No
 * workspace yet" card during a deploy hiccup - the same false-eviction
 * class as the sign-in redirect. getWorkspacePersonaResult() keeps the
 * distinction:
 *   - read succeeds -> { persona }   (including a genuine `none`)
 *   - read THROWS   -> { error }      (transient, NOT an answer)
 *
 * getWorkspacePersona() stays backward-compatible: it collapses the
 * error case back to `{ kind: 'none' }` for the portal pages that only
 * need a best-effort persona under the already-guarded layout.
 */

const h = vi.hoisted(() => {
  const session: { behavior: 'user' | 'null' | 'throw' } = { behavior: 'null' };
  return { session };
});

vi.mock('../lib/supabase/server', () => ({
  getCurrentUserResult: async () => {
    if (h.session.behavior === 'throw') {
      return { error: new Error('Invalid UTF-8 sequence') };
    }
    if (h.session.behavior === 'user') {
      return { user: { id: 'user-123', email: 'e@example.com' } };
    }
    return { user: null };
  },
}));

// A signed-in user with no firm membership and no employee record is a
// legitimate `none` - the path we use to prove `none` != error.
vi.mock('../lib/firm-storage', () => ({
  listMyFirms: async () => [],
  getActiveFirmContext: async () => null,
  getFirmById: async () => null,
}));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => null,
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
}));

let persona: typeof import('../lib/persona');

beforeEach(async () => {
  h.session.behavior = 'null';
  vi.resetModules();
  persona = await import('../lib/persona');
});

describe('getWorkspacePersonaResult', () => {
  it('returns { error } - NOT a persona - when the session read throws', async () => {
    h.session.behavior = 'throw';
    const result = await persona.getWorkspacePersonaResult();
    expect('error' in result).toBe(true);
    expect('persona' in result).toBe(false);
  });

  it('returns a definitive { persona: none } for a signed-out visitor', async () => {
    h.session.behavior = 'null';
    const result = await persona.getWorkspacePersonaResult();
    expect(result).toEqual({ persona: { kind: 'none' } });
  });

  it('returns a definitive { persona: none } for a user with no workspace', async () => {
    // The load-bearing case: a legitimate `none` must stay distinct
    // from a thrown read, so the portal shows "No workspace yet" here
    // but reconnect on a throw.
    h.session.behavior = 'user';
    const result = await persona.getWorkspacePersonaResult();
    expect('error' in result).toBe(false);
    expect('persona' in result && result.persona).toEqual({ kind: 'none' });
  });
});

describe('getWorkspacePersona (backward-compatible)', () => {
  it('collapses a thrown session read to { kind: none }', async () => {
    h.session.behavior = 'throw';
    expect(await persona.getWorkspacePersona()).toEqual({ kind: 'none' });
  });

  it('returns none for a signed-out visitor', async () => {
    h.session.behavior = 'null';
    expect(await persona.getWorkspacePersona()).toEqual({ kind: 'none' });
  });
});
