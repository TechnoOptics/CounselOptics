import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which file the new-case wizard is allowed to copy into a case.
 *
 * attachSelectedEvidence read `file_path` off user_receipts / user_contracts
 * with the SERVICE-ROLE client, filtered by `.eq('user_id', user.id)`, and
 * downloaded whatever string came back. The comment on that filter said
 * "ownership: only the caller's own items", which is true of the ROW and false
 * of the PATH. `file_path` is a plain column that no insert policy constrains,
 * so a person could store a stranger's vault path on a row of their own and
 * have the service role copy that document into their case as an exhibit.
 *
 * The fakes model NO neighbouring gate. Every `.eq()` is a no-op, so the
 * `user_id` filter cannot be what refuses; the row always exists; and the
 * storage fake serves every path it is asked for, so storage policy cannot be
 * what refuses. Only the prefix check is left standing.
 *
 * Order and outcome are asserted separately, because they are different claims
 * and only one of them was ever the bug. A guard placed after the download
 * would still "refuse" the item while the bytes had already been fetched, so
 * every refusal case asserts BOTH that nothing was downloaded AND that nothing
 * was added as an exhibit.
 *
 * Mutations that turn them red:
 *   - drop the isOwnVaultPath check: "refuses a receipt path in another
 *     persons vault", "refuses a contract path in another persons vault",
 *     "refuses a firm-owned contract path" and "refuses a path that merely
 *     mentions the owner" all go red.
 *   - move that check below the download: the same four go red, because they
 *     assert on the download and not only on the exhibit.
 *   - use the receipts prefix for contracts (or the reverse): "attaches a
 *     receipt the person really owns" or "attaches a contract the person
 *     really owns" goes red, which is the false-reject direction.
 *   - loosen the prefix to a substring match: "refuses a path that merely
 *     mentions the owner" goes red.
 *   - drop the traversal rejection: "refuses a traversal segment inside a
 *     matching prefix" goes red.
 *   - drop the `missed` notification: "tells the person when an item did not
 *     attach" goes red.
 *   - notify unconditionally rather than on missed > 0: "says nothing when
 *     every item attached" goes red.
 *
 * None can be satisfied by removing the copy: the happy paths assert the
 * download and the addExhibit both still happen.
 */

const ME = 'user-1';
const SOMEONE_ELSE = 'user-2';
const A_FIRM = 'firm-1';

type Scenario = {
  /** The row every read of user_receipts / user_contracts hands back. */
  receipt: { file_path: string | null; label: string | null };
  contract: { file_path: string | null; name: string | null; firm_id: string | null };
  /** When set, addExhibit REFUSES with this reason instead of accepting. */
  refusal?: string;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: {
      receipt: { file_path: 'user-1/receipts/r1/photo.jpg', label: 'Photo' },
      contract: { file_path: 'user-1/contracts/c1/nda.pdf', name: 'NDA', firm_id: null },
    },
  };
  const calls: string[] = [];

  function makeAdmin() {
    return {
      from: (table: string) => ({
        select: () => {
          const node: Record<string, unknown> = {
            // No-ops: RLS and the user_id filter are not modelled, so neither
            // can be what refuses.
            eq: () => node,
            maybeSingle: async () => {
              calls.push(`read:${table}`);
              return {
                data: table === 'user_receipts' ? s.current.receipt : s.current.contract,
                error: null,
              };
            },
          };
          return node;
        },
      }),
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            calls.push(`download:${bucket}:${path}`);
            return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
          },
        }),
      },
    };
  }

  function makeServer() {
    return {
      from: () => {
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          neq: () => node,
          or: () => node,
          limit: () => node,
          maybeSingle: async () => ({ data: null, error: null, count: 0 }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: null, count: 0 }),
        };
        return node;
      },
    };
  }

  return { s, calls, makeAdmin, makeServer };
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

vi.mock('../lib/storage', () => ({
  usingSupabase: () => true,
  createCase: async () => ({ id: 'case-new' }),
  // addExhibit answers `{ ok, exhibit } | { ok: false, error }` so a refusal
  // can survive the Server Action boundary as a value. `h.s.current.refusal`
  // lets a test make it refuse without throwing.
  addExhibit: async (input: { description?: string }) => {
    if (h.s.current.refusal) return { ok: false, error: h.s.current.refusal };
    h.calls.push(`exhibit:${input.description ?? ''}`);
    return { ok: true, exhibit: { id: 'exhibit-1', label: 'Exhibit A' } };
  },
  getCurrentSubscription: async () => null,
  getEffectiveTrialState: async () => ({ mode: 'active' }),
  getCase: async () => null,
}));

vi.mock('../lib/tier', () => ({
  caseLimit: () => null,
  hasFeature: () => true,
  isFullAccessTrial: () => true,
}));

vi.mock('../lib/user-trials', () => ({
  currentUserTrialGrant: async () => undefined,
}));

vi.mock('../lib/activity', () => ({ logCaseEvent: async () => {} }));

vi.mock('../lib/ai', () => ({
  classifyCaseType: async () => null,
  runReview: async () => ({}),
  scanDocument: async () => ({}),
  transcribeMedia: async () => ({}),
}));

vi.mock('../lib/notifications', () => ({
  createNotification: async (input: { title: string }) => {
    h.calls.push(`notify:${input.title}`);
    return null;
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('next/navigation', () => ({
  redirect: () => {
    h.calls.push('redirect');
  },
}));

const { createCaseAction } = await import('../lib/actions');

/** Every call the fakes saw that actually fetched bytes. */
function downloads(): string[] {
  return h.calls.filter((c) => c.startsWith('download:'));
}

/** Every exhibit the case actually gained. */
function exhibits(): string[] {
  return h.calls.filter((c) => c.startsWith('exhibit:'));
}

function notifications(): string[] {
  return h.calls.filter((c) => c.startsWith('notify:'));
}

function newCaseForm(attached: Array<{ id: string; source: 'vault' | 'contract' }>): FormData {
  const fd = new FormData();
  fd.set('title', 'A matter');
  fd.set('subjectName', 'A person');
  fd.set('country', 'US');
  fd.set('caseType', 'Other');
  // Skip the duplicate guard, which is not what these tests are about.
  fd.set('force', '1');
  fd.set('attachedItems', JSON.stringify(attached));
  return fd;
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.current = {
    receipt: { file_path: `${ME}/receipts/r1/photo.jpg`, label: 'Photo' },
    contract: { file_path: `${ME}/contracts/c1/nda.pdf`, name: 'NDA', firm_id: null },
    refusal: undefined,
  };
});

describe('attaching a receipt the person really owns', () => {
  it('attaches a receipt the person really owns', async () => {
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    // The copy still happens, so no guard here can be satisfied by removing
    // the work it guards.
    expect(downloads()).toEqual([`download:user-vault:${ME}/receipts/r1/photo.jpg`]);
    expect(exhibits()).toHaveLength(1);
  });

  it('attaches a contract the person really owns', async () => {
    await createCaseAction(null, newCaseForm([{ id: 'c-1', source: 'contract' }]));
    expect(downloads()).toEqual([`download:user-vault:${ME}/contracts/c1/nda.pdf`]);
    expect(exhibits()).toHaveLength(1);
  });

  it('says nothing when every item attached', async () => {
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(notifications()).toEqual([]);
  });
});

describe('a planted path', () => {
  it('refuses a receipt path in another persons vault', async () => {
    h.s.current.receipt = {
      file_path: `${SOMEONE_ELSE}/receipts/r9/their-medical-record.pdf`,
      label: 'Mine, honestly',
    };
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    // Outcome: nothing was copied into the case.
    expect(exhibits()).toEqual([]);
    // Order: and nothing was fetched either, which is the separate claim. A
    // guard sitting after the download would satisfy the line above and fail
    // this one.
    expect(downloads()).toEqual([]);
    // The read really did happen and really did return the planted row, so
    // the refusal is the path check and not a row that was never found.
    expect(h.calls).toContain('read:user_receipts');
  });

  it('refuses a contract path in another persons vault', async () => {
    h.s.current.contract = {
      file_path: `${SOMEONE_ELSE}/contracts/c9/their-settlement.pdf`,
      name: 'Mine, honestly',
      firm_id: null,
    };
    await createCaseAction(null, newCaseForm([{ id: 'c-1', source: 'contract' }]));
    expect(exhibits()).toEqual([]);
    expect(downloads()).toEqual([]);
    expect(h.calls).toContain('read:user_contracts');
  });

  it('refuses a firm-owned contract path', async () => {
    // A row carrying both a user_id the filter accepts and a firm_id is not
    // something either uploader writes, and its path is in the firm bucket.
    h.s.current.contract = {
      file_path: `${A_FIRM}/contracts/c9/privileged.pdf`,
      name: 'Mine, honestly',
      firm_id: A_FIRM,
    };
    await createCaseAction(null, newCaseForm([{ id: 'c-1', source: 'contract' }]));
    expect(exhibits()).toEqual([]);
    expect(downloads()).toEqual([]);
  });

  it('refuses a path that merely mentions the owner', async () => {
    h.s.current.receipt = {
      file_path: `${SOMEONE_ELSE}/receipts/${ME}/leak.pdf`,
      label: 'Photo',
    };
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(downloads()).toEqual([]);
    expect(exhibits()).toEqual([]);
  });

  it('refuses a traversal segment inside a matching prefix', async () => {
    h.s.current.receipt = {
      file_path: `${ME}/receipts/../../${SOMEONE_ELSE}/receipts/r9/x.pdf`,
      label: 'Photo',
    };
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(downloads()).toEqual([]);
    expect(exhibits()).toEqual([]);
  });

  it('refuses a receipt path that uses the contracts prefix', async () => {
    // The two source tables do not share a layout, and the guard is per
    // source rather than one loose rule covering both.
    h.s.current.receipt = { file_path: `${ME}/contracts/c1/nda.pdf`, label: 'Photo' };
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(downloads()).toEqual([]);
    expect(exhibits()).toEqual([]);
  });
});

describe('telling the person what happened', () => {
  it('tells the person when an item did not attach', async () => {
    h.s.current.receipt = { file_path: `${SOMEONE_ELSE}/receipts/r9/x.pdf`, label: 'Photo' };
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toMatch(/one item did not attach/i);
  });

  it('counts every item that did not attach, not just the first', async () => {
    h.s.current.receipt = { file_path: `${SOMEONE_ELSE}/receipts/r9/x.pdf`, label: 'Photo' };
    h.s.current.contract = {
      file_path: `${SOMEONE_ELSE}/contracts/c9/y.pdf`,
      name: 'NDA',
      firm_id: null,
    };
    await createCaseAction(
      null,
      newCaseForm([
        { id: 'r-1', source: 'vault' },
        { id: 'c-1', source: 'contract' },
      ]),
    );
    expect(notifications()[0]).toMatch(/2 items did not attach/i);
  });

  it('one refused item does not cost the person the rest of the batch', async () => {
    h.s.current.receipt = { file_path: `${SOMEONE_ELSE}/receipts/r9/x.pdf`, label: 'Photo' };
    await createCaseAction(
      null,
      newCaseForm([
        { id: 'r-1', source: 'vault' },
        { id: 'c-1', source: 'contract' },
      ]),
    );
    // The good contract still went in.
    expect(exhibits()).toHaveLength(1);
    expect(notifications()[0]).toMatch(/one item did not attach/i);
  });

  /**
   * addExhibit used to signal a refused file by throwing, so the catch below
   * it counted the item. Now that the refusal is a RETURN value, a caller that
   * does not read `.ok` sails past it and the person is told everything
   * attached when it did not. Mutation: delete the `if (!added.ok)` block in
   * attachSelectedEvidence and this goes red.
   */
  it('counts an item addExhibit refused, even though nothing threw', async () => {
    h.s.current.refusal = 'This file is not a valid image.';
    await createCaseAction(null, newCaseForm([{ id: 'r-1', source: 'vault' }]));
    expect(exhibits()).toEqual([]);
    expect(notifications()[0]).toMatch(/one item did not attach/i);
  });
});
