import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    /**
     * The writer list is DERIVED. It used to be five paths written out with
     * the comment "every module that writes firm_documents", and it was not:
     * lib/intake-upload-public.ts and lib/intake-conversation.ts both insert
     * into that table and neither was listed. Adding `version: 2` to the
     * intake uploader moved a document version with this test still green,
     * which is the banner copy above becoming untrue.
     *
     * So the tree is swept for the table name instead, and the sweep has a
     * floor: if it ever resolves to fewer writers than the five that were
     * hand-listed, it has stopped matching and says so rather than passing.
     */
    const root = fileURLToPath(new URL('../', import.meta.url));
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const writers = ['app', 'components', 'lib']
      .flatMap((d) => walk(join(root, d)))
      .map((f) => ({ rel: f.slice(root.length), src: stripComments(readFileSync(f, 'utf8')) }))
      .filter((f) => /\.from\(['"]firm_documents['"]\)[\s\S]{0,400}?\.insert\(/.test(f.src));

    expect(
      writers.map((w) => w.rel).sort(),
      'the firm_documents writer sweep has stopped matching',
    ).toEqual(expect.arrayContaining(['lib/firm-actions.ts', 'lib/intake-upload-public.ts']));
    expect(writers.length).toBeGreaterThanOrEqual(5);

    const offenders: string[] = [];
    for (const { rel, src } of writers) {
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
