import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the person who clicked "Send invite" is actually told.
 *
 * inviteCollaboratorAction threw on every failure, and both call sites
 * (app/cases/[id]/collaborators-panel.tsx and the timeline's invite box) do
 * `setError(err.message)`. That reads like it works, and in dev it does.
 *
 * In a production build it does not. React strips the message off an error
 * that crosses the Server Action boundary and sends a digest instead, so
 * `err.message` in the browser is the generic
 *
 *   "An error occurred in the Server Components render. The specific message
 *    is omitted in production builds to avoid leaking sensitive details."
 *
 * which is what the red box on the case page showed. The reason was written
 * carefully and then discarded at the boundary: a case owner on the free plan
 * was never told to upgrade, and a genuine failure read as an unexplained
 * server fault. lib/firm-actions.ts inviteMatterCollaboratorAction already
 * returns { ok, error } for exactly this reason.
 *
 * These tests assert the RETURN VALUE, because a value survives the boundary
 * and a thrown message does not. `rejects.toThrow` would pass on the broken
 * shape, which is why it is not used.
 */

const h = vi.hoisted(() => {
  const s = {
    inviteError: null as Error | null,
    hasCollaborators: true,
  };
  const calls: string[] = [];
  return { s, calls };
});

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usingSupabase: () => true,
    inviteCollaborator: async () => {
      h.calls.push('inviteCollaborator');
      if (h.s.inviteError) throw h.s.inviteError;
      return {
        collaborator: {
          id: 'collab-1',
          caseId: 'case-1',
          userId: null,
          email: 'colleague@example.test',
          role: 'viewer',
          invitedBy: 'owner-1',
          invitedAt: '2026-08-10T00:00:00.000Z',
          acceptedAt: null,
          witnessStatement: null,
          witnessStatementUpdatedAt: null,
        },
        emailed: true,
      };
    },
    getCase: async () => ({ id: 'case-1', title: 'A matter' }),
    getCurrentSubscription: async () => null,
    getEffectiveTrialState: async () => null,
  };
});

vi.mock('../lib/tier', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    isFullAccessTrial: () => false,
    hasFeature: () => h.s.hasCollaborators,
  };
});

vi.mock('../lib/user-trials', () => ({ currentUserTrialGrant: async () => undefined }));
vi.mock('../lib/activity', () => ({ logCaseEvent: async () => undefined }));
vi.mock('../lib/notifications', () => ({ createNotification: async () => null }));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));
vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));

const { inviteCollaboratorAction } = await import('../lib/actions');

function form(email: string, role = 'viewer'): FormData {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('role', role);
  return fd;
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.inviteError = null;
  h.s.hasCollaborators = true;
});

describe('what the invite action hands back to the page', () => {
  it('reports a sent invite as a value, not just an absence of a throw', async () => {
    const res = await inviteCollaboratorAction('case-1', form('colleague@example.test'));
    expect(res).toMatchObject({ ok: true, emailed: true });
    expect(h.calls).toContain('inviteCollaborator');
  });

  it('returns the reason an invite failed instead of throwing it away at the boundary', async () => {
    h.s.inviteError = new Error('Only the case owner can invite collaborators.');

    const res = await inviteCollaboratorAction('case-1', form('colleague@example.test'));

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only the case owner/i);
  });

  it('returns the upgrade prompt rather than a generic server fault', async () => {
    h.s.hasCollaborators = false;

    const res = await inviteCollaboratorAction('case-1', form('colleague@example.test'));

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pro plan/i);
    // The gate really refused: no invite was attempted.
    expect(h.calls).not.toContain('inviteCollaborator');
  });

  it('returns the validation message for an address that is not one', async () => {
    const res = await inviteCollaboratorAction('case-1', form('not-an-email'));

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid email/i);
    expect(h.calls).not.toContain('inviteCollaborator');
  });
});
