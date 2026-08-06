import { describe, expect, it } from 'vitest';
import {
  isExecutedCopyPath,
  pickDocumentArtifactRequest,
  resolveSigningArtifact,
  selectSigningArtifact,
} from '../lib/signing-artifact';

/**
 * The choice between the two artifacts a signing request can have.
 *
 * Worth asserting because both ways of getting it wrong are silent.
 * Showing the original on a completed request looks like a working
 * page with an unsigned document on it, which is the bug this module
 * exists to close. Showing the original while CALLING it executed is
 * worse: it asserts signatures that are not on the page.
 */

const ORIGINAL = 'firm-1/doc-1/agreement.pdf';
const EXECUTED = 'signed/req-1/final.pdf';

describe('selectSigningArtifact', () => {
  it('shows the executed copy once the request is completed', () => {
    expect(
      selectSigningArtifact({
        status: 'completed',
        signedFilePath: EXECUTED,
        originalFilePath: ORIGINAL,
      }),
    ).toEqual({ kind: 'executed', path: EXECUTED, notice: 'executed' });
  });

  it('says so plainly when a completed request has no executed copy', () => {
    // The render failed, or the request predates the render pipeline.
    // The original is the only thing left to show, and it must not be
    // handed over as if it were the executed one: 'executed_missing'
    // is what makes the surface say the signatures are not on it.
    expect(
      selectSigningArtifact({
        status: 'completed',
        signedFilePath: null,
        originalFilePath: ORIGINAL,
      }),
    ).toEqual({
      kind: 'original',
      path: ORIGINAL,
      notice: 'executed_missing',
    });
  });

  it('does not treat an empty stored path as an executed copy', () => {
    for (const empty of ['', '   ']) {
      expect(
        selectSigningArtifact({
          status: 'completed',
          signedFilePath: empty,
          originalFilePath: ORIGINAL,
        })?.notice,
      ).toBe('executed_missing');
    }
  });

  it('refuses to present an executed copy for a request that is not completed', () => {
    // A signed_file_path on a request that is not completed belongs to
    // an earlier state of it. Showing it would assert an execution the
    // request's own status denies.
    for (const status of [
      'draft',
      'sent',
      'partial',
      'canceled',
      'rejected',
      'changes_requested',
    ]) {
      const choice = selectSigningArtifact({
        status,
        signedFilePath: EXECUTED,
        originalFilePath: ORIGINAL,
      });
      expect(choice?.kind).toBe('original');
      expect(choice?.path).toBe(ORIGINAL);
    }
  });

  it('marks a partially signed request as still waiting', () => {
    expect(
      selectSigningArtifact({
        status: 'partial',
        signedFilePath: null,
        originalFilePath: ORIGINAL,
      }),
    ).toEqual({
      kind: 'original',
      path: ORIGINAL,
      notice: 'original_partial',
    });
  });

  it('does not say nothing has been signed when a request was stopped mid-way', () => {
    // Recalled, declined and waiting-on-changes requests can all carry
    // signatures that were collected before they stopped, and the
    // signing page lists them further up the same page. The default
    // copy reads as "nobody has signed", which would contradict it.
    for (const status of ['canceled', 'rejected', 'changes_requested']) {
      expect(
        selectSigningArtifact({
          status,
          signedFilePath: null,
          originalFilePath: ORIGINAL,
        }),
      ).toEqual({ kind: 'original', path: ORIGINAL, notice: 'original_halted' });
    }
  });

  it('leaves every other state showing the original with nothing to add', () => {
    for (const status of ['draft', 'sent', null, undefined]) {
      expect(
        selectSigningArtifact({
          status,
          signedFilePath: null,
          originalFilePath: ORIGINAL,
        }),
      ).toEqual({ kind: 'original', path: ORIGINAL, notice: 'original' });
    }
  });

  it('reports nothing to show when neither artifact exists', () => {
    expect(
      selectSigningArtifact({ status: 'completed', originalFilePath: null }),
    ).toBeNull();
    expect(selectSigningArtifact({ status: 'sent', originalFilePath: '' })).toBeNull();
  });

  it('can still show the executed copy when the document row is gone', () => {
    expect(
      selectSigningArtifact({
        status: 'completed',
        signedFilePath: EXECUTED,
        originalFilePath: null,
      }),
    ).toEqual({ kind: 'executed', path: EXECUTED, notice: 'executed' });
  });
});

describe('pickDocumentArtifactRequest', () => {
  const completedEarly = {
    id: 'completed-early',
    status: 'completed',
    completedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const completedLate = {
    id: 'completed-late',
    status: 'completed',
    completedAt: '2026-03-02T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
  };
  const live = {
    id: 'live',
    status: 'partial',
    completedAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
  };

  it('prefers the executed copy over a request still out for signature', () => {
    // A new request opened after an earlier one finished does not
    // un-execute the copy the earlier one produced, even though it is
    // the more recent row.
    expect(pickDocumentArtifactRequest([live, completedEarly])?.id).toBe(
      'completed-early',
    );
  });

  it('takes the most recently completed of several', () => {
    expect(pickDocumentArtifactRequest([completedEarly, completedLate])?.id).toBe(
      'completed-late',
    );
  });

  it('speaks for a live request when nothing has completed', () => {
    // Without this the page falls back to "nothing has been signed
    // onto it" with two of three signers already in, and can
    // contradict its own status chip.
    expect(pickDocumentArtifactRequest([live])?.id).toBe('live');
  });

  it('ignores requests that are not out for signature and never completed', () => {
    for (const status of ['canceled', 'rejected', 'changes_requested', 'draft', 'sent']) {
      expect(
        pickDocumentArtifactRequest([{ id: 'x', status, createdAt: '2026-05-01T00:00:00.000Z' }]),
      ).toBeNull();
    }
    expect(pickDocumentArtifactRequest([])).toBeNull();
  });

  it('still ranks completed requests that carry no completed_at', () => {
    // completed_at predates nothing in particular, but a row missing it
    // must not sort ahead of a genuinely later one.
    const noStamp = {
      id: 'no-stamp',
      status: 'completed',
      completedAt: null,
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    expect(pickDocumentArtifactRequest([noStamp, completedLate])?.id).toBe(
      'completed-late',
    );
    expect(pickDocumentArtifactRequest([noStamp, completedEarly])?.id).toBe(
      'no-stamp',
    );
  });
});

describe('resolveSigningArtifact', () => {
  const EXECUTED_URL = 'https://store/signed?sig=e';
  const ORIGINAL_URL = 'https://store/original?sig=o';
  const completed = selectSigningArtifact({
    status: 'completed',
    signedFilePath: EXECUTED,
    originalFilePath: ORIGINAL,
  });

  it('puts the executed copy on screen and keeps the original beside it', () => {
    // Counsel has to be able to compare the two. The original is a
    // different legal object, not a stale version of the same one.
    expect(
      resolveSigningArtifact(completed, {
        executedUrl: EXECUTED_URL,
        originalUrl: ORIGINAL_URL,
      }),
    ).toEqual({
      kind: 'executed',
      notice: 'executed',
      url: EXECUTED_URL,
      originalUrl: ORIGINAL_URL,
    });
  });

  it('does not call the original executed when the executed copy will not open', () => {
    // The record says there is an executed copy; the storage URL did
    // not mint. Falling back is right, doing it under the 'executed'
    // label is not.
    expect(
      resolveSigningArtifact(completed, {
        executedUrl: null,
        originalUrl: ORIGINAL_URL,
      }),
    ).toEqual({
      kind: 'original',
      notice: 'executed_unreadable',
      url: ORIGINAL_URL,
      originalUrl: null,
    });
  });

  it('separates a copy that will not open from one that was never produced', () => {
    const neverRendered = selectSigningArtifact({
      status: 'completed',
      signedFilePath: null,
      originalFilePath: ORIGINAL,
    });
    expect(
      resolveSigningArtifact(neverRendered, { originalUrl: ORIGINAL_URL })?.notice,
    ).toBe('executed_missing');
  });

  it('offers nothing to compare when the original is what is on screen', () => {
    const pending = selectSigningArtifact({
      status: 'partial',
      originalFilePath: ORIGINAL,
    });
    expect(
      resolveSigningArtifact(pending, {
        executedUrl: EXECUTED_URL,
        originalUrl: ORIGINAL_URL,
      }),
    ).toEqual({
      kind: 'original',
      notice: 'original_partial',
      url: ORIGINAL_URL,
      originalUrl: null,
    });
  });

  it('reports the state with no url rather than an empty frame', () => {
    expect(
      resolveSigningArtifact(completed, { executedUrl: null, originalUrl: null }),
    ).toEqual({
      kind: 'original',
      notice: 'executed_unreadable',
      url: null,
      originalUrl: null,
    });
    expect(resolveSigningArtifact(null, { originalUrl: ORIGINAL_URL })).toBeNull();
  });
});

describe('isExecutedCopyPath', () => {
  it('accepts the executed copy belonging to this request', () => {
    expect(isExecutedCopyPath('req-1', 'signed/req-1/final.pdf')).toBe(true);
  });

  it('refuses the executed copy belonging to another request', () => {
    expect(isExecutedCopyPath('req-1', 'signed/req-2/final.pdf')).toBe(false);
  });

  it('refuses a request id that is merely a prefix of the one in the path', () => {
    // The trailing slash is the whole guard here. Without it, a caller
    // holding request 'abc' could open the executed copy of request 'abcdef'.
    expect(isExecutedCopyPath('abc', 'signed/abcdef/final.pdf')).toBe(false);
  });

  it('refuses anything that walks out of the signed prefix', () => {
    expect(isExecutedCopyPath('req-1', 'signed/req-1/../../firm-1/doc-1/secret.pdf')).toBe(
      false,
    );
    expect(isExecutedCopyPath('req-1', '/signed/req-1/final.pdf')).toBe(false);
    expect(isExecutedCopyPath('req-1', 'signed\\req-1\\final.pdf')).toBe(false);
  });

  it('refuses a path outside the signed prefix entirely', () => {
    expect(isExecutedCopyPath('req-1', 'firm-1/doc-1/agreement.pdf')).toBe(false);
  });

  it('refuses a missing id or path', () => {
    expect(isExecutedCopyPath(null, 'signed/req-1/final.pdf')).toBe(false);
    expect(isExecutedCopyPath('req-1', null)).toBe(false);
    expect(isExecutedCopyPath('  ', 'signed/req-1/final.pdf')).toBe(false);
    expect(isExecutedCopyPath('req-1', '   ')).toBe(false);
  });
});
