import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Reopening a signing request re-sends the SAME document, and both the firm
 * and the signer have to be told that.
 *
 * The page said reopening "sends the revised document"; the notification told
 * the signer "a revised version is ready". Neither was true. A signing request
 * holds one document_id, reopenSigningRequestAction does not touch it, and
 * firm_documents.version is written as the literal 1 by every insert and
 * incremented by nothing. So the person who declined was sent the identical
 * file, with a message saying their objection had been answered.
 *
 * The copy was fixed rather than the claim, and the reason is not effort: a
 * signature is evidence about a particular set of bytes, which is what the
 * audit chain hashes, so a request cannot swap its file and keep the
 * signatures made on the old one. The revision path is a fresh request, and
 * the copy now says so.
 *
 * Mutations these are meant to catch:
 *   - restore "sends the revised document" on the page -> "the banner does not
 *     promise a revision" goes red.
 *   - restore "A revised version is ready." in the notification -> "the signer
 *     is not told the document changed" goes red.
 *   - make any firm_documents writer store a version other than 1 -> "the
 *     version is still never moved" goes red, which is the intended coupling:
 *     the day a document CAN be replaced, this copy has to be revisited.
 */

const read = (rel: string) =>
  stripComments(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('reopening does not claim a revision', () => {
  it('the banner does not promise a revision, and says what actually happens', () => {
    const src = read('../app/counsel/signing/[id]/page.tsx');
    expect(
      /revised document/i.test(src),
      'Reopening re-sends the same file. Nothing in this product replaces the document behind a request.',
    ).toBe(false);
    expect(src).toMatch(/same document/i);
    expect(src).toMatch(/fresh request/i);
  });

  it('the signer is not told the document changed', () => {
    const src = read('../lib/signing-actions.ts');
    expect(
      /revised version is ready/i.test(src),
      'The reopen notification goes to the signer who objected. It must not tell them their objection produced a new document.',
    ).toBe(false);
    expect(src).toMatch(/document has not changed/i);
  });

  it('the version is still never moved, which is what makes the copy true', () => {
    // Every module that writes firm_documents. If one of them ever stores a
    // version other than the literal 1, document replacement has arrived and
    // the banner copy above is no longer the truth.
    const writers = [
      '../lib/firm-actions.ts',
      '../lib/letters-actions.ts',
      '../lib/import-actions.ts',
      '../lib/submission-document.ts',
      '../lib/bella.ts',
    ];
    const offenders: string[] = [];
    for (const rel of writers) {
      const src = read(rel);
      for (const m of src.match(/version:\s*[^,\n]+/g) ?? []) {
        if (!/^version:\s*1$/.test(m.trim())) offenders.push(`${rel}: ${m.trim()}`);
      }
      if (/version:\s*[^,\n]*\+\s*1/.test(src)) offenders.push(`${rel}: increment`);
    }
    expect(
      offenders,
      'A moving document version means a request can carry a new file, and the reopen copy has to be rewritten to match.',
    ).toEqual([]);
  });
});
