import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';
import {
  SCAN_SUPPORTED_SENTENCE,
  classifyExhibitForReading,
  exhibitIsScannable,
  unsupportedScanMessage,
} from '../lib/exhibit-reading';

/**
 * Which reader each exhibit goes to, and what a person is told when there is
 * no reader for it.
 *
 * The refusal sentence is evidence in its own right: somebody deciding
 * whether to re-export a file acts on it. "Scan only supports images and
 * PDFs" was true until spreadsheets became readable and then it was not, and
 * a person with a payment tracker would have re-exported a file that already
 * worked. So the message is asserted against the behaviour, type by type.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('the two exhibits that could not be read before', () => {
  it('routes Monthly Expense.xlsx to text extraction', () => {
    const route = classifyExhibitForReading({
      fileName: 'Monthly Expense.xlsx',
      fileType: XLSX,
    });

    expect(route).toEqual({ kind: 'extract', format: 'spreadsheet', label: 'spreadsheet' });
  });

  it('routes Dustin_Payment_and_Debt_Tracker.xlsx to text extraction', () => {
    const route = classifyExhibitForReading({
      fileName: 'Dustin_Payment_and_Debt_Tracker.xlsx',
      fileType: XLSX,
    });

    expect(route.kind).toBe('extract');
  });
});

describe('images and PDFs still go to the vision model', () => {
  it.each([
    ['photo.png', 'image/png', 'image/png'],
    ['photo.PNG', 'image/png', 'image/png'],
    ['scan.jpg', 'image/jpeg', 'image/jpeg'],
    ['scan.jpeg', 'image/jpeg', 'image/jpeg'],
    ['shot.webp', 'image/webp', 'image/webp'],
    ['clip.gif', 'image/gif', 'image/gif'],
    ['notice.pdf', 'application/pdf', 'application/pdf'],
  ])('%s stays on the vision path as %s', (fileName, fileType, mediaType) => {
    expect(classifyExhibitForReading({ fileName, fileType })).toEqual({
      kind: 'vision',
      mediaType,
    });
  });

  it('still normalises a file uploaded with no content type at all', () => {
    expect(
      classifyExhibitForReading({ fileName: 'ticket.jpeg', fileType: '' }),
    ).toEqual({ kind: 'vision', mediaType: 'image/jpeg' });
    expect(
      classifyExhibitForReading({ fileName: 'summons.pdf', fileType: 'application/octet-stream' }),
    ).toEqual({ kind: 'vision', mediaType: 'application/pdf' });
  });
});

describe('Word documents', () => {
  it('routes a .docx to text extraction', () => {
    expect(classifyExhibitForReading({ fileName: 'letter.docx', fileType: DOCX })).toEqual({
      kind: 'extract',
      format: 'word',
      label: 'Word document',
    });
  });
});

describe('what is genuinely not readable', () => {
  it.each([
    ['old.xls', 'application/vnd.ms-excel'],
    ['old.doc', 'application/msword'],
    ['sheet.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ])('%s is refused with the re-export instruction', (fileName, fileType) => {
    const route = classifyExhibitForReading({ fileName, fileType });

    expect(route.kind).toBe('unsupported');
    if (route.kind !== 'unsupported') throw new Error('unreachable');
    expect(route.reason).toMatch(/save it again as/i);
  });

  it('sends audio and video to Transcribe, not to Scan', () => {
    expect(classifyExhibitForReading({ fileName: 'call.m4a', fileType: 'audio/mp4' }).kind).toBe(
      'transcribe',
    );
    expect(classifyExhibitForReading({ fileName: 'clip.mov', fileType: 'video/quicktime' }).kind).toBe(
      'transcribe',
    );
  });
});

describe('the refusal message stays true', () => {
  it('names every type that really works, and each one is on the reading path', () => {
    const message = unsupportedScanMessage('application/zip');

    expect(message).toContain(SCAN_SUPPORTED_SENTENCE);
    // Every format the sentence advertises must actually reach a reader.
    const advertised: Array<[string, string]> = [
      ['a.pdf', 'application/pdf'],
      ['a.png', 'image/png'],
      ['a.jpeg', 'image/jpeg'],
      ['a.webp', 'image/webp'],
      ['a.gif', 'image/gif'],
      ['a.xlsx', XLSX],
      ['a.docx', DOCX],
    ];
    for (const [fileName, fileType] of advertised) {
      expect(exhibitIsScannable({ fileName, fileType })).toBe(true);
    }
  });

  it('does not claim anything that is not on the reading path', () => {
    const message = unsupportedScanMessage('application/zip').toLowerCase();
    const notReadable: Array<[string, string, string]> = [
      ['.xls', 'a.xls', 'application/vnd.ms-excel'],
      ['.doc', 'a.doc', 'application/msword'],
      ['.ods', 'a.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
      ['.odt', 'a.odt', 'application/vnd.oasis.opendocument.text'],
    ];
    for (const [token, fileName, fileType] of notReadable) {
      expect(exhibitIsScannable({ fileName, fileType })).toBe(false);
      // The supported-types sentence must not advertise it. `.xls` is a
      // substring of `.xlsx`, so the sentence is checked for the extension
      // followed by something that is not another letter.
      expect(SCAN_SUPPORTED_SENTENCE.toLowerCase()).not.toMatch(
        new RegExp(`\\${token}(?![a-z])`),
      );
    }
    expect(message).toContain('for audio or video, use transcribe');
  });

  it('does not still say scan only supports images and PDFs', () => {
    expect(unsupportedScanMessage('application/zip')).not.toMatch(
      /only supports images and pdfs/i,
    );
  });

  it('names the type the person actually gave, so they can see what was rejected', () => {
    expect(unsupportedScanMessage('application/zip')).toContain('application/zip');
    expect(unsupportedScanMessage('')).toContain('unknown type');
  });
});

/**
 * Source guards.
 *
 * Both strip comments before matching, so a comment that merely names the
 * function cannot satisfy them, and both assert a CALL rather than an import
 * or a mention. That is not hypothetical caution in this repo: guards here
 * have twice been kept green by the comment that explained the fix.
 */
describe('the rule about what is readable lives in one place', () => {
  const read = (rel: string) =>
    stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'));

  it('the scan action calls classifyExhibitForReading rather than re-deriving the rule', () => {
    const src = read('lib/actions.ts');

    expect(src).toMatch(/classifyExhibitForReading\s*\(/);
    // The old inline rule must be gone, not merely commented out.
    expect(src).not.toMatch(/Scan only supports images and PDFs/);
  });

  it('the exhibit row calls exhibitIsScannable rather than keeping its own copy', () => {
    const src = read('app/cases/[id]/exhibit-scan.tsx');

    expect(src).toMatch(/exhibitIsScannable\s*\(/);
    expect(src).not.toMatch(/ct\s*===\s*'application\/pdf'/);
  });

  it('the scan action decides a placeholder with isRealScan and not a second check', () => {
    const src = read('lib/actions.ts');

    expect(src).toMatch(/isRealScan\s*\(\s*scan\s*\)/);
    // The hand-written duplicate of isRealScan's rule must not be back.
    expect(src).not.toMatch(/scan\.modelUsed\s*===\s*'demo'/);
    expect(src).not.toMatch(/scan\.modelUsed\s*===\s*'unsupported'/);
  });
});
