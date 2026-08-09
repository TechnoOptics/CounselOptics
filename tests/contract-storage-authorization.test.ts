import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who a contract action is allowed to act for, and in what order.
 *
 * Three defects lived in lib/contracts-actions.ts:
 *
 *   - uploadContractAction took `firmId` from its arguments and wrote the file
 *     into that firm's prefix before anything had checked the caller belonged
 *     to it. Bytes landed first, questions afterwards.
 *   - deleteContractAction deleted by id alone, with no owner named anywhere.
 *   - reviewContractAction pulled the contract bytes with the SERVICE-ROLE
 *     client off `file_path`, a plain column, after nothing but an RLS read.
 *     A caller could store any path in a row of their own and have the service
 *     role fetch someone else's document and read it back to them as a summary.
 *
 * The fakes below deliberately model NO neighbouring gate:
 *
 *   - every `.eq()` is a no-op, so RLS is effectively off on rows and cannot be
 *     what refuses;
 *   - the storage fakes accept every path, so storage policy cannot be what
 *     refuses;
 *   - the row handed back always exists and always carries whatever owner and
 *     path the scenario asks for, so "not found" cannot be what refuses.
 *
 * What is left standing is the membership check, the ownership check and the
 * path check inside each action.
 *
 * Mutations that turn them red:
 *   - drop the firm gate from uploadContractAction: "refuses a caller who is
 *     not in the firm they named" goes red.
 *   - move that gate below the upload: "writes no bytes at all for a caller
 *     outside the firm" goes red.
 *   - drop the entitlement check from reviewContractAction: "refuses to review
 *     a firm contract for a caller outside that firm" goes red.
 *   - drop the path check from reviewContractAction: "refuses a file_path that
 *     points outside the owner prefix" and "refuses a consumer file_path that
 *     names another persons vault" go red.
 *   - drop the entitlement check from deleteContractAction: "refuses to delete
 *     a firm contract for a caller outside that firm" goes red.
 *   - drop the zero-row check from deleteContractAction: "reports a delete that
 *     matched nothing as a failure" goes red.
 *   - loosen either prefix test to a substring match: "refuses a path that
 *     merely mentions the owner" goes red.
 *
 * None can be satisfied by deleting the work they guard: the happy paths assert
 * the upload, the download and the row delete all still happen.
 */

const MY_FIRM = 'firm-mine';
const OTHER_FIRM = 'firm-theirs';
const ME = 'user-1';
const SOMEONE_ELSE = 'user-2';

type ContractRow = {
  id: string;
  user_id: string | null;
  firm_id: string | null;
  file_path: string | null;
};

type Scenario = {
  /** Firms the fake reports the caller as a member of. */
  memberOf: string[];
  /** The row every read of user_contracts hands back. */
  contract: ContractRow;
  /** Rows the fake reports a delete or update as having affected. */
  affected: number;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: {
      memberOf: [],
      contract: { id: 'c-1', user_id: 'user-1', firm_id: null, file_path: null },
      affected: 1,
    },
  };
  const calls: string[] = [];

  function rowFor(table: string) {
    if (table === 'firm_members') {
      return s.current.memberOf.length > 0 ? { role: 'attorney' } : null;
    }
    return {
      ...s.current.contract,
      name: 'ACME NDA',
      contract_type: 'nda',
      custom_type: null,
      parties: [],
      jurisdiction: null,
      notes: null,
      tags: [],
    };
  }

  function storage(label: string) {
    return {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          calls.push(`${label}-upload:${bucket}:${path}`);
          return { error: null };
        },
        download: async (path: string) => {
          calls.push(`${label}-download:${bucket}:${path}`);
          return {
            data: { arrayBuffer: async () => new TextEncoder().encode('CONTRACT BODY').buffer },
            error: null,
          };
        },
      }),
    };
  }

  function makeServer() {
    return {
      storage: storage('user'),
      from: (table: string) => {
        const rows = () =>
          Array.from({ length: s.current.affected }, () => ({ id: s.current.contract.id }));
        return {
          select: () => {
            // Filters are no-ops on purpose: RLS is not modelled here.
            const node: Record<string, unknown> = {
              eq: () => node,
              maybeSingle: async () => {
                calls.push(`read:${table}`);
                return { data: rowFor(table), error: null };
              },
            };
            return node;
          },
          insert: () => ({
            select: () => ({
              single: async () => {
                calls.push(`insert:${table}`);
                return { data: { id: 'c-new' }, error: null };
              },
            }),
          }),
          update: () => {
            const node: Record<string, unknown> = {
              eq: () => node,
              select: () => {
                calls.push(`update:${table}`);
                return Promise.resolve({ data: rows(), error: null });
              },
              then: (resolve: (v: unknown) => unknown) => {
                calls.push(`update:${table}`);
                return resolve({ data: null, error: null });
              },
            };
            return node;
          },
          delete: () => {
            const node: Record<string, unknown> = {
              eq: () => node,
              select: () => {
                calls.push(`row-delete:${table}`);
                return Promise.resolve({ data: rows(), error: null });
              },
              // The unselected shape the vulnerable code used: resolves clean
              // with nothing to inspect.
              then: (resolve: (v: unknown) => unknown) => {
                calls.push(`row-delete:${table}`);
                return resolve({ data: null, error: null });
              },
            };
            return node;
          },
        };
      },
    };
  }

  function makeAdmin() {
    return { storage: storage('admin') };
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

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({
        model: 'test-model',
        content: [
          {
            type: 'text',
            text: '{"summary":"s","confidence":80,"pros":[],"cons":[],"suggestions":[]}',
          },
        ],
      }),
    };
  },
}));

const { uploadContractAction, reviewContractAction, deleteContractAction } =
  await import('../lib/contracts-actions');

/** Every call the fakes saw that actually touched Supabase Storage. */
function storageCalls(): string[] {
  return h.calls.filter((c) => c.includes('-upload:') || c.includes('-download:'));
}

function uploadForm(): FormData {
  const fd = new FormData();
  fd.set('contractType', 'nda');
  fd.set('name', 'ACME NDA');
  fd.set(
    'file',
    new File([new Uint8Array(Buffer.from('%PDF-1.4\nbody\n'))], 'nda.pdf', {
      type: 'application/pdf',
    }),
  );
  return fd;
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.current = {
    memberOf: [MY_FIRM],
    contract: { id: 'c-1', user_id: ME, firm_id: null, file_path: null },
    affected: 1,
  };
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('uploadContractAction', () => {
  it('stores a firm contract under that firm prefix for a member', async () => {
    const res = await uploadContractAction(uploadForm(), { firmId: MY_FIRM });
    expect(res.ok).toBe(true);
    const uploads = storageCalls();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain(`:firm-documents:${MY_FIRM}/contracts/`);
  });

  it('refuses a caller who is not in the firm they named', async () => {
    h.s.current.memberOf = [];
    const res = await uploadContractAction(uploadForm(), { firmId: OTHER_FIRM });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    // And the refusal really is the membership check: the fake was asked.
    expect(h.calls).toContain('read:firm_members');
  });

  it('writes no bytes at all for a caller outside the firm', async () => {
    h.s.current.memberOf = [];
    await uploadContractAction(uploadForm(), { firmId: OTHER_FIRM });
    // Nothing landed in the other firm's prefix, and no row was registered.
    expect(storageCalls()).toEqual([]);
    expect(h.calls).not.toContain('insert:user_contracts');
  });

  it('still lets a person upload to their own vault', async () => {
    h.s.current.memberOf = [];
    const res = await uploadContractAction(uploadForm(), {});
    expect(res.ok).toBe(true);
    expect(storageCalls()[0]).toContain(`:user-vault:${ME}/contracts/`);
  });
});

describe('reviewContractAction', () => {
  it('reads the file of a contract the caller owns', async () => {
    h.s.current.contract = {
      id: 'c-1',
      user_id: ME,
      firm_id: null,
      file_path: `${ME}/contracts/abc/nda.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(true);
    // The download still happens, so no guard here can be satisfied by
    // removing the thing it guards.
    expect(storageCalls()).toEqual([`admin-download:user-vault:${ME}/contracts/abc/nda.pdf`]);
  });

  it('refuses to review a firm contract for a caller outside that firm', async () => {
    h.s.current.memberOf = [];
    h.s.current.contract = {
      id: 'c-1',
      user_id: null,
      firm_id: OTHER_FIRM,
      file_path: `${OTHER_FIRM}/contracts/abc/nda.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    expect(storageCalls()).toEqual([]);
    // The row read returned a row, so "not found" is not what refused.
    expect(h.calls).toContain('read:user_contracts');
  });

  it('refuses a file_path that points outside the owner prefix', async () => {
    // The row is the caller's own firm's, so every ownership check passes.
    // Only the path betrays it.
    h.s.current.contract = {
      id: 'c-1',
      user_id: null,
      firm_id: MY_FIRM,
      file_path: `${OTHER_FIRM}/contracts/abc/privileged.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not belong to this contract/i);
    expect(storageCalls()).toEqual([]);
  });

  it('refuses a consumer file_path that names another persons vault', async () => {
    h.s.current.contract = {
      id: 'c-1',
      user_id: ME,
      firm_id: null,
      file_path: `${SOMEONE_ELSE}/contracts/abc/divorce.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
  });

  it('refuses a path that merely mentions the owner', async () => {
    h.s.current.contract = {
      id: 'c-1',
      user_id: ME,
      firm_id: null,
      file_path: `${SOMEONE_ELSE}/contracts/${ME}/leak.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
  });

  it('refuses a traversal segment inside a matching prefix', async () => {
    h.s.current.contract = {
      id: 'c-1',
      user_id: ME,
      firm_id: null,
      file_path: `${ME}/contracts/../../${SOMEONE_ELSE}/contracts/x.pdf`,
    };
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(storageCalls()).toEqual([]);
  });

  it('refuses to claim a review it could not store', async () => {
    h.s.current.contract = { id: 'c-1', user_id: ME, firm_id: null, file_path: null };
    h.s.current.affected = 0;
    const res = await reviewContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be saved/i);
  });
});

describe('deleteContractAction', () => {
  it('deletes a contract the caller owns', async () => {
    const res = await deleteContractAction('c-1');
    expect(res.ok).toBe(true);
    expect(h.calls).toContain('row-delete:user_contracts');
  });

  it('refuses to delete a firm contract for a caller outside that firm', async () => {
    h.s.current.memberOf = [];
    h.s.current.contract = { id: 'c-1', user_id: null, firm_id: OTHER_FIRM, file_path: null };
    const res = await deleteContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/do not have access to this firm/i);
    // Nothing irreversible was even attempted.
    expect(h.calls).not.toContain('row-delete:user_contracts');
  });

  it('refuses to delete another persons contract', async () => {
    h.s.current.contract = { id: 'c-1', user_id: SOMEONE_ELSE, firm_id: null, file_path: null };
    const res = await deleteContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(h.calls).not.toContain('row-delete:user_contracts');
  });

  it('reports a delete that matched nothing as a failure', async () => {
    h.s.current.affected = 0;
    const res = await deleteContractAction('c-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not be deleted/i);
  });
});
