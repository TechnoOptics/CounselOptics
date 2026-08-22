import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The document that goes in front of a judge must not contain an exhibit the
 * person withdrew.
 *
 * This is the end of the chain, so it is asserted at the end of the chain: the
 * real export route is driven against a fake database, and the assertion is on
 * the exhibit list `generateCasePdf` was actually handed. Everything between
 * the route and the PDF builder is real code, including `listExhibits`.
 *
 * A source-reading test would not do here. The route calls `listExhibits(id)`
 * and the safety is in that call NOT carrying an option, and a test that
 * matches on absent text passes for the wrong reasons the moment the line
 * moves. This one fails if any part of the path starts including withdrawn
 * rows, however that comes about.
 *
 * Mutations that turn it red are recorded at the bottom of this file.
 */

const SIGNED_IN = 'user-1';

const h = vi.hoisted(() => {
  const rows: { current: Array<Record<string, unknown>> } = { current: [] };
  /** The exhibits argument of every generateCasePdf call, in order. */
  const pdfCalls: Array<Array<{ label: string }>> = [];

  function makeServer() {
    return {
      from: (table: string) => ({
        select: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            order: () => node,
            limit: () => node,
            maybeSingle: async () => {
              if (table === 'cases') {
                return {
                  data: {
                    id: 'case-1',
                    user_id: SIGNED_IN,
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
              return { data: null, error: null };
            },
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ data: table === 'exhibits' ? rows.current : [], error: null }),
          };
          return node;
        },
      }),
    };
  }

  return { rows, pdfCalls, makeServer };
});

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: SIGNED_IN, email: 'a@example.com' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => h.makeServer(),
  requireUser: async () => ({ id: SIGNED_IN }),
}));

// The real listExhibits and the real getCase are kept, because they are the
// code under test. Only the surrounding lookups are stubbed.
vi.mock('../lib/storage', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return {
    ...actual,
    getProfile: async () => null,
    getLatestReview: async () => null,
    getCurrentSubscription: async () => null,
    getEffectiveTrialState: async () => null,
  };
});

vi.mock('../lib/user-trials', () => ({ currentUserTrialGrant: async () => undefined }));

vi.mock('../lib/pdf', () => ({
  generateCasePdf: async (input: { exhibits: Array<{ label: string }> }) => {
    h.pdfCalls.push(input.exhibits);
    return Buffer.from('%PDF-1.4 fake');
  },
}));

const { GET } = await import('../app/cases/[id]/export/route');

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ex-1',
    case_id: 'case-1',
    user_id: SIGNED_IN,
    label: 'Exhibit A',
    file_name: 'file.pdf',
    storage_path: 'user-1/case-1/ex-1.pdf',
    file_type: 'application/pdf',
    file_size: 1000,
    description: '',
    incident_date: null,
    source: null,
    category: null,
    scan_data: null,
    uploaded_at: '2026-08-01T00:00:00.000Z',
    withdrawn_at: null,
    ...over,
  };
}

describe('the exported packet', () => {
  beforeEach(() => {
    h.pdfCalls.length = 0;
    h.rows.current = [];
  });

  it('leaves out an exhibit the person withdrew, and keeps the rest', async () => {
    // The real shape from the case that prompted this: a July statement filed
    // twice, once as P and once as S, and the second copy withdrawn.
    h.rows.current = [
      row({ id: 'ex-p', label: 'Exhibit P', file_name: 'July Statement.pdf' }),
      row({ id: 'ex-q', label: 'Exhibit Q' }),
      row({
        id: 'ex-s',
        label: 'Exhibit S',
        file_name: 'July Statement.pdf',
        withdrawn_at: '2026-08-22T10:00:00.000Z',
      }),
    ];

    const res = await GET(new Request('http://localhost/x'), {
      params: { id: 'case-1' },
    });
    expect(res.status).toBe(200);

    expect(h.pdfCalls).toHaveLength(1);
    const labels = h.pdfCalls[0].map((e) => e.label);
    expect(labels).toEqual(['Exhibit P', 'Exhibit Q']);
    expect(labels).not.toContain('Exhibit S');
  });

  it('leaves the labels of the exhibits that remain exactly as they were', async () => {
    // The reason withdrawal is not a delete. P is still P after S goes.
    h.rows.current = [
      row({ id: 'ex-p', label: 'Exhibit P' }),
      row({ id: 'ex-s', label: 'Exhibit S', withdrawn_at: '2026-08-22T10:00:00.000Z' }),
      row({ id: 'ex-t', label: 'Exhibit T' }),
    ];

    await GET(new Request('http://localhost/x'), { params: { id: 'case-1' } });
    expect(h.pdfCalls[0].map((e) => e.label)).toEqual(['Exhibit P', 'Exhibit T']);
  });

  it('still builds a packet when nothing is withdrawn', async () => {
    // So the test above cannot pass by the packet being empty, or by the
    // export route having stopped working.
    h.rows.current = [row({ id: 'ex-a', label: 'Exhibit A' })];
    await GET(new Request('http://localhost/x'), { params: { id: 'case-1' } });
    expect(h.pdfCalls[0].map((e) => e.label)).toEqual(['Exhibit A']);
  });

  it('builds a packet on a database that has no withdrawn_at column yet', async () => {
    const pre = row({ id: 'ex-a', label: 'Exhibit A' });
    delete (pre as Record<string, unknown>).withdrawn_at;
    h.rows.current = [pre];
    const res = await GET(new Request('http://localhost/x'), {
      params: { id: 'case-1' },
    });
    expect(res.status).toBe(200);
    expect(h.pdfCalls[0].map((e) => e.label)).toEqual(['Exhibit A']);
  });
});

/**
 * MUTATIONS RUN AGAINST THIS FILE, and what each one turned red.
 *
 *   Change the route to `listExhibits(caseRecord.id, { includeWithdrawn: true })`:
 *   "leaves out an exhibit the person withdrew" and "leaves the labels of the
 *   exhibits that remain" both go red.
 *
 *   Remove the `activeExhibits` filter inside listExhibits: the same two go
 *   red.
 *
 *   Make listExhibits filter unconditionally, ignoring the option: "still
 *   builds a packet when nothing is withdrawn" stays green and the case page
 *   loses its marked rows, which is why the option is asserted separately in
 *   tests/exhibit-edit-and-withdraw-authorization.test.ts.
 */
