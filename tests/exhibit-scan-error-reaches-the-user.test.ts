import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the person who clicked "Scan now" is actually told.
 *
 * rescanExhibitAction and transcribeExhibitAction signalled every failure by
 * throwing, and app/cases/[id]/exhibit-scan.tsx does
 * `setError(err instanceof Error ? err.message : 'Scan failed.')`. That reads
 * like it works, and in dev it does.
 *
 * In a production build it does not. React strips the message off an error
 * that crosses the Server Action boundary and sends only a digest, so
 * `err.message` in the browser is the generic
 *
 *   "An error occurred in the Server Components render. The specific message
 *    is omitted in production builds to avoid leaking sensitive details. A
 *    digest property is included on this error instance..."
 *
 * which is exactly the sentence the red box under the exhibit rendered on
 * advottic.com. Reproduced on the live site: the action POST came back 500
 * with a 68-byte body carrying digest 2127023581 and no message at all.
 *
 * The messages that were discarded had been written with care: "AI scanning
 * isn't configured on this deployment", "Could not read the file", and
 * AiUnavailableError's calm "Advottic's analysis is temporarily unavailable."
 * All of it was replaced by a sentence about React internals, shown to a
 * person in legal distress.
 *
 * These tests assert the RETURN VALUE, because a value survives the boundary
 * and a thrown message does not. `rejects.toThrow` passes on the broken shape,
 * which is exactly why it is not used.
 */

const h = vi.hoisted(() => {
  const s = {
    exhibit: null as Record<string, unknown> | null,
    fileBuffer: null as Buffer | null,
    scanResult: null as Record<string, unknown> | null,
    scanError: null as Error | null,
    transcribeError: null as Error | null,
    apiKey: 'sk-ant-test' as string | undefined,
  };
  const calls: string[] = [];
  return { s, calls };
});

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usingSupabase: () => true,
    getExhibitById: async () => h.s.exhibit,
    getExhibitFileBuffer: async () => h.s.fileBuffer,
    saveExhibitScan: async () => {
      h.calls.push('saveExhibitScan');
    },
  };
});

vi.mock('../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    scanDocument: async () => {
      h.calls.push('scanDocument');
      if (h.s.scanError) throw h.s.scanError;
      return h.s.scanResult;
    },
    transcribeMedia: async () => {
      h.calls.push('transcribeMedia');
      if (h.s.transcribeError) throw h.s.transcribeError;
      return h.s.scanResult;
    },
  };
});

vi.mock('../lib/activity', () => ({ logCaseEvent: async () => undefined }));
vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));

const { rescanExhibitAction, transcribeExhibitAction } = await import('../lib/actions');

const GOOD_SCAN = {
  docType: 'contract',
  identifiers: {},
  parties: [],
  dates: [],
  summary: 'A one-page agreement.',
  scannedAt: '2026-08-10T00:00:00.000Z',
  modelUsed: 'claude-test',
};

beforeEach(() => {
  h.calls.length = 0;
  h.s.exhibit = {
    id: 'ex-1',
    caseId: 'case-1',
    fileName: 'agreement.pdf',
    fileType: 'application/pdf',
  };
  h.s.fileBuffer = Buffer.from('%PDF-1.4 pretend');
  h.s.scanResult = { ...GOOD_SCAN };
  h.s.scanError = null;
  h.s.transcribeError = null;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('what the scan action hands back to the exhibit row', () => {
  it('reports a completed scan as a value, not just an absence of a throw', async () => {
    const res = await rescanExhibitAction('ex-1');

    expect(res).toMatchObject({ ok: true });
    expect(h.calls).toContain('saveExhibitScan');
  });

  it('returns the provider-outage sentence instead of losing it at the boundary', async () => {
    const { AiUnavailableError } = await import('../lib/ai-errors');
    h.s.scanError = new AiUnavailableError(
      Object.assign(new Error('400 {"error":{"message":"credit balance is too low"}}'), {
        status: 400,
      }),
      'scanDocument',
    );

    const res = await rescanExhibitAction('ex-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/temporarily unavailable/i);
    // The raw provider JSON must never be what the person reads.
    expect(res.error).not.toMatch(/credit balance/i);
    expect(h.calls).not.toContain('saveExhibitScan');
  });

  it('returns the unreadable-file reason rather than a generic server fault', async () => {
    h.s.fileBuffer = null;

    const res = await rescanExhibitAction('ex-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not read/i);
    expect(h.calls).not.toContain('scanDocument');
  });

  it('returns the wrong-file-type reason for something that is not an image or PDF', async () => {
    h.s.exhibit = {
      id: 'ex-2',
      caseId: 'case-1',
      fileName: 'budget.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    const res = await rescanExhibitAction('ex-2');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/images and PDFs/i);
    expect(h.calls).not.toContain('scanDocument');
  });

  it('never hands back the sentence React substitutes in production', async () => {
    h.s.scanError = new Error('anything at all');

    const res = await rescanExhibitAction('ex-1');

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/Server Components render/i);
    expect(res.error).not.toMatch(/omitted in production builds/i);
  });
});

describe('what the transcribe action hands back to the exhibit row', () => {
  beforeEach(() => {
    h.s.exhibit = {
      id: 'ex-3',
      caseId: 'case-1',
      fileName: 'voicemail.m4a',
      fileType: 'audio/mp4',
    };
    h.s.scanResult = { ...GOOD_SCAN, docType: 'voice_note', transcript: 'Hello.' };
  });

  it('reports a completed transcription as a value', async () => {
    const res = await transcribeExhibitAction('ex-3');

    expect(res).toMatchObject({ ok: true });
    expect(h.calls).toContain('saveExhibitScan');
  });

  it('returns the reason a transcription failed instead of throwing it away', async () => {
    const { AiUnavailableError } = await import('../lib/ai-errors');
    h.s.transcribeError = new AiUnavailableError(new Error('fetch failed'), 'transcribeMedia');

    const res = await transcribeExhibitAction('ex-3');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/temporarily unavailable/i);
    expect(h.calls).not.toContain('saveExhibitScan');
  });

  it('returns the wrong-file-type reason for a document', async () => {
    h.s.exhibit = {
      id: 'ex-1',
      caseId: 'case-1',
      fileName: 'agreement.pdf',
      fileType: 'application/pdf',
    };

    const res = await transcribeExhibitAction('ex-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/audio or video/i);
    expect(h.calls).not.toContain('transcribeMedia');
  });
});

describe('the consumer case route has somewhere for a render throw to land', () => {
  /**
   * app/cases/[id]/page.tsx calls getCase, listExhibits, getLatestReview and
   * listCollaborators inside one Promise.all, and each of those does
   * `if (error) throw error` in lib/storage.ts. Any one of them takes the
   * whole page down. The nearest boundary was the root app/error.tsx, which
   * says "Something went wrong" and drops the digest, so the person had
   * nothing to quote and support had nothing to join on. The counsel matter
   * page has had a scoped boundary that prints a reference since cadd9a56.
   */
  const boundary = path.join(process.cwd(), 'app/cases/[id]/error.tsx');

  it('exists', () => {
    expect(() => readFileSync(boundary, 'utf8')).not.toThrow();
  });

  it('gives the person a reference they can quote, via displayableDigest', () => {
    const source = readFileSync(boundary, 'utf8');
    expect(source).toMatch(/displayableDigest\(/);
    // The raw digest must never be printed: a non-numeric digest is an
    // internal code this codebase put there, not a Next hash.
    expect(source).not.toMatch(/\{\s*error\.digest\s*\}/);
  });

  it('is listed in the boundary sweep so the raw-digest guard covers it', () => {
    const sweep = readFileSync(path.join(process.cwd(), 'tests/firm-access.test.ts'), 'utf8');
    expect(sweep).toMatch(/'app\/cases\/\[id\]\/error\.tsx'/);
  });
});

describe('the exhibit row reads the value it was handed', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'app/cases/[id]/exhibit-scan.tsx'),
    'utf8',
  );

  it('does not put a caught error message on screen', () => {
    // `err.message` is the React substitute in production. Rendering it is the
    // defect this file exists to prevent, so the shape must not come back.
    expect(source).not.toMatch(/err instanceof Error \? err\.message/);
  });

  it('shows the refusal the action returned', () => {
    expect(source).toMatch(/\.error/);
    expect(source).toMatch(/setError\(/);
  });
});
