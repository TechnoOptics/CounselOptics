import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What an exhibit edit and a withdrawal are actually allowed to do.
 *
 * These are BEHAVIOURAL. They drive the real `listExhibits`,
 * `updateExhibitDetails`, `setExhibitWithdrawn`, `updateExhibitDetailsAction`
 * and `setExhibitWithdrawnAction` against fake Supabase clients, and assert on
 * the statements those clients received: which table, which columns, and
 * whether a statement was reached at all. No source text is matched, so no
 * comment, no import line and no neighbouring string can satisfy them.
 *
 * Four things could put a wrong document, a wrong label or a wrong date in
 * front of a judge, and each has a test here:
 *
 *   a withdrawn exhibit coming back into the packet
 *   an edit reaching the file bytes or the label
 *   somebody editing an exhibit on a case they do not own
 *   a withdrawal reporting success when nothing was written
 *
 * Mutations that turn them red are recorded at the bottom of this file.
 */

type Scenario = {
  /** Rows the fake returns for a select on `exhibits`. */
  exhibitRows: Array<Record<string, unknown>>;
  /** The owner of the case the fake reports. */
  caseOwner: string;
  /** Rows an UPDATE reports as affected. Empty models an RLS filter. */
  updated: Array<{ id: string }>;
  /** An error the fake returns from an UPDATE instead of data. */
  updateError: { code?: string; message?: string } | null;
};

const SIGNED_IN = 'user-1';

const h = vi.hoisted(() => {
  const s: { current: Record<string, unknown> } = { current: {} };
  const calls: string[] = [];
  /** Every payload an UPDATE on `exhibits` was handed, in order. */
  const updatePayloads: Array<Record<string, unknown>> = [];

  function scenario() {
    return s.current as {
      exhibitRows: Array<Record<string, unknown>>;
      caseOwner: string;
      updated: Array<{ id: string }>;
      updateError: { code?: string; message?: string } | null;
    };
  }

  function makeServer() {
    return {
      from: (table: string) => ({
        select: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            order: () => node,
            limit: () => node,
            maybeSingle: async () => {
              calls.push(`select:${table}`);
              if (table === 'cases') {
                return {
                  data: {
                    id: 'case-1',
                    user_id: scenario().caseOwner,
                    title: 'A case',
                    subject_name: 'Someone',
                    subject_type: 'person',
                    subject_profile: {},
                    jurisdiction_country: 'United States',
                    jurisdiction_state: null,
                    jurisdiction_city: null,
                    case_type: 'Civil dispute',
                    description: '',
                    description_history: [],
                    posture: 'claimant',
                    status: 'open',
                    hearing_at: null,
                    hearing_location: null,
                    hearing_notes: null,
                    created_at: '2026-01-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                  },
                  error: null,
                };
              }
              if (table === 'exhibits') {
                return { data: scenario().exhibitRows[0] ?? null, error: null };
              }
              return { data: null, error: null };
            },
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`select:${table}`);
              return resolve({ data: scenario().exhibitRows, error: null });
            },
          };
          return node;
        },
        update: (payload: Record<string, unknown>) => {
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              calls.push(`update:${table}`);
              if (table === 'exhibits') updatePayloads.push(payload);
              const sc = scenario();
              if (sc.updateError) {
                return Promise.resolve({ data: null, error: sc.updateError });
              }
              return Promise.resolve({ data: sc.updated, error: null });
            },
            // Awaiting the builder without selecting is the unconfirmed shape.
            // It resolves clean with nothing to inspect, so removing
            // `.select('id')` fails the assertions rather than the harness.
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`update:${table}`);
              if (table === 'exhibits') updatePayloads.push(payload);
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  return { s, calls, updatePayloads, makeServer };
});

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: SIGNED_IN, email: 'a@example.com' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => h.makeServer(),
  requireUser: async () => ({ id: SIGNED_IN }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock('../lib/activity', () => ({
  logCaseEvent: async () => {},
  listCaseAuditEvents: async () => [],
}));

const { listExhibits, setExhibitWithdrawn, updateExhibitDetails } = await import(
  '../lib/storage'
);
const { setExhibitWithdrawnAction, updateExhibitDetailsAction } = await import(
  '../lib/actions'
);

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ex-1',
    case_id: 'case-1',
    user_id: SIGNED_IN,
    label: 'Exhibit K',
    file_name: 'July Statement.pdf',
    storage_path: 'user-1/case-1/ex-1.pdf',
    file_type: 'application/pdf',
    file_size: 1_705_941,
    description: 'The July statement',
    incident_date: null,
    source: null,
    category: null,
    scan_data: null,
    uploaded_at: '2026-08-01T00:00:00.000Z',
    withdrawn_at: null,
    ...over,
  };
}

function reset(over: Partial<Scenario> = {}) {
  h.calls.length = 0;
  h.updatePayloads.length = 0;
  h.s.current = {
    exhibitRows: [row()],
    caseOwner: SIGNED_IN,
    updated: [{ id: 'ex-1' }],
    updateError: null,
    ...over,
  };
}

function updateCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('update:'));
}

describe('a withdrawn exhibit is not in what builds the packet', () => {
  beforeEach(() => reset());

  it('is left out of listExhibits by default', async () => {
    h.s.current = {
      ...(h.s.current as object),
      exhibitRows: [
        row({ id: 'ex-p', label: 'Exhibit P' }),
        row({
          id: 'ex-s',
          label: 'Exhibit S',
          withdrawn_at: '2026-08-22T10:00:00.000Z',
        }),
      ],
    } as Record<string, unknown>;

    const got = await listExhibits('case-1');
    expect(got.map((e) => e.label)).toEqual(['Exhibit P']);
  });

  it('is returned only when a caller explicitly asks for it', async () => {
    h.s.current = {
      ...(h.s.current as object),
      exhibitRows: [
        row({ id: 'ex-p', label: 'Exhibit P' }),
        row({
          id: 'ex-s',
          label: 'Exhibit S',
          withdrawn_at: '2026-08-22T10:00:00.000Z',
        }),
      ],
    } as Record<string, unknown>;

    const got = await listExhibits('case-1', { includeWithdrawn: true });
    expect(got.map((e) => e.label)).toEqual(['Exhibit P', 'Exhibit S']);
    // And the withdrawal itself survives the read, so the page can mark it.
    expect(got[1].withdrawnAt).toBe('2026-08-22T10:00:00.000Z');
  });

  it('reads a row with no withdrawn_at column at all as still in use', async () => {
    // The pre-migration shape. `select('*')` returns a row without the field.
    const noColumn = row();
    delete (noColumn as Record<string, unknown>).withdrawn_at;
    h.s.current = {
      ...(h.s.current as object),
      exhibitRows: [noColumn],
    } as Record<string, unknown>;

    const got = await listExhibits('case-1');
    expect(got).toHaveLength(1);
    expect(got[0].withdrawnAt).toBeNull();
  });
});

describe('an edit cannot reach the evidence or the label', () => {
  beforeEach(() => reset());

  it('sends exactly the four detail columns to the database', async () => {
    const fd = new FormData();
    fd.set('description', 'The July statement, second copy');
    fd.set('incidentDate', '2026-07-05');
    fd.set('source', 'Bank portal');
    fd.set('category', 'Document');

    const res = await updateExhibitDetailsAction('ex-1', fd);
    expect(res.ok).toBe(true);

    expect(h.updatePayloads).toHaveLength(1);
    expect(Object.keys(h.updatePayloads[0]).sort()).toEqual([
      'category',
      'description',
      'incident_date',
      'source',
    ]);
  });

  it('never names the label, the path, or any file column', async () => {
    const fd = new FormData();
    // Everything an attacker or a stray form field could try to smuggle in.
    fd.set('description', 'x');
    fd.set('label', 'Exhibit A');
    fd.set('storage_path', 'someone-else/case/file.pdf');
    fd.set('storagePath', 'someone-else/case/file.pdf');
    fd.set('file_name', 'different.pdf');
    fd.set('fileName', 'different.pdf');
    fd.set('file_size', '1');
    fd.set('file_type', 'text/html');
    fd.set('scan_data', '{}');
    fd.set('case_id', 'case-2');
    fd.set('user_id', 'user-2');
    fd.set('id', 'ex-9');

    const res = await updateExhibitDetailsAction('ex-1', fd);
    expect(res.ok).toBe(true);

    const payload = h.updatePayloads[0];
    for (const forbidden of [
      'label',
      'storage_path',
      'storagePath',
      'file_name',
      'fileName',
      'file_size',
      'file_type',
      'scan_data',
      'case_id',
      'user_id',
      'id',
    ]) {
      expect(Object.keys(payload)).not.toContain(forbidden);
    }
    // And the edit really did happen, so this cannot pass by the write being
    // removed altogether.
    expect(payload.description).toBe('x');
  });

  it('stores a stated date as a bare calendar day, not a timestamp', async () => {
    // A DATE column. Anything with a time on it is what makes a stated day
    // print as the day before in a United States timezone.
    const fd = new FormData();
    fd.set('description', '');
    fd.set('incidentDate', '2026-07-05');
    await updateExhibitDetailsAction('ex-1', fd);
    expect(h.updatePayloads[0].incident_date).toBe('2026-07-05');
  });

  it('refuses a date that names no specific day, and writes nothing', async () => {
    const fd = new FormData();
    fd.set('incidentDate', 'July 2026');
    const res = await updateExhibitDetailsAction('ex-1', fd);
    expect(res.ok).toBe(false);
    expect(updateCalls()).toEqual([]);
  });

  it('a withdrawal writes only withdrawn_at', async () => {
    const res = await setExhibitWithdrawnAction('ex-1', true);
    expect(res.ok).toBe(true);
    expect(h.updatePayloads).toHaveLength(1);
    expect(Object.keys(h.updatePayloads[0])).toEqual(['withdrawn_at']);
    expect(typeof h.updatePayloads[0].withdrawn_at).toBe('string');
  });

  it('putting an exhibit back clears the column and touches nothing else', async () => {
    const res = await setExhibitWithdrawnAction('ex-1', false);
    expect(res.ok).toBe(true);
    expect(Object.keys(h.updatePayloads[0])).toEqual(['withdrawn_at']);
    expect(h.updatePayloads[0].withdrawn_at).toBeNull();
  });
});

describe('who may change an exhibit', () => {
  it('refuses an edit on a case the caller does not own, and writes nothing', async () => {
    reset({ caseOwner: 'somebody-else' });
    const fd = new FormData();
    fd.set('description', 'changed by a stranger');

    const res = await updateExhibitDetailsAction('ex-1', fd);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only the person who opened this case/i);
    // The point of the test: no statement reached the database at all.
    expect(updateCalls()).toEqual([]);
    expect(h.updatePayloads).toEqual([]);
    // And the refusal came from the ownership check, not from the action
    // never getting as far as reading the case.
    expect(h.calls).toContain('select:cases');
  });

  it('refuses a withdrawal on a case the caller does not own', async () => {
    reset({ caseOwner: 'somebody-else' });
    const res = await setExhibitWithdrawnAction('ex-1', true);
    expect(res.ok).toBe(false);
    expect(updateCalls()).toEqual([]);
  });

  it('lets the owner through, so the refusal above is about ownership', async () => {
    reset({ caseOwner: SIGNED_IN });
    const res = await setExhibitWithdrawnAction('ex-1', true);
    expect(res.ok).toBe(true);
    expect(updateCalls()).toEqual(['update:exhibits']);
  });

  it('refuses an exhibit id that does not resolve', async () => {
    reset();
    h.s.current = {
      ...(h.s.current as object),
      exhibitRows: [],
    } as Record<string, unknown>;
    const res = await setExhibitWithdrawnAction('ex-nope', true);
    expect(res.ok).toBe(false);
    expect(updateCalls()).toEqual([]);
  });
});

describe('a write that did not land is not reported as one that did', () => {
  it('treats a zero-row update as a failure', async () => {
    // RLS filtered the row out. postgrest-js calls that a success with no
    // error, so the affected rows are the only thing that can tell them apart.
    reset({ updated: [] });
    const out = await updateExhibitDetails({
      exhibitId: 'ex-1',
      details: {
        description: 'x',
        incidentDate: null,
        source: null,
        category: null,
      },
    });
    expect(out.ok).toBe(false);
  });

  it('treats a zero-row withdrawal as a failure', async () => {
    reset({ updated: [] });
    const out = await setExhibitWithdrawn({ exhibitId: 'ex-1', withdrawn: true });
    expect(out.ok).toBe(false);
  });

  it('refuses plainly when the column is not there yet', async () => {
    reset({
      updateError: {
        code: 'PGRST204',
        message: "Could not find the 'withdrawn_at' column of 'exhibits'",
      },
    });
    const out = await setExhibitWithdrawn({ exhibitId: 'ex-1', withdrawn: true });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/was not withdrawn/i);
    expect(out.error).toMatch(/still/i);
  });

  it('surfaces the refusal to the person rather than a digest', async () => {
    reset({
      updateError: {
        code: 'PGRST204',
        message: "Could not find the 'withdrawn_at' column of 'exhibits'",
      },
    });
    const res = await setExhibitWithdrawnAction('ex-1', true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/was not withdrawn/i);
  });

  it('does not swallow an unrelated database failure', async () => {
    reset({
      updateError: { code: '42501', message: 'permission denied for table exhibits' },
    });
    const res = await setExhibitWithdrawnAction('ex-1', true);
    expect(res.ok).toBe(false);
    // Calm copy, not the PostgREST string, and definitely not a success.
    expect(res.error).toMatch(/nothing was changed/i);
    expect(res.error).not.toMatch(/permission denied/i);
  });
});

/**
 * MUTATIONS RUN AGAINST THIS FILE, and what each one turned red.
 *
 *   Remove the `activeExhibits` filter from listExhibits so it returns every
 *   row: "is left out of listExhibits by default" goes red.
 *
 *   Make `includeWithdrawn` the default rather than the opt-in: same test
 *   goes red, which is the point, because that inversion is the one a future
 *   edit is most likely to make.
 *
 *   Add `label: 'whatever'` to the object buildExhibitDetailsPatch returns:
 *   "sends exactly the four detail columns" and "never names the label, the
 *   path, or any file column" both go red.
 *
 *   Have updateExhibitDetails write its own object literal including
 *   storage_path instead of calling buildExhibitDetailsPatch: the same two go
 *   red.
 *
 *   Return `parsed.iso + 'T00:00:00.000Z'` from normalizeExhibitDetails:
 *   "stores a stated date as a bare calendar day" goes red here, and "reads
 *   back as the fifth, all the way to the printed page" goes red in
 *   tests/exhibit-withdrawal.test.ts under America/Chicago.
 *
 *   Drop the `loadOwnedCase` call from loadOwnedExhibit: all three tests under
 *   "who may change an exhibit" that expect a refusal go red.
 *
 *   Drop `.select('id')` from either update: the fake resolves the awaited
 *   builder with data null, which is the unconfirmed shape, and both
 *   "zero-row" tests go red.
 *
 *   Return `{ ok: true }` from setExhibitWithdrawn on a missing column instead
 *   of the refusal: "refuses plainly when the column is not there yet" and
 *   "surfaces the refusal to the person" go red.
 */
