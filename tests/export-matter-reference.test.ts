import { describe, expect, it, vi } from 'vitest';

/**
 * What the CASE REFERENCE row of a filed exhibit says.
 *
 * A firm matter carries a reference it can quote (MAT-0000001). Both counsel
 * exports printed a fragment of the matter's uuid instead, so an exhibit that
 * went to a court said 8B1AEE48 while every screen in the product said
 * MAT-0000001 for the same matter, and nobody could tell they were one thing.
 *
 * These tests RENDER THE PDF AND READ THE COVER. Asserting on the value handed
 * to the renderer would have passed for a build that dropped the row, and this
 * repo has already paid for that lesson once: two defects obvious on page 6 of
 * a rendered document survived 1450 green tests. unpdf is already a dependency
 * (tests/branded-document-letterhead-design.test.ts reads documents the same
 * way) and extracts the text the reader actually sees.
 *
 * Three properties, and the second and third matter as much as the first:
 *
 *   1. A numbered matter prints its reference, in both exports.
 *   2. A matter with no number still produces a document, and the fragment it
 *      falls back to is the SAME STRING the matter page shows. It is
 *      displayMatterNumber's fallback, lowercase, not a third spelling.
 *   3. The number is read in its OWN request. `cases.matter_number` arrives
 *      with 20260813_matter_number.sql, PostgREST fails the whole request when
 *      a column is absent, and the select beside it is the one that fetches
 *      the matter. On a database without the migration, naming it there would
 *      not print a worse reference, it would take the export down. So the
 *      export must survive the column not existing at all.
 */

const CASE_ID = '8b1aee48-2c11-4b0e-9a1f-6d2c1f0e77aa';
/** displayMatterNumber's fallback, and what the matter breadcrumb shows. */
const FRAGMENT = '8b1aee48';
const REFERENCE = 'MAT-0000042';

type Shape = {
  /** What `cases.matter_number` holds, when the column exists at all. */
  matterNumber: string | null;
  /** True stands in for a database that has not run the migration. */
  columnMissing?: boolean;
};

/** The error PostgREST returns for a column that is not there. */
const MISSING_COLUMN = {
  code: '42703',
  message: 'column cases.matter_number does not exist',
};

const EVENT = {
  id: 'event-1',
  caseId: CASE_ID,
  createdBy: 'user-1',
  occurredAt: '2026-03-14T16:12:00.000Z',
  occurredPrecision: 'day',
  kind: 'document',
  title: 'Notice to quit',
  description: 'Served on the tenant at the door.',
  media: [],
  sourceLabel: 'Client file',
  aiSummary: 'A notice to quit served without the statutory period.',
  aiExtracted: { relevance_score: 90, metadata: [], organizations: [], geo_points: [] },
  aiStatus: 'done',
  aiError: null,
  people: [],
  position: 1,
  createdAt: '2026-03-14T16:12:00.000Z',
  updatedAt: '2026-03-14T16:12:00.000Z',
};

const APPROACH = {
  id: 'approach-1',
  title: 'Defective notice',
  connections: null,
  firm_id: 'firm-1',
  case_id: CASE_ID,
  generated: {
    thesis: 'The notice was defective on its face.',
    argument: 'The statutory period was not observed. '.repeat(4),
    exhibits: [{ exhibit: null, title: 'Notice to quit', why: 'The notice itself.' }],
    timeline: [{ when: 'March 14, 2026', title: 'Notice served', significance: 'Starts the clock.' }],
    gaps: [],
  },
};

type Run = {
  /** Every `select(...)` string this run sent to the `cases` table, in order. */
  caseSelects: string[];
  /** The text of the rendered document, or null when nothing was rendered. */
  text: string | null;
  /**
   * The same text with every space removed. The cover's labels are drawn with
   * letter spacing, so the reader sees "CASE REFERENCE" where the extractor
   * reports "C A S E R E F E R E N C E". Squeezing the whitespace out lets an
   * assertion pin the label and its value ADJACENT to each other, which a
   * substring search over the whole document could not.
   */
  squished: string | null;
  status: number | null;
  error: string | null;
};

/**
 * Drive one export handler for real: real lib/pdf, real lib/matter-numbers,
 * real lib/ticket-numbers. Only the database, the storage bucket and the
 * authorization surrounds are stood in for.
 */
async function runExport(which: 'matter' | 'approach', shape: Shape): Promise<Run> {
  vi.resetModules();
  const caseSelects: string[] = [];

  /** A PostgREST-shaped builder: filters return itself, and it awaits. */
  function chain(result: { data: unknown; error: unknown }) {
    const builder: Record<string, unknown> = {};
    for (const method of ['eq', 'in', 'is', 'not', 'or', 'order', 'limit', 'range', 'filter']) {
      builder[method] = () => builder;
    }
    builder.select = () => builder;
    builder.maybeSingle = async () => result;
    builder.single = async () => result;
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected);
    return builder;
  }

  function casesTable() {
    const builder = chain({ data: null, error: null }) as Record<string, unknown>;
    builder.select = (columns: string) => {
      caseSelects.push(columns);
      // The number is answered ONLY by a request that asks for it by name, so
      // a handler that tried to read it off the matter row would see null here
      // and this file would fail rather than quietly pass.
      if (columns.includes('matter_number')) {
        return chain(
          shape.columnMissing
            ? { data: null, error: MISSING_COLUMN }
            : { data: { matter_number: shape.matterNumber }, error: null },
        );
      }
      return chain({
        data: {
          id: CASE_ID,
          title: 'Doe v. Roe: Unlawful Eviction',
          subject_name: 'Jane Doe',
          firm_id: 'firm-1',
          text_normalizations: null,
        },
        error: null,
      });
    };
    return builder;
  }

  vi.doMock('next/server', () => ({
    NextResponse: class {
      constructor(
        public body: unknown,
        public init?: { status?: number; headers?: Record<string, string> },
      ) {}
      static json(body: unknown, init?: { status?: number }) {
        return { status: init?.status ?? 200, body };
      }
    },
  }));
  vi.doMock('@/lib/supabase/server', () => ({
    getCurrentUser: async () => ({ id: 'user-1', email: 'attorney@example.com' }),
    createServerSupabase: () => ({
      from: () => chain({ data: { id: 'membership-1' }, error: null }),
    }),
  }));
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminSupabase: () => ({
      from: (table: string) => {
        if (table === 'cases') return casesTable();
        if (table === 'case_approaches') return chain({ data: APPROACH, error: null });
        if (table === 'profiles') {
          return chain({ data: { display_name: 'Test Attorney' }, error: null });
        }
        return chain({ data: [], error: null });
      },
      storage: {
        from: () => ({ download: async () => ({ data: null, error: { message: 'stub' } }) }),
      },
    }),
  }));
  vi.doMock('@/lib/firm-storage', () => ({
    getActiveFirmContext: async () => ({
      firm: { id: 'firm-1' },
      membership: { role: 'owner' },
    }),
  }));
  vi.doMock('@/lib/firm-trials', () => ({ firmSuspended: async () => false }));
  vi.doMock('@/lib/firm-timeline-actions', () => ({
    getFirmTimelineBundle: async () => ({ events: [EVENT], people: [], narrative: null }),
  }));
  vi.doMock('@/lib/case-activity-log', () => ({ logCaseActivity: async () => {} }));
  vi.doMock('@/lib/maps', () => ({ staticMapUrlServer: () => null }));

  const mod =
    which === 'matter'
      ? await import('@/app/counsel/cases/[id]/export/route')
      : await import('@/app/counsel/cases/[id]/approach/[approachId]/export/route');

  const res = (await mod.GET(new Request('https://advottic.com/x'), {
    params: { id: CASE_ID, approachId: 'approach-1' },
  } as never)) as { status?: number; body?: unknown; init?: { status?: number } };

  // A refusal comes back as NextResponse.json; a document comes back as the
  // constructed response, whose body is the PDF bytes.
  const body = res?.body;
  if (!(body instanceof Uint8Array)) {
    const err = (body as { error?: string } | undefined)?.error ?? null;
    return { caseSelects, text: null, squished: null, status: res?.status ?? null, error: err };
  }
  const bytes = new Uint8Array(body);
  expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  const { getDocumentProxy, extractText } = await import('unpdf');
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  const merged = String(text);
  return {
    caseSelects,
    text: merged.replace(/\s+/g, ' '),
    squished: merged.replace(/\s+/g, ''),
    status: res?.init?.status ?? 200,
    error: null,
  };
}

describe('the CASE REFERENCE printed on a counsel export', () => {
  for (const which of ['matter', 'approach'] as const) {
    it(`prints the matter's reference on the ${which} packet`, async () => {
      const run = await runExport(which, { matterNumber: REFERENCE });
      expect(run.error, 'the export refused instead of rendering').toBeNull();
      // Label and value adjacent, so this reads the actual row rather than
      // finding the reference somewhere else on the page.
      expect(run.squished).toContain(`CASEREFERENCE${REFERENCE}`);
      // The uuid fragment is what this change exists to stop printing. Upper
      // and lower, because the old code uppercased it.
      expect(run.text).not.toContain(FRAGMENT.toUpperCase());
      expect(run.text).not.toContain(FRAGMENT);
    }, 30_000);

    it(`falls back to the reference the matter page shows on the ${which} packet`, async () => {
      const run = await runExport(which, { matterNumber: null });
      expect(run.error, 'a matter with no number could not be exported').toBeNull();
      // Exactly displayMatterNumber's fallback: lowercase, the leading segment
      // of the uuid, the same string the breadcrumb and the matter list show.
      expect(run.squished).toContain(`CASEREFERENCE${FRAGMENT}`);
      expect(run.text).not.toContain(FRAGMENT.toUpperCase());
      // Never the word a null renders as, and never an empty row.
      expect(run.text).not.toContain('null');
      expect(run.text).not.toContain('undefined');
    }, 30_000);

    /**
     * The house rule, stated as a behaviour rather than a grep. A database
     * that has not run the migration answers every request naming the column
     * with an error; the export has to come back with a document anyway.
     */
    it(`still renders the ${which} packet where the column does not exist`, async () => {
      const run = await runExport(which, { matterNumber: null, columnMissing: true });
      expect(run.error, 'an unmigrated database took the export down').toBeNull();
      expect(run.status).toBe(200);
      expect(run.squished).toContain(`CASEREFERENCE${FRAGMENT}`);
    }, 30_000);

    it(`reads the number in its own request on the ${which} packet`, async () => {
      const run = await runExport(which, { matterNumber: REFERENCE });
      const naming = run.caseSelects.filter((s) => s.includes('matter_number'));
      expect(
        naming.length,
        'the reference was never read from the matter row at all',
      ).toBeGreaterThan(0);
      for (const columns of naming) {
        expect(
          columns.trim(),
          `matter_number was folded into a wider select (${columns}), which fails the whole request on a database without the migration`,
        ).toBe('matter_number');
      }
    }, 30_000);
  }
});
