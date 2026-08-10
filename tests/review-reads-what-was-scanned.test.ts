import { describe, expect, it } from 'vitest';
import { describeExhibitsForPrompt } from '../lib/ai';
import { isRealScan, type Exhibit, type ScanData } from '../lib/types';

/**
 * What Advottic Review is actually given to reason about.
 *
 * The review's evidence block was built from filename, description and MIME
 * type alone. Everything the app had already extracted from the file - the
 * transcript of a voicemail, the parties and dates lifted off a scanned
 * notice - sat in exhibits.scan_data and was never shown to the model. So a
 * user could transcribe a threatening voicemail, watch the words appear on the
 * exhibit row, run the review, and get an analysis that had never read them.
 *
 * That is the whole of "have Bella scan and analyse exhibits": the scanning
 * already existed and already stored its output. It just was not wired to the
 * thing that analyses.
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

function scan(over: Partial<ScanData>): ScanData {
  return {
    docType: 'other',
    identifiers: {},
    parties: [],
    dates: [],
    summary: '',
    scannedAt: '2026-08-02T00:00:00.000Z',
    modelUsed: 'claude-test',
    ...over,
  } as ScanData;
}

describe('the evidence block the review is given', () => {
  it('still lists an exhibit that has never been scanned', () => {
    const text = describeExhibitsForPrompt([
      exhibit({ label: 'Exhibit A', fileName: 'lease.pdf', description: 'The signed lease.' }),
    ]);

    expect(text).toContain('Exhibit A');
    expect(text).toContain('lease.pdf');
    expect(text).toContain('The signed lease.');
  });

  it('includes the transcript of a voicemail that was transcribed', () => {
    const text = describeExhibitsForPrompt([
      exhibit({
        label: 'Exhibit B',
        fileName: 'voicemail.m4a',
        fileType: 'audio/mp4',
        scanData: scan({
          docType: 'voice_note',
          summary: 'A voicemail about the deposit.',
          transcript: 'You will not be getting that deposit back.',
        }),
      }),
    ]);

    expect(text).toContain('You will not be getting that deposit back.');
  });

  it('includes what a scan read off a document', () => {
    const text = describeExhibitsForPrompt([
      exhibit({
        label: 'Exhibit C',
        fileName: 'notice.pdf',
        scanData: scan({
          docType: 'eviction_notice',
          summary: 'A notice to vacate.',
          parties: ['A Landlord', 'A Tenant'],
          dates: [{ label: 'Served', value: '2026-03-01' }],
          amounts: ['$1,450.00'],
        }),
      }),
    ]);

    expect(text).toContain('A notice to vacate.');
    expect(text).toContain('A Landlord');
    expect(text).toContain('2026-03-01');
    expect(text).toContain('$1,450.00');
  });

  it('does not pass off a demo scan as if it had read the file', () => {
    const text = describeExhibitsForPrompt([
      exhibit({
        label: 'Exhibit D',
        fileName: 'thing.pdf',
        scanData: scan({
          summary: 'Demo response - ANTHROPIC_API_KEY not set; document was not actually scanned.',
          isDemo: true,
          modelUsed: 'demo',
        }),
      }),
    ]);

    expect(text).not.toMatch(/Demo response/);
    expect(text).toContain('Exhibit D');
  });

  it('bounds a long transcript so one exhibit cannot crowd out the case', () => {
    const long = 'word '.repeat(5000);
    const text = describeExhibitsForPrompt([
      exhibit({
        label: 'Exhibit E',
        fileName: 'long.m4a',
        fileType: 'audio/mp4',
        scanData: scan({ docType: 'voice_note', transcript: long }),
      }),
    ]);

    expect(text.length).toBeLessThan(6000);
    expect(text).toContain('Exhibit E');
  });

  it('says so plainly when nothing has been uploaded', () => {
    expect(describeExhibitsForPrompt([])).toMatch(/none uploaded yet/i);
  });
});

describe('the rule for whether a scan really read the file', () => {
  /**
   * Two places consume scan_data now (this prompt builder and Bella's
   * get_case_detail), and both have to exclude a demo scan for the same
   * reason. The rule lives in one function so the two cannot drift, which is
   * the failure mode this repo has hit before with duplicated geometry.
   */
  it('accepts a scan a real model produced', () => {
    expect(isRealScan({ modelUsed: 'claude-sonnet-4-6' })).toBe(true);
  });

  it('rejects the placeholder from a deployment with no API key', () => {
    expect(isRealScan({ isDemo: true, modelUsed: 'demo' })).toBe(false);
    expect(isRealScan({ modelUsed: 'demo' })).toBe(false);
    expect(isRealScan({ isDemo: true, modelUsed: 'claude-sonnet-4-6' })).toBe(false);
  });

  it('rejects a scan of a file type nothing could read', () => {
    expect(isRealScan({ modelUsed: 'unsupported' })).toBe(false);
  });

  it('rejects the absence of a scan', () => {
    expect(isRealScan(null)).toBe(false);
    expect(isRealScan(undefined)).toBe(false);
  });
});
