import { describe, expect, it } from 'vitest';

import { brandedCopyNotice, resolveSignedCopyView } from '../lib/signed-copy-view';

/**
 * The two decisions behind the employee's own copy of a document they signed.
 *
 * WHAT THIS CAN AND CANNOT PROVE. vitest runs in the node environment in this
 * repo and jsdom is deliberately absent, so nothing here renders a component.
 * These are the rules the surface branches on, pulled out so they are exercised
 * for real; that the page WIRES them is held by the source guards in
 * tests/employee-signed-copy-render.test.ts, and that the pages then LOOK right
 * is held by neither and has to be looked at.
 */

describe('which version of the document the employee is shown', () => {
  it('draws nothing when the wording is not open to this reader', () => {
    expect(
      resolveSignedCopyView({ documentVisible: false, documentText: 'anything at all' }),
    ).toEqual({ kind: 'withheld' });
  });

  it('withholds even when the text happens to have come through', () => {
    // documentVisible is the gate, not the emptiness of the string. A row read
    // with the wording attached but the flag false is a bug elsewhere, and this
    // must not be the place that quietly publishes it.
    expect(
      resolveSignedCopyView({ documentVisible: false, documentText: 'The supplier shall.' }),
    ).toEqual({ kind: 'withheld' });
  });

  it('asks for the real pages for an ordinary filed document', () => {
    expect(
      resolveSignedCopyView({ documentVisible: true, documentText: 'The supplier shall.' }),
    ).toEqual({ kind: 'branded' });
  });

  it('keeps the text alone when there is no document to render', () => {
    // Nothing was refused and nothing failed, so this branch owes no notice.
    expect(resolveSignedCopyView({ documentVisible: true, documentText: '' })).toEqual({
      kind: 'text',
    });
    expect(resolveSignedCopyView({ documentVisible: true, documentText: '   \n\t ' })).toEqual({
      kind: 'text',
    });
  });
});

describe('what the employee is told when the letterhead version cannot be drawn', () => {
  it('names the staleness refusal as staleness and asks for a reload', () => {
    const said = brandedCopyNotice(409);
    expect(said).toMatch(/changed while the page was open/i);
    expect(said).toMatch(/reload/i);
  });

  it('names a refusal as a refusal rather than as a failure', () => {
    const said = brandedCopyNotice(403);
    expect(said).toMatch(/not open to you/i);
    // A person is entitled to the document they signed, so a refusal of the
    // letterheaded version must still point at a way to get one.
    expect(said).toMatch(/legal team can send you/i);
  });

  it('treats every other outcome as a failure to prepare, including none at all', () => {
    for (const status of [null, 400, 404, 500, 502]) {
      const said = brandedCopyNotice(status);
      expect(said).toMatch(/could not be prepared just now/i);
      expect(said).toMatch(/plain text of the same document/i);
    }
  });

  it('never leaves the reader thinking the fallback is the document itself', () => {
    // The defect this whole change exists for was a silent downgrade: the
    // reflowed text with no letterhead, no mark and nothing said. Every notice
    // has to distinguish itself from the real thing in words.
    for (const status of [null, 403, 409, 500]) {
      expect(brandedCopyNotice(status)).toMatch(/letterhead/i);
    }
  });

  it('says nothing in an en dash or em dash, which this product does not use', () => {
    for (const status of [null, 403, 409, 500]) {
      expect(brandedCopyNotice(status)).not.toMatch(/[–—]/);
    }
  });
});
