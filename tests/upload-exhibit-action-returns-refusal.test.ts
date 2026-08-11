import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * uploadExhibitAction hands the refusal back; it never re-throws one.
 *
 * addExhibit now ANSWERS with `{ ok: false, error }` for a file the
 * magic-byte screen will not accept. That only helps if the action passes the
 * sentence through. Converting it back into a throw at this seam is silent:
 * the action's own catch turns it into the calm internal-error copy, so the
 * person is told "that upload did not finish" for a file they could have
 * fixed by picking a different one. The source guard in
 * upload-refusal-reaches-the-user.test.ts cannot see that, because the
 * identifier there is `added`, not a screen result.
 *
 * Mutations that turn these red:
 *   - `if (!added.ok) throw new Error(added.error)` in uploadExhibitAction:
 *     "passes a magic-byte refusal straight through" goes red.
 *   - re-throwing the direct refusals (no file chosen, over the size cap):
 *     the matching test goes red, because a rejected promise is not a
 *     returned reason.
 *   - dropping the try/catch around addExhibit: "gives calm copy when the
 *     write really fails" goes red, which is the other direction - an
 *     internal error must NOT reach the person as a raw message.
 */

const h = vi.hoisted(() => {
  const state = {
    result: { ok: true, exhibit: { id: 'ex-1', label: 'Exhibit A', fileName: 'a.png', category: null } } as
      | { ok: true; exhibit: Record<string, unknown> }
      | { ok: false; error: string },
    thrown: null as Error | null,
    user: { id: 'user-1' } as { id: string } | null,
  };
  return { state };
});

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => h.state.user,
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
  requireUser: async () => h.state.user,
}));

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));

vi.mock('../lib/storage', () => ({
  usingSupabase: () => true,
  addExhibit: async () => {
    if (h.state.thrown) throw h.state.thrown;
    return h.state.result;
  },
  saveExhibitScan: async () => {},
  getCase: async () => null,
  getCurrentSubscription: async () => null,
  getEffectiveTrialState: async () => ({ mode: 'active' }),
}));

vi.mock('../lib/tier', () => ({
  caseLimit: () => null,
  hasFeature: () => true,
  isFullAccessTrial: () => true,
}));
vi.mock('../lib/user-trials', () => ({ currentUserTrialGrant: async () => undefined }));
vi.mock('../lib/activity', () => ({ logCaseEvent: async () => {} }));
vi.mock('../lib/ai', () => ({
  classifyCaseType: async () => null,
  runReview: async () => ({}),
  scanDocument: async () => ({}),
  transcribeMedia: async () => ({}),
}));
vi.mock('../lib/notifications', () => ({ createNotification: async () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));

const { uploadExhibitAction } = await import('../lib/actions');

function form(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.set('file', file);
  fd.set('description', 'a photo of the notice');
  return fd;
}

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', {
  type: 'image/png',
});

beforeEach(() => {
  h.state.result = {
    ok: true,
    exhibit: { id: 'ex-1', label: 'Exhibit A', fileName: 'a.png', category: null },
  };
  h.state.thrown = null;
  h.state.user = { id: 'user-1' };
});

describe('uploadExhibitAction returns the reason the upload was refused', () => {
  it('passes a magic-byte refusal straight through', async () => {
    h.state.result = { ok: false, error: 'This file is not a valid image.' };
    const res = await uploadExhibitAction('case-1', form(PNG));
    expect(res).toEqual({ ok: false, error: 'This file is not a valid image.' });
  });

  it('passes the audio refusal straight through', async () => {
    h.state.result = { ok: false, error: 'This file is not a valid audio recording.' };
    const res = await uploadExhibitAction('case-1', form(PNG));
    expect(res).toEqual({
      ok: false,
      error: 'This file is not a valid audio recording.',
    });
  });

  it('answers when no file was chosen', async () => {
    const res = await uploadExhibitAction('case-1', form(null));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/choose a file/i);
  });

  it('answers when the file is over the cap, and says what to do next', async () => {
    const big = new File([new Uint8Array(1024)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    const res = await uploadExhibitAction('case-1', form(big));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/50MB limit/);
    // A refusal has to leave the person somewhere to go.
    expect(res.error).toMatch(/smaller copy/i);
  });

  it('answers when the session has gone, rather than blowing up the page', async () => {
    h.state.user = null;
    const res = await uploadExhibitAction('case-1', form(PNG));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/sign in again/i);
  });

  it('gives calm copy when the write really fails, never the raw message', async () => {
    h.state.thrown = new Error('duplicate key value violates unique constraint');
    const res = await uploadExhibitAction('case-1', form(PNG));
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/duplicate key|constraint/i);
    expect(res.error).toMatch(/did not finish/i);
    expect(res.error).toMatch(/safe/i);
  });

  it('shows a support reference only when Next generated one', async () => {
    const withDigest = Object.assign(new Error('boom'), { digest: '1734829111' });
    h.state.thrown = withDigest;
    const withRef = await uploadExhibitAction('case-1', form(PNG));
    expect(withRef.error).toMatch(/Reference: 1734829111/);

    // An internal identifier this codebase put on the error is not a support
    // reference and must not be printed at anyone.
    h.state.thrown = Object.assign(new Error('boom'), { digest: 'FIRM_ACCESS_ENDED' });
    const noRef = await uploadExhibitAction('case-1', form(PNG));
    expect(noRef.error).not.toMatch(/Reference:/);
    expect(noRef.error).not.toMatch(/FIRM_ACCESS_ENDED/);
  });

  it('reports success when the file was accepted', async () => {
    const res = await uploadExhibitAction('case-1', form(PNG));
    expect(res).toEqual({ ok: true });
  });
});
