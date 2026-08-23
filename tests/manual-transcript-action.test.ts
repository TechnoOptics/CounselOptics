import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What saveManualTranscriptAction is actually allowed to do.
 *
 * BEHAVIOURAL. This drives the real action against a fake Supabase client and
 * asserts on the statements that client received: which table, which columns,
 * what value, and whether a statement was reached at all. No source text is
 * matched, so no comment, no import line and no neighbouring string can
 * satisfy these.
 *
 * Four things could put a wrong claim in front of a judge, and each has a test
 * here:
 *
 *   somebody adding a transcript to an exhibit on a case they do not own
 *   a typed transcript stored so that it reads as the software's output
 *   an empty box wiping a transcript, or a long one being quietly cut
 *   the control accepting a PDF, where nothing was said
 *
 * Mutations that turn them red are recorded at the bottom of this file.
 */

type Scenario = {
  exhibitRow: Record<string, unknown> | null;
  caseOwner: string;
  updated: Array<{ id: string }>;
  updateError: { code?: string; message?: string } | null;
};

const SIGNED_IN = 'user-1';
const SOMEONE_ELSE = 'user-2';

const h = vi.hoisted(() => {
  const s: { current: Record<string, unknown> } = { current: {} };
  const calls: string[] = [];
  const updatePayloads: Array<Record<string, unknown>> = [];

  function scenario() {
    return s.current as unknown as {
      exhibitRow: Record<string, unknown> | null;
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
                return { data: scenario().exhibitRow, error: null };
              }
              return { data: null, error: null };
            },
            then: (resolve: (v: unknown) => unknown) => {
              calls.push(`select:${table}`);
              const row = scenario().exhibitRow;
              return resolve({ data: row ? [row] : [], error: null });
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

const { saveManualTranscriptAction } = await import('../lib/actions');
const {
  MANUAL_TRANSCRIPT_MODEL,
  MANUAL_TRANSCRIPT_SUMMARY_LEAD,
  MAX_MANUAL_TRANSCRIPT_CHARS,
} = await import('../lib/manual-transcript');
const { isRealScan } = await import('../lib/types');

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ex-1',
    case_id: 'case-1',
    user_id: SIGNED_IN,
    label: 'Exhibit K',
    file_name: 'kitchen argument.m4a',
    storage_path: 'user-1/case-1/ex-1.m4a',
    file_type: 'audio/mp4',
    file_size: 4_100_000,
    description: 'The recording from the kitchen',
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
    exhibitRow: row(),
    caseOwner: SIGNED_IN,
    updated: [{ id: 'ex-1' }],
    updateError: null,
    ...over,
  } as unknown as Record<string, unknown>;
}

function updateCalls(): string[] {
  return h.calls.filter((c) => c.startsWith('update:'));
}

/** The scan_data the action actually handed the database, or null. */
function storedScan(): Record<string, unknown> | null {
  const last = h.updatePayloads[h.updatePayloads.length - 1];
  if (!last) return null;
  return (last.scan_data as Record<string, unknown>) ?? null;
}

const TRANSCRIPT =
  '[00:00:04] SPEAKER 1:   I never signed that.\n' +
  '\n' +
  '[00:00:11] SPEAKER 2:\tYou did. Twice.\n';

describe('only the owner of the case may add a transcript', () => {
  beforeEach(() => reset());

  it('refuses when the case belongs to somebody else, and writes nothing', async () => {
    reset({ caseOwner: SOMEONE_ELSE });
    const res = await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only the person who opened this case/i);
    expect(updateCalls()).toEqual([]);
  });

  it('refuses an exhibit that does not exist, and writes nothing', async () => {
    reset({ exhibitRow: null });
    const res = await saveManualTranscriptAction('nope', TRANSCRIPT);
    expect(res.ok).toBe(false);
    expect(updateCalls()).toEqual([]);
  });

  it('refuses a missing or blank exhibit id, and writes nothing', async () => {
    for (const bad of ['', '   ']) {
      reset();
      const res = await saveManualTranscriptAction(bad, TRANSCRIPT);
      expect(res.ok).toBe(false);
      expect(updateCalls()).toEqual([]);
    }
  });

  it('lets the owner through', async () => {
    const res = await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(res.ok).toBe(true);
    expect(updateCalls()).toEqual(['update:exhibits']);
  });
});

describe('what actually reaches the database', () => {
  beforeEach(() => reset());

  it('writes only scan_data, never the file, the label or the description', async () => {
    await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    const payload = h.updatePayloads[0];
    expect(Object.keys(payload)).toEqual(['scan_data']);
    for (const forbidden of [
      'storage_path',
      'file_name',
      'file_type',
      'file_size',
      'label',
      'description',
      'case_id',
      'user_id',
    ]) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('stores the text byte for byte', async () => {
    await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(storedScan()?.transcript).toBe(TRANSCRIPT);
  });

  it('marks it as a person s work, not the software s', async () => {
    await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    const scan = storedScan();
    expect(scan?.modelUsed).toBe(MANUAL_TRANSCRIPT_MODEL);
    expect(scan?.readMethod).toBe('typed-by-person');
    expect(String(scan?.summary)).toContain(MANUAL_TRANSCRIPT_SUMMARY_LEAD);
    expect(String(scan?.readNote ?? '')).toMatch(/typed or pasted in by the case owner/i);
    expect(String(scan?.modelUsed)).not.toMatch(/whisper|claude|gpt/i);
  });

  it('stores something every consumer of scan_data will actually use', async () => {
    await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(isRealScan(storedScan() as never)).toBe(true);
  });

  it('stores a video recording under the video doc type', async () => {
    reset({
      exhibitRow: row({ file_name: 'doorbell.mp4', file_type: 'video/mp4' }),
    });
    await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(storedScan()?.docType).toBe('video');
  });

  it('reports failure when the write did not land', async () => {
    // An empty result models an RLS filter removing the row. Reporting success
    // there would send somebody into a hearing believing the text is on file.
    reset({ updated: [] });
    const res = await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nothing was changed/i);
  });
});

describe('the control belongs only on a recording', () => {
  const notRecordings: Array<[string, Record<string, unknown>]> = [
    ['a PDF', { file_name: 'ticket.pdf', file_type: 'application/pdf' }],
    ['a photograph', { file_name: 'scene.jpg', file_type: 'image/jpeg' }],
    ['a spreadsheet', {
      file_name: 'costs.xlsx',
      file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  ];

  for (const [what, over] of notRecordings) {
    it(`refuses ${what}, and writes nothing`, async () => {
      reset({ exhibitRow: row(over) });
      const res = await saveManualTranscriptAction('ex-1', TRANSCRIPT);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/only be added to an audio or video exhibit/i);
      expect(updateCalls()).toEqual([]);
    });
  }

  it('accepts a voice memo that arrived with no content type', async () => {
    reset({ exhibitRow: row({ file_name: 'memo.m4a', file_type: '' }) });
    const res = await saveManualTranscriptAction('ex-1', TRANSCRIPT);
    expect(res.ok).toBe(true);
  });
});

describe('an empty box and a very long one', () => {
  beforeEach(() => reset());

  it('refuses an empty box and does not clear the transcript', async () => {
    for (const blank of ['', '   ', '\n\n']) {
      reset();
      const res = await saveManualTranscriptAction('ex-1', blank);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/no transcript text to save/i);
      expect(updateCalls()).toEqual([]);
    }
  });

  it('refuses past the cap rather than storing a truncated transcript', async () => {
    const long = 'x'.repeat(MAX_MANUAL_TRANSCRIPT_CHARS + 1);
    const res = await saveManualTranscriptAction('ex-1', long);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nothing was cut/i);
    expect(updateCalls()).toEqual([]);
  });

  it('accepts a long transcript up to the cap, whole', async () => {
    const atCap = 'y'.repeat(MAX_MANUAL_TRANSCRIPT_CHARS);
    const res = await saveManualTranscriptAction('ex-1', atCap);
    expect(res.ok).toBe(true);
    expect(String(storedScan()?.transcript ?? '').length).toBe(MAX_MANUAL_TRANSCRIPT_CHARS);
  });
});

describe('editing a transcript that is already there', () => {
  it('replaces it with the corrected text', async () => {
    reset({
      exhibitRow: row({
        scan_data: {
          docType: 'voice_note',
          identifiers: {},
          parties: [],
          dates: [],
          summary: 'old',
          transcript: 'SPEAKER 1: I never signed that, Mr Hoggan.',
          scannedAt: '2026-08-20T00:00:00.000Z',
          modelUsed: MANUAL_TRANSCRIPT_MODEL,
          readMethod: 'typed-by-person',
        },
      }),
    });
    const corrected = 'SPEAKER 1: I never signed that, Mr Hohag.';
    const res = await saveManualTranscriptAction('ex-1', corrected);
    expect(res.ok).toBe(true);
    expect(storedScan()?.transcript).toBe(corrected);
    expect(storedScan()?.modelUsed).toBe(MANUAL_TRANSCRIPT_MODEL);
  });
});

describe('automatic transcription does not destroy a typed transcript', () => {
  it('refuses to re-transcribe over one, and writes nothing', async () => {
    reset({
      exhibitRow: row({
        scan_data: {
          docType: 'voice_note',
          identifiers: {},
          parties: [],
          dates: [],
          summary: 'a person typed this',
          transcript: 'an evening of work',
          scannedAt: '2026-08-20T00:00:00.000Z',
          modelUsed: MANUAL_TRANSCRIPT_MODEL,
          readMethod: 'typed-by-person',
        },
      }),
    });
    const { transcribeExhibitAction } = await import('../lib/actions');
    const res = await transcribeExhibitAction('ex-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/typed in by hand/i);
    expect(updateCalls()).toEqual([]);
  });
});

/*
 * MUTATIONS RUN AGAINST THIS FILE. Each was applied, confirmed red, reverted,
 * and `git diff --stat` confirmed empty afterwards.
 *
 *   Drop the `loadOwnedExhibit` call from saveManualTranscriptAction and read
 *   the exhibit directly: the not-your-case tests go red.
 *
 *   Drop the `exhibitIsTranscribable` gate: the PDF, photograph and
 *   spreadsheet tests go red.
 *
 *   Make MANUAL_TRANSCRIPT_MODEL 'whisper-1': the provenance test goes red.
 *
 *   Make the action truncate to the cap instead of refusing, or treat an empty
 *   box as a clear: those tests go red.
 */
