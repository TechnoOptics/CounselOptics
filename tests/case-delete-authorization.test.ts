import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who is allowed to destroy a case, and in what order.
 *
 * deleteCase used to wipe the case's storage folders through the
 * SERVICE-ROLE client and only afterwards attempt the row delete through the
 * user-scoped one. Service role bypasses RLS, so the wipe always landed; the
 * row delete matched zero rows for a non-owner, and PostgREST reports a
 * zero-row delete as `error: null`, so the function returned normally and the
 * caller was redirected as though it had worked. Any signed-in person could
 * destroy anyone else's Safe Witness evidence, including witness ID photos
 * and signatures, by posting a case id they did not own.
 *
 * These tests are behavioural: they drive the real deleteCase and the real
 * deleteCaseAction against fake Supabase clients and assert on the ORDER and
 * IDENTITY of the calls those clients receive. No source text is matched, so
 * no comment, constant, or neighbouring string can satisfy them.
 *
 * Mutations that turn them red:
 *   - drop the `if (!rows || rows.length === 0) throw` from deleteCase:
 *     "refuses a caller who does not own the case", "a non-owner never
 *     reaches a storage call", and "the action reports a zero-row delete as
 *     a failure" all go red.
 *   - drop `.select('id')` from the delete: the fake resolves the awaited
 *     builder with `data: null`, which is the old shape, and the same three
 *     go red.
 *   - move the storage block back above the row delete: "a non-owner never
 *     reaches a storage call" and "wipes storage only after the row delete
 *     lands" go red.
 *   - delete the storage block outright: "wipes storage only after the row
 *     delete lands" goes red, so the guard cannot be satisfied by removing
 *     the thing it guards.
 */

const OWNED = 'case-owned';
const NOT_OWNED = 'case-not-owned';

type Scenario = {
  /** Rows the fake reports the DELETE as having affected. */
  deleted: Array<{ id: string }>;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = { current: { deleted: [{ id: 'case-owned' }] } };
  const calls: string[] = [];

  function makeServer() {
    return {
      from: (table: string) => ({
        delete: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              calls.push(`row-delete:${table}`);
              return Promise.resolve({ data: s.current.deleted, error: null });
            },
            // Awaiting the builder without selecting is exactly what the
            // vulnerable shape did, and it resolves clean with nothing to
            // inspect. Kept so that removing `.select('id')` fails the
            // assertions rather than the harness.
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`row-delete:${table}`);
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  function makeAdmin() {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push(`admin-read:${table}`);
              return { data: { id: 'community-1' }, error: null };
            },
          }),
        }),
      }),
      storage: {
        from: (bucket: string) => ({
          list: async () => {
            calls.push(`storage-list:${bucket}`);
            return { data: [{ id: 'obj-1', name: 'witness-id.jpg' }], error: null };
          },
          remove: async (paths: string[]) => {
            calls.push(`storage-remove:${bucket}:${paths.join('|')}`);
            return { data: null, error: null };
          },
        }),
      },
    };
  }

  return { s, calls, makeServer, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => h.makeServer(),
  requireUser: async () => ({ id: 'user-1' }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('next/navigation', () => ({
  redirect: () => {
    h.calls.push('redirect');
  },
}));

const { deleteCase } = await import('../lib/storage');
const { deleteCaseAction } = await import('../lib/actions');

/** Every call the fakes saw that actually touched Supabase Storage. */
function storageCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('storage-'));
}

function deleteForm(caseId: string): FormData {
  const fd = new FormData();
  fd.set('caseId', caseId);
  fd.set('confirm', 'delete');
  return fd;
}

describe('deleteCase authorization', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.s.current = { deleted: [{ id: OWNED }] };
  });

  it('refuses a caller who does not own the case', async () => {
    // RLS (cases_delete_own) filters the delete to zero rows, and PostgREST
    // hands that back as a success with error null.
    h.s.current.deleted = [];
    await expect(deleteCase(NOT_OWNED)).rejects.toThrow(/could not be saved/i);
  });

  it('a non-owner never reaches a storage call', async () => {
    h.s.current.deleted = [];
    await expect(deleteCase(NOT_OWNED)).rejects.toThrow();
    // The whole point: nothing irreversible happened. The evidence is
    // still there for the person who actually owns it.
    expect(storageCalls()).toEqual([]);
    // And the refusal really came from the row delete, not from the
    // function never getting that far.
    expect(h.calls).toContain('row-delete:cases');
  });

  it('wipes storage only after the row delete lands', async () => {
    h.s.current.deleted = [{ id: OWNED }];
    await deleteCase(OWNED);
    const gate = h.calls.indexOf('row-delete:cases');
    expect(gate).toBeGreaterThanOrEqual(0);
    const wipes = storageCalls();
    // The cleanup still happens - this is not a test that passes by the
    // storage work being removed.
    expect(wipes.length).toBeGreaterThan(0);
    for (const call of wipes) {
      expect(h.calls.indexOf(call)).toBeGreaterThan(gate);
    }
    // Both Safe Witness buckets are still reached, and the exhibits folder.
    expect(wipes.some((c) => c.startsWith('storage-list:community-submissions'))).toBe(true);
    expect(wipes.some((c) => c.startsWith('storage-list:community-public'))).toBe(true);
    expect(wipes.some((c) => c.startsWith('storage-list:exhibits'))).toBe(true);
  });

  it('reads the community case id before the row that carries it is gone', async () => {
    h.s.current.deleted = [{ id: OWNED }];
    await deleteCase(OWNED);
    // The community_cases row cascades off the case row, so its id has to
    // be read first or the community-public folder can never be named.
    // This read is not destructive, which is why it may sit before the gate.
    expect(h.calls.indexOf('admin-read:community_cases')).toBeLessThan(
      h.calls.indexOf('row-delete:cases'),
    );
  });
});

describe('deleteCaseAction', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.s.current = { deleted: [{ id: OWNED }] };
  });

  it('the action reports a zero-row delete as a failure', async () => {
    h.s.current.deleted = [];
    const res = await deleteCaseAction(null, deleteForm(NOT_OWNED));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be saved/i);
    // Not told it worked, and not sent on to /cases as though it had.
    expect(h.calls).not.toContain('redirect');
    expect(storageCalls()).toEqual([]);
  });

  it('still deletes a case the caller does own', async () => {
    h.s.current.deleted = [{ id: OWNED }];
    await deleteCaseAction(null, deleteForm(OWNED));
    expect(h.calls).toContain('row-delete:cases');
    expect(h.calls).toContain('redirect');
  });
});
