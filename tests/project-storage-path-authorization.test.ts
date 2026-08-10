import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './support/strip-comments';

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
 * pullProjectFilesIntoCaseAction was the fourth such path and was missed when
 * the other three were fixed, which is why the last describe in this file does
 * not test a site at all: it ENUMERATES them from the source. Per-site tests
 * only ever cover the sites somebody listed, and the defect here has twice been
 * the site nobody listed. That one is also the worse of the two shapes, because
 * it does not hand back a link that expires; it copies the bytes into a matter
 * as a durable exhibit, so the victim firm's document ends up permanently
 * inside the attacker's case file.
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
 *   - drop it from pullProjectFilesIntoCaseAction: "never fetches the bytes of
 *     a file that is not this firms" goes red on both of its assertions, and
 *     the enumerating guard goes red as well.
 *   - move that same check BELOW the download: the outcome assertion still
 *     passes and the "no bytes were fetched" assertion goes red, which is why
 *     order and outcome are asserted separately.
 *   - drop the empty-result check from either delete: "reports a delete that
 *     matched nothing as a failure" and its folder twin go red.
 *   - move the storage block back above the folder delete: "wipes a folders
 *     files only after the folder delete lands" goes red.
 *   - loosen the prefix to a bare `path.includes(firmId)`: "refuses a path that
 *     merely mentions this firm" goes red.
 *   - add a new ungated admin.storage call anywhere in the module: "every
 *     service-role storage call in this module is one of these" goes red.
 *
 * And none of them can be satisfied by removing the storage work: the happy-path
 * cases assert the signed URL, the remove and the download still happen.
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
  /** Paths the linked project's documents carry, for the pull-into-case path. */
  pullPaths: Array<string | null>;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: { memberOf: [], itemPath: null, deleted: 1, folderPaths: [], pullPaths: [] },
  };
  const calls: string[] = [];

  function makeServer() {
    return {
      from: (table: string) => ({
        select: (cols?: string) => {
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
              if (table === 'firm_projects') {
                return {
                  data: { id: 'project-1', name: 'Binder', case_id: 'case-1' },
                  error: null,
                };
              }
              if (table === 'cases') return { data: { id: 'case-1' }, error: null };
              return { data: { storage_path: s.current.itemPath }, error: null };
            },
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`read:${table}`);
              // Told apart by the columns asked for, not by the table: both
              // the folder wipe and the pull read firm_project_items.
              const pull = (cols ?? '').includes('file_name');
              const data = pull
                ? s.current.pullPaths.map((p, i) => ({
                    id: `item-${i}`,
                    title: `Doc ${i}`,
                    storage_path: p,
                    file_name: `doc-${i}.pdf`,
                    file_type: 'application/pdf',
                  }))
                : s.current.folderPaths.map((p) => ({ storage_path: p }));
              return resolve({ data, error: null });
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
          download: async (path: string) => {
            calls.push(`storage-download:${bucket}:${path}`);
            return {
              data: { arrayBuffer: async () => new ArrayBuffer(8) },
              error: null,
            };
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

// The exhibit write, recorded rather than performed. "No bytes were fetched"
// and "no exhibit row was written" are two different claims, and a gate moved
// below the download would still satisfy only the second.
vi.mock('../lib/case-evidence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadCaseContext: async () => null,
  importFileAsCaseEvidence: async (input: { caseId: string; name: string }) => {
    h.calls.push(`exhibit-write:${input.caseId}:${input.name}`);
    return { ok: true };
  },
}));

// AI off, so the pull neither reads a plan nor starts an analysis. Both are
// downstream of the gate and neither is what any case here is about.
vi.mock('../lib/timeline-ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  aiConfigured: () => false,
}));

const {
  getProjectDocumentUrlAction,
  deleteProjectItemAction,
  deleteFolderAction,
  pullProjectFilesIntoCaseAction,
} = await import('../lib/projects-actions');

/** Every call the fakes saw that actually touched Supabase Storage. */
function storageCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('storage-') || c.startsWith('signed-url:'));
}

/** Every exhibit the pull path durably wrote into a matter. */
function exhibitWrites(): string[] {
  return h.calls.filter((c) => c.startsWith('exhibit-write:'));
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.current = {
    memberOf: [MY_FIRM],
    itemPath: MINE,
    deleted: 1,
    folderPaths: [MINE],
    pullPaths: [MINE],
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

describe('pullProjectFilesIntoCaseAction', () => {
  it('copies a projects own documents into the linked matter', async () => {
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(1);
    expect(storageCalls()).toEqual([`storage-download:firm-documents:${MINE}`]);
    expect(exhibitWrites()).toHaveLength(1);
  });

  it('never fetches the bytes of a file that is not this firms', async () => {
    // The row exists and passes its own policy: it carries the caller's own
    // firm_id. Only the path betrays it.
    h.s.current.pullPaths = [THEIRS];
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(false);
    expect(res.imported).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors?.join(' ')).toMatch(/not in this firm/i);
    // Two separate claims. A gate moved below the download would still refuse
    // and still write no exhibit, and only the first of these would catch it.
    expect(storageCalls()).toEqual([]);
    expect(exhibitWrites()).toEqual([]);
    // The read really did happen and really did return the planted row, so
    // the refusal is the path check and nothing else.
    expect(h.calls).toContain('read:firm_project_items');
  });

  it('imports only the documents under this firms own prefix', async () => {
    h.s.current.pullPaths = [MINE, THEIRS, null];
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(true);
    expect(res.imported).toBe(1);
    // One download, naming the caller's file and only the caller's file, and
    // one exhibit to match it.
    expect(storageCalls()).toEqual([`storage-download:firm-documents:${MINE}`]);
    expect(exhibitWrites()).toHaveLength(1);
  });

  it('a caller outside the firm never reaches the bucket', async () => {
    h.s.current.memberOf = [];
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    expect(storageCalls()).toEqual([]);
    expect(exhibitWrites()).toEqual([]);
    // The refusal is the membership check rather than the project lookup
    // coming back empty.
    expect(h.calls).toContain('read:firm_members');
    expect(h.calls).not.toContain('read:firm_projects');
  });

  it('refuses a traversal segment inside a matching prefix', async () => {
    h.s.current.pullPaths = [`projects/${MY_FIRM}/../${OTHER_FIRM}/leak.pdf`];
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
    expect(exhibitWrites()).toEqual([]);
  });

  it('refuses a path that merely mentions this firm', async () => {
    h.s.current.pullPaths = [`projects/${OTHER_FIRM}/${MY_FIRM}/leak.pdf`];
    const res = await pullProjectFilesIntoCaseAction(MY_FIRM, 'project-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
    expect(exhibitWrites()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The enumerating guard
// ---------------------------------------------------------------------------

/**
 * Every service-role storage call in lib/projects-actions.ts, derived from the
 * source rather than from a list somebody wrote down.
 *
 * WHY THIS EXISTS AND THE PER-SITE TESTS ABOVE ARE NOT ENOUGH. Three fixes to
 * this file have each reached every site their own finding listed and missed
 * one that was not on it, and the comment written afterwards then asserted
 * complete coverage. A test per site cannot catch that, because the site
 * nobody listed has no test. So this one refuses to be given the list: it
 * finds the calls itself and holds the file to a fixed set. A new call is a
 * red test that names itself, and the author has to decide what gates it.
 *
 * HOW IT AVOIDS BEING SATISFIED BY TEXT THAT IS NOT CODE.
 *   - Comments are stripped first (tests/support/strip-comments.ts), so the
 *     module header naming these functions cannot stand in for any of them.
 *   - The anchor is the call form WITH its arguments, `admin.storage.from(
 *     '<bucket>').<op>(<first arg>`, not a bare function name that a
 *     neighbouring string or a differently-named function could satisfy.
 *   - The gate is required to appear BEFORE the call in the same function, by
 *     offset, so a check moved below the download does not count.
 *   - Two counting assertions close the obvious ways to leave the anchor
 *     behind: every `.storage` in the file must be reached through a receiver
 *     named `admin`, and every `createAdminSupabase()` must be bound to that
 *     name.
 *
 * WHAT IT CANNOT TELL YOU: whether a gate is the RIGHT one. It only holds the
 * file to the decision that a stored path is validated and a self-built path
 * is not. Deciding which a new call is remains a person's job.
 */
const MODULE_PATH = fileURLToPath(new URL('../lib/projects-actions.ts', import.meta.url));
const RAW = readFileSync(MODULE_PATH, 'utf8');
const SRC = stripComments(RAW);

type Gate = 'stored-path' | 'own-prefix';

/**
 * The sites as they stand. `gate` records which question each one answers:
 *   - 'stored-path': the argument came out of firm_project_items, whose row
 *     policy constrains only firm_id, so isFirmProjectPath has to run first.
 *   - 'own-prefix': the argument is a path this same function just built from
 *     firmProjectPrefix, so there is nothing stored to validate.
 */
const EXPECTED: Array<{ fn: string; op: string; arg: string; gate: Gate }> = [
  { fn: 'deleteFolderAction', op: 'remove', arg: 'paths', gate: 'stored-path' },
  { fn: 'uploadProjectDocumentAction', op: 'upload', arg: 'path', gate: 'own-prefix' },
  { fn: 'uploadProjectDocumentAction', op: 'remove', arg: '[path]', gate: 'own-prefix' },
  { fn: 'deleteProjectItemAction', op: 'remove', arg: '[path]', gate: 'stored-path' },
  { fn: 'getProjectDocumentUrlAction', op: 'createSignedUrl', arg: 'path', gate: 'stored-path' },
  { fn: 'pullProjectFilesIntoCaseAction', op: 'download', arg: 'storagePath', gate: 'stored-path' },
];

type Found = { fn: string; op: string; arg: string; bucket: string; at: number };

/** Where each top-level function in the module starts, in source order. */
const FUNCTIONS = [...SRC.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)].map((m) => ({
  name: m[1],
  at: m.index ?? 0,
}));

function enclosingFunction(at: number): { name: string; at: number } {
  let found = { name: '<module scope>', at: 0 };
  for (const fn of FUNCTIONS) {
    if (fn.at < at) found = fn;
    else break;
  }
  return found;
}

const SITES: Found[] = [
  ...SRC.matchAll(
    /admin\s*\.\s*storage\s*\.\s*from\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*(\w+)\(\s*([^,)]*)/g,
  ),
].map((m) => ({
  fn: enclosingFunction(m.index ?? 0).name,
  op: m[3],
  arg: m[4].trim(),
  bucket: m[2],
  at: m.index ?? 0,
}));

describe('every service-role storage call in lib/projects-actions.ts', () => {
  it('is one of these, and there are no others', () => {
    expect(SITES.map((site) => ({ fn: site.fn, op: site.op, arg: site.arg }))).toEqual(
      EXPECTED.map((e) => ({ fn: e.fn, op: e.op, arg: e.arg })),
    );
  });

  it('reaches storage only through a receiver named admin', () => {
    // Closes the "rename the receiver and the anchor stops matching" hole:
    // any `.storage` the regex above did not account for shows up here.
    const receivers = [...SRC.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*storage\b/g)].map((m) => m[1]);
    expect(new Set(receivers)).toEqual(new Set(['admin']));
    expect(receivers).toHaveLength(SITES.length);
  });

  it('binds every service-role client to that same name', () => {
    const created = SRC.match(/createAdminSupabase\(\)/g) ?? [];
    const bound = SRC.match(/const admin = createAdminSupabase\(\)/g) ?? [];
    expect(bound).toHaveLength(created.length);
  });

  it('names only the firm-documents bucket', () => {
    expect([...new Set(SITES.map((site) => site.bucket))]).toEqual(['firm-documents']);
  });

  it('validates a stored path before handing it over, not after', () => {
    for (const [i, site] of SITES.entries()) {
      const expected = EXPECTED[i];
      const body = SRC.slice(enclosingFunction(site.at).at, site.at);
      const guard =
        expected.gate === 'stored-path' ? 'isFirmProjectPath(firmId' : 'firmProjectPrefix(firmId)';
      expect(
        body.includes(guard),
        `${site.fn} reaches ${site.op}(${site.arg}) without ${guard} before it`,
      ).toBe(true);
    }
  });

  it('is counted correctly by the module header', () => {
    // Read from RAW, because the claim being checked lives in a comment. The
    // header also tells the reader the command that reproduces this number.
    const claim = /There are (\d+) service-role storage calls in this file/.exec(RAW);
    expect(claim, 'the module header no longer states a count').not.toBeNull();
    expect(Number(claim?.[1])).toBe(SITES.length);
    expect((RAW.match(/admin\.storage/g) ?? []).length).toBe(SITES.length);
  });
});
