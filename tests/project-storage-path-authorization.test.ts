import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which firm's bytes a project action is allowed to touch.
 *
 * getProjectDocumentUrlAction minted a SERVICE-ROLE signed URL for whatever
 * string sat in `firm_project_items.storage_path`, and deleteProjectItemAction /
 * deleteFolderAction handed that same string to a service-role remove(). The row
 * policy on firm_project_items constrains only `firm_id`, so a member of firm A
 * could insert a row of their own naming a file under firm B's prefix and then
 * be handed a link to another firm's document, or wipe it.
 *
 * The fakes below deliberately model NEITHER neighbouring gate:
 *
 *   - the row reads and the row deletes IGNORE the firm_id filter, so RLS is
 *     effectively off and cannot be what refuses;
 *   - a planted row is returned with a path under a different firm, so the row
 *     policy is satisfied and cannot be what refuses.
 *
 * What is left standing is the membership check and the path check inside the
 * action, which is what these assert on.
 *
 * Mutations that turn them red:
 *   - drop `callerIsFirmMember` from getProjectDocumentUrlAction: "refuses a
 *     caller who is not in the named firm" goes red.
 *   - drop it from deleteProjectItemAction: "a caller outside the firm never
 *     reaches a storage remove" goes red.
 *   - drop it from deleteFolderAction: "a caller outside the firm never wipes a
 *     folders files" goes red.
 *   - drop the `isFirmProjectPath` check from getProjectDocumentUrlAction:
 *     "refuses a path that points outside the firm prefix" goes red.
 *   - drop it from deleteProjectItemAction: "leaves another firms file alone
 *     when the row points at it" goes red.
 *   - drop it from deleteFolderAction: "wipes only the files under this firms
 *     own prefix" goes red.
 *   - drop the empty-result check from either delete: "reports a delete that
 *     matched nothing as a failure" and its folder twin go red.
 *   - move the storage block back above the folder delete: "wipes a folders
 *     files only after the folder delete lands" goes red.
 *   - loosen the prefix to a bare `path.includes(firmId)`: "refuses a path that
 *     merely mentions this firm" goes red.
 *
 * And none of them can be satisfied by removing the storage work: the happy-path
 * cases assert the signed URL and the remove still happen.
 */

const MY_FIRM = 'firm-mine';
const OTHER_FIRM = 'firm-theirs';
const MINE = `projects/${MY_FIRM}/project-1/doc.pdf`;
const THEIRS = `projects/${OTHER_FIRM}/project-9/privileged.pdf`;

type Scenario = {
  /** Firms the fake reports the caller as a member of. */
  memberOf: string[];
  /** What the item read / delete hands back, whatever ids were filtered on. */
  itemPath: string | null;
  /** Rows a delete reports as affected. */
  deleted: number;
  /** Paths the folder's items carry. */
  folderPaths: Array<string | null>;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: { memberOf: [], itemPath: null, deleted: 1, folderPaths: [] },
  };
  const calls: string[] = [];

  function makeServer() {
    return {
      from: (table: string) => ({
        select: (_cols?: string) => {
          const node: Record<string, unknown> = {
            // Every filter is a no-op on purpose: RLS is not modelled, so it
            // can never be the thing that refuses.
            eq: () => node,
            not: () => node,
            order: () => node,
            limit: () => node,
            maybeSingle: async () => {
              calls.push(`read:${table}`);
              if (table === 'firm_members') {
                const firm = s.current.memberOf[0];
                return { data: firm ? { role: 'attorney' } : null, error: null };
              }
              return { data: { storage_path: s.current.itemPath }, error: null };
            },
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`read:${table}`);
              return resolve({
                data: s.current.folderPaths.map((p) => ({ storage_path: p })),
                error: null,
              });
            },
          };
          return node;
        },
        delete: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              calls.push(`row-delete:${table}`);
              const rows = Array.from({ length: s.current.deleted }, () => ({
                id: 'row-1',
                storage_path: s.current.itemPath,
              }));
              return Promise.resolve({ data: rows, error: null });
            },
            // The unselected shape the vulnerable code used: resolves clean
            // with nothing to inspect, so removing `.select()` fails the
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
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string) => {
            calls.push(`signed-url:${bucket}:${path}`);
            return { data: { signedUrl: `https://example.test/${path}` }, error: null };
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
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const {
  getProjectDocumentUrlAction,
  deleteProjectItemAction,
  deleteFolderAction,
} = await import('../lib/projects-actions');

/** Every call the fakes saw that actually touched Supabase Storage. */
function storageCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('storage-') || c.startsWith('signed-url:'));
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.current = {
    memberOf: [MY_FIRM],
    itemPath: MINE,
    deleted: 1,
    folderPaths: [MINE],
  };
});

describe('getProjectDocumentUrlAction', () => {
  it('opens a document that really is in the callers own firm', async () => {
    const res = await getProjectDocumentUrlAction(MY_FIRM, 'item-1');
    expect(res.ok).toBe(true);
    expect(res.url).toContain(MINE);
    expect(storageCalls()).toContain(`signed-url:firm-documents:${MINE}`);
  });

  it('refuses a caller who is not in the named firm', async () => {
    h.s.current.memberOf = [];
    const res = await getProjectDocumentUrlAction(MY_FIRM, 'item-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    // No URL was minted, and the refusal is the membership check rather than
    // the row read coming back empty.
    expect(storageCalls()).toEqual([]);
    expect(h.calls).toContain('read:firm_members');
  });

  it('refuses a path that points outside the firm prefix', async () => {
    // The row exists and passes its own policy: it carries the caller's own
    // firm_id. Only the path betrays it.
    h.s.current.itemPath = THEIRS;
    const res = await getProjectDocumentUrlAction(MY_FIRM, 'item-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in this firm/i);
    expect(storageCalls()).toEqual([]);
    // The read really did happen and really did return the planted row, so
    // the refusal is the path check and nothing else.
    expect(h.calls).toContain('read:firm_project_items');
  });

  it('refuses a path that merely mentions this firm', async () => {
    h.s.current.itemPath = `projects/${OTHER_FIRM}/${MY_FIRM}/leak.pdf`;
    const res = await getProjectDocumentUrlAction(MY_FIRM, 'item-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
  });

  it('refuses a traversal segment inside a matching prefix', async () => {
    h.s.current.itemPath = `projects/${MY_FIRM}/../${OTHER_FIRM}/leak.pdf`;
    const res = await getProjectDocumentUrlAction(MY_FIRM, 'item-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
  });
});

describe('deleteProjectItemAction', () => {
  it('deletes the row and its file for a member of the firm', async () => {
    const res = await deleteProjectItemAction(MY_FIRM, 'item-1', 'project-1');
    expect(res.ok).toBe(true);
    expect(h.calls).toContain('row-delete:firm_project_items');
    expect(storageCalls()).toEqual([`storage-remove:firm-documents:${MINE}`]);
  });

  it('a caller outside the firm never reaches a storage remove', async () => {
    h.s.current.memberOf = [];
    const res = await deleteProjectItemAction(MY_FIRM, 'item-1', 'project-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    // Nothing irreversible happened, and the row delete was never even issued.
    expect(storageCalls()).toEqual([]);
    expect(h.calls).not.toContain('row-delete:firm_project_items');
  });

  it('leaves another firms file alone when the row points at it', async () => {
    h.s.current.itemPath = THEIRS;
    const res = await deleteProjectItemAction(MY_FIRM, 'item-1', 'project-1');
    // The caller's own row still goes, because it is theirs to delete.
    expect(res.ok).toBe(true);
    expect(h.calls).toContain('row-delete:firm_project_items');
    // The other firm's bytes do not.
    expect(storageCalls()).toEqual([]);
  });

  it('reports a delete that matched nothing as a failure', async () => {
    h.s.current.deleted = 0;
    const res = await deleteProjectItemAction(MY_FIRM, 'item-1', 'project-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in this firm/i);
    expect(storageCalls()).toEqual([]);
  });
});

describe('deleteFolderAction', () => {
  it('deletes the folder and wipes its files for a member of the firm', async () => {
    const res = await deleteFolderAction(MY_FIRM, 'folder-1', 'project-1');
    expect(res.ok).toBe(true);
    expect(storageCalls()).toEqual([`storage-remove:firm-documents:${MINE}`]);
  });

  it('a caller outside the firm never wipes a folders files', async () => {
    h.s.current.memberOf = [];
    const res = await deleteFolderAction(MY_FIRM, 'folder-1', 'project-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    expect(storageCalls()).toEqual([]);
    expect(h.calls).not.toContain('row-delete:firm_project_folders');
  });

  it('wipes only the files under this firms own prefix', async () => {
    h.s.current.folderPaths = [MINE, THEIRS, null];
    const res = await deleteFolderAction(MY_FIRM, 'folder-1', 'project-1');
    expect(res.ok).toBe(true);
    // One remove, naming the caller's file and only the caller's file.
    expect(storageCalls()).toEqual([`storage-remove:firm-documents:${MINE}`]);
  });

  it('wipes a folders files only after the folder delete lands', async () => {
    await deleteFolderAction(MY_FIRM, 'folder-1', 'project-1');
    const gate = h.calls.indexOf('row-delete:firm_project_folders');
    expect(gate).toBeGreaterThanOrEqual(0);
    const wipes = storageCalls();
    expect(wipes.length).toBeGreaterThan(0);
    for (const call of wipes) {
      expect(h.calls.indexOf(call)).toBeGreaterThan(gate);
    }
  });

  it('reports a folder delete that matched nothing as a failure', async () => {
    h.s.current.deleted = 0;
    const res = await deleteFolderAction(MY_FIRM, 'folder-1', 'project-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not in this firm/i);
    expect(storageCalls()).toEqual([]);
  });
});
