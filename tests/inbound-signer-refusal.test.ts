import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THREE DOORS ONTO ONE DOCUMENT, AND THE GATE HAS TO BE ON ALL THREE.
 *
 * An inbound signing request is created with its authorisation pending and
 * its signer link minted at the same moment, because the link is how the
 * firm's own signatory reaches the document. So the link resolves before
 * anybody has decided anything, and three separate things can be reached
 * with it:
 *
 *   app/sign/[token]/page.tsx                    the ceremony
 *   app/api/firm/sign/document/[token]/route.ts  the document bytes
 *   lib/signature-write.ts recordSignature       the mark itself
 *
 * The third is the one that binds the firm and it is reached by BOTH POST
 * routes, which is why the gate sits in the shared function rather than in
 * either handler. The first two are gated so a signer reads a sentence
 * instead of meeting a refusal after drawing their name.
 *
 * WHY THIS IS A SOURCE-READING TEST. vitest runs in environment node with no
 * DOM and none may be added, and none of these three is a pure function: a
 * page, a route handler and a function that opens a Supabase client. The
 * DECISION they share is pure and is tested properly in
 * tests/signing-authorization.test.ts. What cannot be tested that way is
 * whether each of the three actually calls it, which is exactly the thing
 * that would be quietly deleted.
 *
 * Comments are stripped before matching, because this repo has twice had a
 * guard pass on the comment that explained the fix, and once on an import
 * line. Every assertion below anchors on a CALL and on what is done with its
 * result, and the position assertions anchor on an index rather than on the
 * mere presence of two strings in one file.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const PAGE = 'app/sign/[token]/page.tsx';
const BYTES = 'app/api/firm/sign/document/[token]/route.ts';
const WRITE = 'lib/signature-write.ts';

/** The call, with both of its arguments, as every door has to spell it. */
const CALL = /resolveSignerGate\(\{[\s\S]{0,200}?direction:[\s\S]{0,200}?authorizationStatus:[\s\S]{0,120}?\}\)/;

describe('the signer page refuses an unauthorised inbound document', () => {
  /**
   * Mutation: delete the resolveSignerGate call and its early return from
   * the page. This goes red.
   */
  it('calls the shared decision with both columns', () => {
    expect(stripComments(read(PAGE))).toMatch(CALL);
  });

  /**
   * Mutation: keep the call but drop the `if (!authorization.ok) return`, or
   * move the refusal below the document render. Either goes red.
   *
   * The position is asserted against the FIRST mention of the document
   * fetch, not merely that both strings exist, because a loose "contains
   * both" check has passed in this repo while the code was broken.
   */
  it('returns before anything about the document is built', () => {
    const src = stripComments(read(PAGE));
    const gate = src.search(CALL);
    expect(gate, 'the gate is gone from the page').toBeGreaterThan(-1);
    const refusal = src.indexOf('if (!authorization.ok)', gate);
    expect(refusal, 'the gate result is computed and not acted on').toBeGreaterThan(gate);
    // Everything that touches the document, in the order the page does it.
    for (const later of [
      'appendSignatureEvent(',
      'resolveSignerCopyAccess(',
      '<SignerSurface',
    ]) {
      const at = src.indexOf(later);
      expect(at, `${later} is no longer on this page`).toBeGreaterThan(-1);
      expect(at, `${later} runs before the authorisation gate`).toBeGreaterThan(refusal);
    }
  });
});

describe('the document bytes route refuses the same request', () => {
  /**
   * Mutation: delete the gate from the route. This goes red.
   *
   * It matters on its own: anyone holding the link can call this URL
   * directly, which is why the route already makes the access decision for
   * itself rather than trusting the page.
   */
  it('calls the shared decision and refuses on it', () => {
    const src = stripComments(read(BYTES));
    const gate = src.search(CALL);
    expect(gate, 'the gate is gone from the bytes route').toBeGreaterThan(-1);
    expect(src.slice(gate)).toMatch(/if \(!authorization\.ok\) return refuse\(/);
  });

  /**
   * Mutation: move the gate below the storage download. This goes red.
   */
  it('refuses before it reads any bytes', () => {
    const src = stripComments(read(BYTES));
    const gate = src.search(CALL);
    const download = src.indexOf('.download(');
    expect(download, 'the route no longer downloads the document').toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(gate);
  });
});

describe('the write path refuses the mark itself', () => {
  /**
   * Mutation: delete the gate from recordSignature. This goes red.
   *
   * This is the one that matters most. The page and the route control what a
   * person can SEE; this controls whether the firm becomes bound, and both
   * POST routes come through it, so a gate written in either handler instead
   * would leave the other one open.
   */
  it('calls the shared decision and returns a refusal', () => {
    const src = stripComments(read(WRITE));
    const gate = src.search(CALL);
    expect(gate, 'the gate is gone from recordSignature').toBeGreaterThan(-1);
    expect(src.slice(gate)).toMatch(
      /if \(!authorization\.ok\) \{\s*return \{ ok: false, status: \d{3}, error: authorization\.reason \};/,
    );
  });

  /**
   * Mutation: move the gate below the signature upload or the audit append.
   * This goes red.
   */
  it('refuses before the mark is stored or chained', () => {
    const src = stripComments(read(WRITE));
    const gate = src.search(CALL);
    for (const later of ['signerMarkPath(', 'appendSignatureEvent(']) {
      const at = src.indexOf(later, gate);
      expect(at, `${later} no longer runs after the gate`).toBeGreaterThan(gate);
    }
  });
});

/**
 * The gate is one function in one module, and there must not be a second
 * spelling of it anywhere. A hand-written `=== 'approved'` beside a
 * `=== 'inbound'` is how the three doors would start disagreeing.
 *
 * Mutation: replace any of the three calls with an inline comparison. This
 * goes red on that file.
 */
describe('nobody spells the decision out by hand', () => {
  it.each([PAGE, BYTES, WRITE])('%s asks the module rather than the columns', (file) => {
    const src = stripComments(read(file));
    expect(src).not.toMatch(/===\s*'inbound'/);
    expect(src).not.toMatch(/authorization_status\s*===/);
    expect(src).not.toMatch(/authorizationStatus\s*===/);
  });
});
