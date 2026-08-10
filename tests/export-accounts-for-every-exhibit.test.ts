import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planExhibitRender, type ExhibitSource } from '../lib/pdf';
import type { Exhibit } from '../lib/types';

/**
 * A packet offered as a case record must account for every exhibit.
 *
 * Rendered and read, the old packet did not. Three separate PDF exhibits got a
 * header page reading "Full document follows on the next pages." with nothing
 * following it, because three different paths dropped the bytes and none of
 * them told the page that had already promised them:
 *
 *   - lib/pdf.ts skipped the fetch entirely for anything over the 20MB embed
 *     cap, while the upload form accepts 50MB
 *   - the fetch was wrapped in `.catch(() => null)`
 *   - mergeExhibitPdfs did `if (nonBlankIndices.length === 0) continue`
 *
 * and a fourth, an iPhone HEIC photo, was described to the reader as a
 * "non-image attachment".
 *
 * Silently dropping evidence from a document offered as a record is worse than
 * failing loudly, so the rule is: include it, or name it and say why. These
 * tests pin the decision, which is what the header page is drawn from.
 */

function exhibit(over: Partial<Exhibit>): Exhibit {
  return {
    id: 'x',
    caseId: 'case-1',
    label: 'Exhibit A',
    fileName: 'file.pdf',
    storedFileName: 'file.pdf',
    fileType: 'application/pdf',
    fileSize: 1000,
    description: '',
    incidentDate: null,
    source: null,
    category: null,
    scanData: null,
    uploadedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Exhibit;
}

const PDF = { fileName: 'lease.pdf', fileType: 'application/pdf' };

describe('what the packet promises about a PDF exhibit', () => {
  it('promises the document only when its pages are really coming', () => {
    const plan = planExhibitRender(exhibit(PDF), {
      status: 'ok',
      totalPages: 3,
      usablePages: 3,
    });

    expect(plan.kind).toBe('document');
    if (plan.kind !== 'document') throw new Error('unreachable');
    expect(plan.reproduced).toBe(3);
    expect(plan.total).toBe(3);
  });

  it('withholds, and says why, when the file is past the embed cap', () => {
    const plan = planExhibitRender(
      exhibit({ ...PDF, fileSize: 25 * 1024 * 1024 }),
      { status: 'too-large' },
    );

    expect(plan.kind).toBe('withheld');
    if (plan.kind !== 'withheld') throw new Error('unreachable');
    expect(plan.reason).toMatch(/too large/i);
    // The reason has to be usable by the reader, so it names the real limit.
    expect(plan.reason).toMatch(/\bMB\b/);
  });

  it('withholds, and says why, when the bytes could not be read', () => {
    const plan = planExhibitRender(exhibit(PDF), { status: 'unreadable' });

    expect(plan.kind).toBe('withheld');
    if (plan.kind !== 'withheld') throw new Error('unreachable');
    expect(plan.reason).toMatch(/could not be read|could not be retrieved/i);
  });

  it('withholds, and says why, when every page of the source is blank', () => {
    const plan = planExhibitRender(exhibit(PDF), {
      status: 'ok',
      totalPages: 4,
      usablePages: 0,
    });

    expect(plan.kind).toBe('withheld');
    if (plan.kind !== 'withheld') throw new Error('unreachable');
    expect(plan.reason).toMatch(/blank/i);
  });

  it('says how much of a long document was reproduced instead of implying all of it', () => {
    const plan = planExhibitRender(exhibit(PDF), {
      status: 'ok',
      totalPages: 300,
      usablePages: 40,
    });

    expect(plan.kind).toBe('document');
    if (plan.kind !== 'document') throw new Error('unreachable');
    expect(plan.reproduced).toBe(40);
    expect(plan.total).toBe(300);
    // A caller can see it is partial without re-deriving the cap.
    expect(plan.reproduced).toBeLessThan(plan.total);
  });
});

describe('what the packet says about a file it cannot draw', () => {
  it('does not call an iPhone photo a non-image attachment', () => {
    const plan = planExhibitRender(
      exhibit({ fileName: 'IMG_0001.heic', fileType: 'image/heic', fileSize: 900000 }),
      { status: 'unsupported-image' },
    );

    expect(plan.kind).toBe('withheld');
    if (plan.kind !== 'withheld') throw new Error('unreachable');
    expect(plan.reason).toMatch(/image format/i);
    expect(plan.reason).not.toMatch(/non-image/i);
  });

  it('still treats a genuine non-image, non-document file as an attachment', () => {
    const plan = planExhibitRender(
      exhibit({ fileName: 'voicemail.m4a', fileType: 'audio/mp4', fileSize: 400000 }),
      { status: 'not-applicable' },
    );

    expect(plan.kind).toBe('attachment');
  });

  it('renders an image that loaded', () => {
    const plan = planExhibitRender(
      exhibit({ fileName: 'photo.png', fileType: 'image/png', fileSize: 70 }),
      { status: 'ok', totalPages: 0, usablePages: 0 },
    );

    expect(plan.kind).toBe('image');
  });

  it('withholds an image whose bytes could not be read', () => {
    const plan = planExhibitRender(
      exhibit({ fileName: 'photo.png', fileType: 'image/png', fileSize: 70 }),
      { status: 'unreadable' },
    );

    expect(plan.kind).toBe('withheld');
    if (plan.kind !== 'withheld') throw new Error('unreachable');
    expect(plan.reason).toMatch(/could not be read|could not be retrieved/i);
  });
});

describe('every exhibit is accounted for', () => {
  it('never returns a plan that leaves the reader with no statement at all', () => {
    const sources: ExhibitSource[] = [
      { status: 'ok', totalPages: 2, usablePages: 2 },
      { status: 'too-large' },
      { status: 'unreadable' },
      { status: 'unsupported-image' },
      { status: 'not-applicable' },
      { status: 'ok', totalPages: 3, usablePages: 0 },
    ];
    for (const source of sources) {
      const plan = planExhibitRender(exhibit(PDF), source);
      expect(['image', 'document', 'attachment', 'withheld']).toContain(plan.kind);
      if (plan.kind === 'withheld') {
        expect(plan.reason.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
