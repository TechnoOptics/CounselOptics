import { describe, expect, it } from 'vitest';
import { shouldLogRenderFailure } from '../lib/signature-render';

/**
 * One fact, one entry in the audit chain.
 *
 * The executed-PDF render fails in several ways and none of them
 * throw, so the route that calls it is what puts them in the audit
 * trail. Two of them append their own event first, carrying the
 * per-signer stamp outcome or the failed path write; a second, thinner
 * event chained behind those adds nothing and makes the record harder
 * to read, which is the only property of an audit trail that matters
 * after the fact.
 */

describe('shouldLogRenderFailure', () => {
  it('leaves a failure that already recorded itself alone', () => {
    expect(
      shouldLogRenderFailure({
        ok: false,
        logged: true,
        error: 'No signature could be stamped onto the document (2 skipped).',
      }),
    ).toBe(false);
  });

  it('records the failures that record nothing themselves', () => {
    // Request not found, no signatures, source PDF missing, unparseable
    // PDF, upload rejected. These return early with no event of their
    // own, so the caller is the only thing that will say why there is
    // no executed copy.
    for (const error of [
      'Request not found.',
      'No signatures recorded for this request.',
      'Source document not found in storage.',
      'Could not parse source PDF: bad xref',
      'Upload failed: 413',
    ]) {
      expect(shouldLogRenderFailure({ ok: false, error })).toBe(true);
    }
  });

  it('has nothing to say about a render that worked', () => {
    expect(
      shouldLogRenderFailure({
        ok: true,
        signedPath: 'signed/req-1/final.pdf',
        bytes: 4096,
        pages: 3,
      }),
    ).toBe(false);
  });
});
