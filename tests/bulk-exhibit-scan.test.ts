import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reading every exhibit that was never read.
 *
 * On the case that prompted this, 17 of 19 exhibits had `scan_data` NULL
 * because `uploadExhibitAction` ran its auto-scan inside a try/catch that only
 * console.warn'd. Fixing them one row at a time is seventeen clicks, and the
 * person doing it is preparing for a court date.
 *
 * What these tests protect is not the happy path. It is that a partial failure
 * stays partial: the successes are kept and reported, and every exhibit that
 * did not get read is named along with the reason. A bulk action that reported
 * one aggregate "done" would leave somebody walking into court believing
 * their evidence had been read.
 */

const h = vi.hoisted(() => {
  const s = {
    exhibits: [] as Record<string, unknown>[],
    caseRecord: { id: 'case-1', title: 'Doe v. Roe' } as Record<string, unknown> | null,
    fileBuffer: null as Buffer | null,
    /** Exhibit ids whose scanDocument call should throw. */
    failFor: new Set<string>(),
    /** Exhibit ids whose scanDocument call should come back as the demo placeholder. */
    demoFor: new Set<string>(),
    listThrows: false,
  };
  const saved: string[] = [];
  const scanned: string[] = [];
  return { s, saved, scanned };
});

let currentFileName = '';

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usingSupabase: () => true,
    getCase: async () => h.s.caseRecord,
    listExhibits: async () => {
      if (h.s.listThrows) throw new Error('postgrest exploded');
      return h.s.exhibits;
    },
    getExhibitById: async (id: string) => h.s.exhibits.find((e) => e.id === id) ?? null,
    getExhibitFileBuffer: async (e: { fileName: string }) => {
      currentFileName = e.fileName;
      return h.s.fileBuffer;
    },
    saveExhibitScan: async (id: string) => {
      h.saved.push(id);
    },
  };
});

vi.mock('../lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    scanDocument: async () => {
      const id = idForFileName(currentFileName);
      h.scanned.push(id);
      if (h.s.failFor.has(id)) throw new Error('provider said no');
      if (h.s.demoFor.has(id)) {
        return {
          docType: 'other',
          identifiers: {},
          parties: [],
          dates: [],
          summary: 'This document was not actually scanned.',
          scannedAt: '2026-08-22T00:00:00.000Z',
          modelUsed: 'demo',
          isDemo: true,
        };
      }
      return {
        docType: 'contract',
        identifiers: {},
        parties: [],
        dates: [{ label: 'Date issued', value: '2026-01-05' }],
        summary: 'A one-page agreement.',
        scannedAt: '2026-08-22T00:00:00.000Z',
        modelUsed: 'claude-test',
      };
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

const { rescanUnreadExhibitsAction, rescanExhibitAction } = await import('../lib/actions');

function idForFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/, '');
}

function ex(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    caseId: 'case-1',
    label: `Exhibit ${id.toUpperCase()}`,
    fileName: `${id}.pdf`,
    fileType: 'application/pdf',
    scanData: null,
    uploadedAt: '2026-07-18T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  h.saved.length = 0;
  h.scanned.length = 0;
  h.s.failFor = new Set();
  h.s.demoFor = new Set();
  h.s.listThrows = false;
  h.s.caseRecord = { id: 'case-1', title: 'Doe v. Roe' };
  h.s.fileBuffer = Buffer.from('%PDF-1.4 pretend');
  h.s.exhibits = [ex('a'), ex('b'), ex('c')];
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('picking which exhibits still need reading', () => {
  it('reads the ones with no scan at all', async () => {
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.ok).toBe(true);
    expect(res.scanned).toBe(3);
    expect(h.saved).toEqual(['a', 'b', 'c']);
  });

  it('leaves an exhibit that was already really read alone', async () => {
    h.s.exhibits = [ex('a', { scanData: { modelUsed: 'claude-sonnet-4' } }), ex('b')];
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(h.scanned).toEqual(['b']);
    expect(res.outcomes.map((o) => o.exhibitId)).toEqual(['b']);
  });

  it('treats a stored placeholder scan as still unread', async () => {
    // Its own summary says the document was not scanned. Skipping it would
    // mean the button reports nothing to do on a case where nothing was read.
    h.s.exhibits = [ex('a', { scanData: { isDemo: true, modelUsed: 'demo' } })];
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(h.scanned).toEqual(['a']);
    expect(res.scanned).toBe(1);
  });
});

describe('partial failure stays partial', () => {
  /**
   * THE LOAD-BEARING ONE. One exhibit failing must not discard the exhibits
   * that succeeded, and must not be reported as a whole-run failure.
   */
  it('keeps the successes when one exhibit fails, and names the one that failed', async () => {
    h.s.failFor = new Set(['b']);
    const res = await rescanUnreadExhibitsAction('case-1');

    expect(res.ok).toBe(true);
    expect(res.scanned).toBe(2);
    expect(res.failed).toBe(1);
    expect(h.saved).toEqual(['a', 'c']);

    const failed = res.outcomes.filter((o) => o.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].exhibitId).toBe('b');
    expect(failed[0].label).toBe('Exhibit B');
    expect(failed[0].message).toBeTruthy();
  });

  it('reports every exhibit individually, never one aggregate line', async () => {
    h.s.failFor = new Set(['c']);
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.outcomes.map((o) => `${o.exhibitId}:${o.status}`)).toEqual([
      'a:scanned',
      'b:scanned',
      'c:failed',
    ]);
  });

  it('does not throw when the provider rejects every single exhibit', async () => {
    h.s.failFor = new Set(['a', 'b', 'c']);
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.ok).toBe(true);
    expect(res.failed).toBe(3);
    expect(res.stillUnread).toBe(3);
  });

  it('counts a scan that came back as a placeholder as a failure, not a success', async () => {
    h.s.demoFor = new Set(['b']);
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(h.saved).not.toContain('b');
    expect(res.outcomes.find((o) => o.exhibitId === 'b')?.status).toBe('failed');
  });

  it('reports an unreadable file against the exhibit it belongs to', async () => {
    h.s.fileBuffer = null;
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.failed).toBe(3);
    expect(res.outcomes[0].message).toContain('a.pdf');
  });
});

describe('the size of one run', () => {
  it('stops at the batch size and names what it did not reach', async () => {
    h.s.exhibits = Array.from({ length: 9 }, (_, i) => ex(`x${i}`));
    const res = await rescanUnreadExhibitsAction('case-1');

    expect(res.scanned).toBe(6);
    expect(res.outcomes).toHaveLength(9);
    const notAttempted = res.outcomes.filter((o) => o.status === 'not-attempted');
    expect(notAttempted).toHaveLength(3);
    expect(notAttempted[0].message).toContain('again');
    expect(res.stillUnread).toBe(3);
  });

  it('does not run them all at once', async () => {
    // Six sequential calls, each finished before the next began. Asserted by
    // the recorded order rather than by reading the source.
    h.s.exhibits = Array.from({ length: 6 }, (_, i) => ex(`x${i}`));
    await rescanUnreadExhibitsAction('case-1');
    expect(h.scanned).toEqual(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
    expect(h.saved).toEqual(['x0', 'x1', 'x2', 'x3', 'x4', 'x5']);
  });
});

describe('whole-run refusals', () => {
  it('refuses plainly when the case is not there', async () => {
    h.s.caseRecord = null;
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Case not found.');
    expect(res.outcomes).toEqual([]);
  });

  it('returns a calm reason rather than throwing when the case will not load', async () => {
    h.s.listThrows = true;
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('try again in a moment');
  });

  it('says nothing needs doing when every exhibit has been read', async () => {
    h.s.exhibits = [ex('a', { scanData: { modelUsed: 'claude-sonnet-4' } })];
    const res = await rescanUnreadExhibitsAction('case-1');
    expect(res.ok).toBe(true);
    expect(res.outcomes).toEqual([]);
    expect(res.stillUnread).toBe(0);
  });
});

describe('the single-exhibit action still behaves', () => {
  it('shares the bulk run path rather than keeping a second one', async () => {
    const res = await rescanExhibitAction('a');
    expect(res.ok).toBe(true);
    expect(h.saved).toEqual(['a']);
  });

  it('still returns its refusal as a value', async () => {
    h.s.fileBuffer = null;
    const res = await rescanExhibitAction('a');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('a.pdf');
  });
});
