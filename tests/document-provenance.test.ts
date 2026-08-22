import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PAPER_ORIGIN_COLUMN,
  PAPER_ORIGIN_UNSAVED_ERROR,
  isFirmPaper,
  isThirdPartyPaper,
  paperOriginHeader,
  readPaperOrigin,
  resolvePaperOriginColumnFallback,
  thirdPartyPaperHeader,
} from '../lib/document-provenance';

/**
 * The fail-safe read, and the one write that is allowed to say 'firm'.
 *
 * The whole protection rests on one direction being the default, so the null
 * cases below are not padding: they are the property. supabase/migrations/
 * 20260822_document_paper_origin.sql is NOT applied, so absent-column and
 * null are what every reader will actually meet for now.
 */
describe('whose paper a document is', () => {
  /**
   * Mutation: flip readPaperOrigin to `raw === 'third_party' ? 'third_party'
   * : 'firm'`. Every case here goes red.
   */
  it.each([
    ['an absent column', undefined],
    ['a null column', null],
    ['an empty string', ''],
    ['a value nobody has heard of', 'ours'],
    ['a near miss on the real value', 'Firm'],
    ['a number', 3],
    ['an object', {}],
    ['a boolean', true],
  ])('reads %s as third_party', (_label, raw) => {
    expect(readPaperOrigin(raw)).toBe('third_party');
    expect(isThirdPartyPaper(raw)).toBe(true);
    expect(isFirmPaper(raw)).toBe(false);
  });

  it('reads the one exact value as the firm', () => {
    expect(readPaperOrigin('firm')).toBe('firm');
    expect(isFirmPaper('firm')).toBe(true);
    expect(isThirdPartyPaper('firm')).toBe(false);
  });

  it('reads third_party as third_party, spelled out', () => {
    expect(readPaperOrigin('third_party')).toBe('third_party');
  });
});

describe('the header over a document the firm did not write', () => {
  it('names the counterparty and promises nothing was changed', () => {
    expect(thirdPartyPaperHeader('Northwind Traders')).toBe(
      'Sent to us by Northwind Traders. Kept exactly as received.',
    );
  });

  it('still reads as a true sentence when the name is not known', () => {
    for (const missing of [null, undefined, '', '   ']) {
      expect(thirdPartyPaperHeader(missing)).toBe(
        'Sent to us by the other party. Kept exactly as received.',
      );
    }
  });

  /**
   * Mutation: return the header unconditionally from paperOriginHeader. This
   * goes red, and it is the case that matters: a banner on the firm's own
   * paper is a false provenance claim, which is the exact harm the abort
   * fallback below exists to prevent.
   */
  it('is shown on unlabelled paper and withheld from the firm own paper', () => {
    expect(paperOriginHeader(null, 'Northwind Traders')).toBe(
      'Sent to us by Northwind Traders. Kept exactly as received.',
    );
    expect(paperOriginHeader(undefined, 'Northwind Traders')).not.toBeNull();
    expect(paperOriginHeader('firm', 'Northwind Traders')).toBeNull();
  });
});

describe('a write that cannot record the firm own paper', () => {
  const unknownColumn = (
    error: { code?: string | null; message?: string | null } | null | undefined,
    column: string,
  ) =>
    (error?.code === 'PGRST204' || error?.code === '42703') &&
    (error?.message ?? '').includes(column);

  /**
   * Mutation: return 'surface-error' for a missing column, or add a
   * 'retry-without-column' branch and return it here. This goes red.
   */
  it('aborts rather than filing the row unlabelled', () => {
    expect(
      resolvePaperOriginColumnFallback({
        error: {
          code: 'PGRST204',
          message: `Could not find the '${PAPER_ORIGIN_COLUMN}' column`,
        },
        isUnknownColumn: unknownColumn,
      }),
    ).toBe('abort-origin-unsaved');
  });

  it('leaves every other failure to the caller', () => {
    for (const error of [
      null,
      undefined,
      { code: '23505', message: 'duplicate key value' },
      { code: 'PGRST204', message: "Could not find the 'delivery_mode' column" },
      { code: '42501', message: 'permission denied for table firm_documents' },
    ]) {
      expect(
        resolvePaperOriginColumnFallback({ error, isUnknownColumn: unknownColumn }),
      ).toBe('surface-error');
    }
  });

  it('says what did not happen and what to do about it', () => {
    expect(PAPER_ORIGIN_UNSAVED_ERROR).toContain('was not filed');
    expect(PAPER_ORIGIN_UNSAVED_ERROR).toContain('administrator');
  });
});

/**
 * THE SOURCE-READING GUARD ON THE ONE WRITER.
 *
 * lib/submission-document.ts is the only module in the repo that knows the
 * bytes it is filing came out of buildBrandedDocumentPdf, so it is the only
 * one entitled to write 'firm'. Two things have to hold and neither is
 * visible to a unit test: the insert must carry the column, and the failure
 * path must abort rather than retry.
 *
 * Comments are stripped before matching, because this repo has twice had a
 * guard satisfied by the comment that explained the fix. Each assertion
 * anchors on a CALL or on the literal inside the insert rather than on a
 * name appearing somewhere in the file, because a name also appears on an
 * import line.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the one writer that may claim the firm wrote a document', () => {
  const src = () => stripComments(read('lib/submission-document.ts'));

  /**
   * Mutation: delete `paper_origin: 'firm',` from the insert. This goes red.
   *
   * Anchored on the firm_documents insert specifically, not on the string
   * appearing anywhere in the file, because this module also updates
   * firm_template_submissions a few lines later and a loose match would
   * happily read the wrong statement.
   */
  it('names paper_origin firm on the firm_documents insert', () => {
    const s = src();
    const at = s.indexOf("from('firm_documents').insert(");
    expect(at, 'the module no longer inserts into firm_documents').toBeGreaterThan(-1);
    const close = s.indexOf('});', at);
    expect(close).toBeGreaterThan(at);
    expect(s.slice(at, close)).toMatch(/paper_origin:\s*'firm'/);
  });

  /**
   * Mutation: replace the abort with a retry that drops the column. This
   * goes red, because it asserts the CALL and the return of the named error,
   * not that the words appear in the file.
   */
  it('aborts on a missing column instead of filing it unlabelled', () => {
    const s = src();
    expect(s).toMatch(/resolvePaperOriginColumnFallback\(\{/);
    expect(s).toMatch(/===\s*'abort-origin-unsaved'/);
    expect(s).toMatch(/error:\s*PAPER_ORIGIN_UNSAVED_ERROR/);
  });

  /**
   * The rule that makes the whole column meaningful: third-party paper is
   * never handed to the renderer or to the proposer. This module renders,
   * and it must only ever render a document it is building from a template.
   *
   * Mutation: add a second buildBrandedDocumentPdf call fed by an upload.
   * This goes red on the count.
   */
  it('calls the renderer exactly once, on the template it is building', () => {
    const s = src();
    expect([...s.matchAll(/buildBrandedDocumentPdf\(/g)]).toHaveLength(1);
    expect(s).not.toContain('proposeTemplateFromText');
  });
});
