import { describe, expect, it } from 'vitest';
import {
  assessPacketReadiness,
  isRealReview,
  packetReadinessNotices,
  type ReadinessExhibit,
} from '../lib/packet-readiness';
import { generateCasePdf } from '../lib/pdf';
import type { AIReview, Case, Exhibit } from '../lib/types';

/**
 * The two ways a court packet can carry something untrue:
 * evidence nobody read, and a review about a case the model never saw.
 */

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

function exhibit(over: Partial<ReadinessExhibit> = {}): ReadinessExhibit {
  return {
    id: 'e1',
    label: 'Exhibit A',
    fileName: 'a.pdf',
    uploadedAt: '2026-07-18T10:00:00.000Z',
    scanData: null,
    ...over,
  };
}

describe('counting the exhibits nobody read', () => {
  it('counts an exhibit with no scan at all', () => {
    const r = assessPacketReadiness({ exhibits: [exhibit()], review: null, now: NOW });
    expect(r.unread).toHaveLength(1);
    expect(r.unread[0].reason).toBe('never-scanned');
  });

  it('counts a placeholder scan as unread, because it read nothing', () => {
    const r = assessPacketReadiness({
      exhibits: [exhibit({ scanData: { isDemo: true, modelUsed: 'demo' } })],
      review: null,
      now: NOW,
    });
    expect(r.unread[0].reason).toBe('placeholder-scan');
  });

  it('counts a scan of an unsupported file as unread', () => {
    const r = assessPacketReadiness({
      exhibits: [exhibit({ scanData: { modelUsed: 'unsupported' } })],
      review: null,
      now: NOW,
    });
    expect(r.unread).toHaveLength(1);
  });

  it('does not count a real scan', () => {
    const r = assessPacketReadiness({
      exhibits: [exhibit({ scanData: { modelUsed: 'claude-sonnet-4' } })],
      review: null,
      now: NOW,
    });
    expect(r.unread).toHaveLength(0);
  });

  /**
   * THE LOAD-BEARING ONE. The state that prompted all of this: 17 of 19
   * exhibits with scan_data NULL, and nothing anywhere saying so.
   */
  it('names the count in a sentence the person actually sees', () => {
    const exhibits = Array.from({ length: 19 }, (_, i) =>
      exhibit({
        id: `e${i}`,
        label: `Exhibit ${String.fromCharCode(65 + i)}`,
        scanData: i >= 17 ? { modelUsed: 'claude-sonnet-4' } : null,
      }),
    );
    const r = assessPacketReadiness({ exhibits, review: null, now: NOW });
    expect(r.unread).toHaveLength(17);
    expect(r.clear).toBe(false);
    const notices = packetReadinessNotices(r);
    expect(notices.join(' ')).toContain('17 of your 19 exhibits have not been read');
  });

  it('says nothing about unread exhibits when there are none', () => {
    const r = assessPacketReadiness({
      exhibits: [exhibit({ scanData: { modelUsed: 'claude-sonnet-4' } })],
      review: {
        isDemo: false,
        modelUsed: 'claude-sonnet-4',
        createdAt: '2026-08-22T09:00:00.000Z',
      },
      now: NOW,
    });
    expect(r.clear).toBe(true);
    expect(packetReadinessNotices(r)).toEqual([]);
  });
});

describe('classifying the stored review', () => {
  it('treats the demo placeholder as not a review', () => {
    expect(isRealReview({ isDemo: true, modelUsed: 'demo' })).toBe(false);
    expect(isRealReview({ isDemo: false, modelUsed: 'demo' })).toBe(false);
    expect(isRealReview({ modelUsed: 'unsupported' })).toBe(false);
    expect(isRealReview(null)).toBe(false);
  });

  it('treats a real model run as a review', () => {
    expect(isRealReview({ isDemo: false, modelUsed: 'claude-sonnet-4' })).toBe(true);
  });

  it('reports a review that ran before evidence arrived', () => {
    const r = assessPacketReadiness({
      exhibits: [
        exhibit({ scanData: { modelUsed: 'claude-sonnet-4' }, uploadedAt: '2026-08-08T10:00:00Z' }),
      ],
      review: {
        isDemo: false,
        modelUsed: 'claude-sonnet-4',
        createdAt: '2026-07-01T10:00:00Z',
      },
      now: NOW,
    });
    expect(r.reviewPredatesEvidence).toBe(true);
    expect(r.clear).toBe(false);
    expect(packetReadinessNotices(r).join(' ')).toContain('did not see them');
  });

  it('reports the age of the review in plain words', () => {
    const r = assessPacketReadiness({
      exhibits: [],
      review: {
        isDemo: false,
        modelUsed: 'claude-sonnet-4',
        createdAt: '2026-08-01T12:00:00.000Z',
      },
      now: NOW,
    });
    expect(r.reviewAgeDays).toBe(21);
    expect(packetReadinessNotices(r).join(' ')).toContain('21 days ago');
  });
});

/**
 * THE PACKET ITSELF. Not a source read and not a mock: the PDF is generated
 * and its text is extracted, because a green unit test on the branch above
 * would still pass if the builder ignored it.
 */
describe('the generated case packet', () => {
  const caseRecord: Case = {
    id: 'c1',
    title: 'Doe v. Roe',
    subjectName: 'John Roe',
    subjectType: 'individual',
    jurisdiction: { city: 'Austin', state: 'TX', country: 'USA' },
    caseType: 'Landlord/Tenant',
    description: 'A dispute over a withheld deposit.',
    posture: 'plaintiff',
    status: 'open',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  } as Case;

  // Neither image nor PDF, so the builder never reaches storage for bytes.
  const exhibits: Exhibit[] = [
    {
      id: 'x1',
      caseId: 'c1',
      label: 'Exhibit A',
      fileName: 'lease.txt',
      storedFileName: 'lease.txt',
      fileType: 'text/plain',
      fileSize: 120,
      description: 'The signed lease.',
      incidentDate: '2026-01-05',
      uploadedAt: '2026-08-08T10:00:00.000Z',
      scanData: null,
    },
    {
      id: 'x2',
      caseId: 'c1',
      label: 'Exhibit B',
      fileName: 'notice.txt',
      storedFileName: 'notice.txt',
      fileType: 'text/plain',
      fileSize: 90,
      description: 'The notice to vacate.',
      incidentDate: null,
      uploadedAt: '2026-08-09T10:00:00.000Z',
      scanData: null,
    },
  ];

  const demoReview: AIReview = {
    id: 'r1',
    caseId: 'c1',
    jurisdiction: 'Austin, TX, USA',
    summary: 'Demo review for "Doe v. Roe". Set ANTHROPIC_API_KEY to enable real analysis.',
    timeline: ['Demo timeline event 1 - date and event would appear here.'],
    keyFacts: ['Subject: John Roe (individual)'],
    possibleIssues: ['Demo issue - set ANTHROPIC_API_KEY to enable real legal issue spotting.'],
    classification: 'No analysis run yet. This is a demo response.',
    evidenceMapping: ['Exhibit A (lease.txt) - relevance to be determined'],
    missingInformation: ['Set ANTHROPIC_API_KEY environment variable to enable a real review.'],
    suggestedNextSteps: ['Configure ANTHROPIC_API_KEY in .env.local and re-run this review.'],
    questionsForAttorney: ['Given the facts above, what are my realistic options?'],
    disclaimer: 'Not legal advice.',
    modelUsed: 'demo',
    isDemo: true,
    createdAt: '2026-07-01T11:00:00.000Z',
  };

  async function textOf(bytes: Buffer): Promise<string> {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const res = await extractText(pdf, { mergePages: true });
    return Array.isArray(res.text) ? res.text.join('\n') : res.text;
  }

  it('does not typeset a demo review, and says the review is absent', async () => {
    const buf = await generateCasePdf({ caseRecord, exhibits, review: demoReview });
    const text = await textOf(buf);
    expect(text).not.toContain('Demo timeline event');
    expect(text).not.toContain('Demo issue');
    expect(text).not.toContain('ANTHROPIC_API_KEY');
    expect(text).toContain('No review is included in this packet');
  }, 60_000);

  it('still typesets a real review', async () => {
    const real: AIReview = {
      ...demoReview,
      isDemo: false,
      modelUsed: 'claude-sonnet-4',
      summary: 'The deposit was withheld beyond the statutory period.',
      timeline: ['January 5, 2026 - lease signed.'],
      possibleIssues: ['Failure to return the deposit within 30 days.'],
    };
    const buf = await generateCasePdf({ caseRecord, exhibits, review: real });
    const text = await textOf(buf);
    expect(text).toContain('withheld beyond the statutory period');
    expect(text).not.toContain('No review is included in this packet');
  }, 60_000);

  it('prints where each exhibit date came from, so an upload date cannot pass as an event date', async () => {
    const buf = await generateCasePdf({ caseRecord, exhibits, review: null });
    const text = await textOf(buf);
    // Exhibit A carries an incident date the person stated.
    expect(text).toContain('2026-01-05 (stated)');
    // Exhibit B has none, so its date is the day the file arrived, labelled.
    expect(text).toContain('2026-08-09 (date received)');
  }, 60_000);
});
