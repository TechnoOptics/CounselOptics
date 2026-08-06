import { describe, expect, it } from 'vitest';
import {
  findSignatureBlockLine,
  formatSignedOn,
  mergeTemplateDocument,
} from '../lib/firm-template-placeholders';

/**
 * The locator is the one thing that makes the employee's on-page preview, the
 * reviewer's copy and the delivered PDF put the signature mark in the same
 * place. All three call this function on the text they are about to render, so
 * they agree by construction rather than by three careful implementations.
 *
 * These tests are therefore not decoration. If the locator drifts, a document
 * goes out with the mark somewhere other than where the employee saw it.
 */

const MERGED = mergeTemplateDocument({
  body: 'This agreement is between {{firm_name}} and {{counterparty}}.',
  fields: [{ key: 'counterparty', label: 'Counterparty' }],
  values: { counterparty: 'Beta LLC' },
  firmName: 'Acme Corporation',
  signatureName: 'Jane Doe',
  signerEmail: 'jane@acme.com',
  signedOn: 'August 6, 2026',
});

describe('findSignatureBlockLine', () => {
  it('finds the signature line of a normally merged document', () => {
    const idx = findSignatureBlockLine(MERGED);
    expect(idx).not.toBeNull();
    expect(MERGED.split('\n')[idx as number]).toBe('Signed: Jane Doe');
  });

  it('returns the LAST signature line when the body mentions one earlier', () => {
    const text = [
      'Signed: an earlier draft referenced here',
      'Body of the agreement.',
      '',
      'Signed: Jane Doe',
      'Date: August 6, 2026',
      'Email: jane@acme.com',
    ].join('\n');
    expect(findSignatureBlockLine(text)).toBe(3);
  });

  it('returns null when a reviewer has rewritten the block', () => {
    const text = [
      'Body of the agreement.',
      '',
      'Signature: Jane Doe',
      'Dated: August 6, 2026',
    ].join('\n');
    expect(findSignatureBlockLine(text)).toBeNull();
  });

  it('returns null for an empty document', () => {
    expect(findSignatureBlockLine('')).toBeNull();
  });

  it('returns 0 when the block is the very first line', () => {
    expect(findSignatureBlockLine('Signed: Jane Doe\nDate: August 6, 2026')).toBe(0);
  });

  it('matches a line carrying trailing whitespace', () => {
    expect(findSignatureBlockLine('Body.\nSigned: Jane Doe   \nDate: today')).toBe(1);
  });

  it('matches a line the renderer has indented', () => {
    expect(findSignatureBlockLine('Body.\n    Signed: Jane Doe')).toBe(1);
  });

  it('does not match a bare "Signed:" with no name after it', () => {
    expect(findSignatureBlockLine('Body.\nSigned:')).toBeNull();
  });

  it('is case sensitive, so "SIGNED:" is not the block', () => {
    expect(findSignatureBlockLine('Body.\nSIGNED: JANE DOE')).toBeNull();
  });

  it('rejects a non-string without throwing', () => {
    expect(findSignatureBlockLine(undefined as unknown as string)).toBeNull();
  });
});

describe('mergeTemplateDocument keeps the block the locator looks for', () => {
  /**
   * The merged text is firm_template_submissions.document_text: the approval
   * gate reads it, the reviewer edits it, and two concurrency guards compare
   * on it. So a change to the trailing block has to break a test here rather
   * than quietly move the mark in the delivered PDF.
   */
  it('ends with the exact three-line signature block', () => {
    expect(MERGED.endsWith('\n\n\nSigned: Jane Doe\nDate: August 6, 2026\nEmail: jane@acme.com')).toBe(
      true,
    );
  });

  it('falls back to a signature rule when no name was typed', () => {
    const text = mergeTemplateDocument({
      body: 'Body.',
      fields: [],
      values: {},
      firmName: 'Acme Corporation',
      signatureName: '   ',
      signerEmail: 'jane@acme.com',
      signedOn: 'August 6, 2026',
    });
    const idx = findSignatureBlockLine(text);
    expect(idx).not.toBeNull();
    expect(text.split('\n')[idx as number]).toBe('Signed: ____________________');
  });

  it('formatSignedOn produces the date the block carries', () => {
    expect(formatSignedOn(new Date('2026-08-06T12:00:00Z'))).toMatch(/2026/);
  });
});
