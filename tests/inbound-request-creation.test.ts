import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * HOW AN INBOUND REQUEST IS CREATED, WHICH IS THE OTHER HALF OF THE GATE.
 *
 * tests/inbound-signer-refusal.test.ts holds the three doors shut. This holds
 * the one that opens them: a request on the other party's document has to be
 * INSERTED as pending, and the insert has to refuse rather than retry if the
 * columns are not there yet.
 *
 * Retrying without them would produce a row that reads as outbound, which
 * resolveSignerGate lets straight through, with a live signer link, on a
 * document the firm never agreed to sign. That is the gate deleting itself in
 * order to get a row written, and it is the specific failure this file exists
 * to keep out.
 *
 * createSigningRequestAction cannot be called from a node-environment test:
 * it opens two Supabase clients, reads a session, downloads from storage and
 * runs pdf-lib. The DECISION is pure and is tested in
 * tests/signing-authorization.test.ts. What is tested here is that the action
 * makes it, which is what would quietly be deleted.
 *
 * Comments are stripped first. This repo has twice had a guard satisfied by
 * the comment explaining the fix, and the block being matched here is
 * surrounded by prose naming every string it looks for.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ACTIONS = 'lib/firm-actions.ts';

/**
 * The body of createSigningRequestAction, not the whole 4000-line module.
 *
 * lib/firm-actions.ts contains dozens of inserts and several other fallbacks,
 * and a match anywhere in it would prove nothing about this function. A loose
 * regex matching a NEIGHBOURING occurrence has passed in this repo while the
 * code under it was broken, so the window is cut first and every assertion
 * runs inside it.
 */
function createAction(): string {
  const src = stripComments(read(ACTIONS));
  const at = src.indexOf('export async function createSigningRequestAction(');
  expect(at, 'createSigningRequestAction is gone').toBeGreaterThan(-1);
  const next = src.indexOf('\nexport async function ', at + 1);
  expect(next, 'could not find the end of createSigningRequestAction').toBeGreaterThan(at);
  return src.slice(at, next);
}

describe('a request on the other party document is created gated', () => {
  /**
   * Mutation: change 'pending' to 'approved', or drop authorization_status
   * and let the column default apply. Either goes red, and the second is the
   * real hazard: the default is 'not_required', which is a request with a
   * live link and no gate.
   */
  it('writes pending explicitly rather than leaning on the column default', () => {
    expect(createAction()).toMatch(
      /direction === 'inbound'[\s\S]{0,120}?direction: 'inbound', authorization_status: 'pending'/,
    );
  });

  /**
   * Mutation: spread directionExtra unconditionally, or into the insert used
   * by every request. This goes red.
   *
   * An outbound request must name neither column, so that between merge and
   * the owner applying the migration the ordinary signing path behaves
   * exactly as it did before.
   */
  it('names neither column on an outbound request', () => {
    const body = createAction();
    // The WHOLE ternary, both arms, anchored from the declaration to the
    // semicolon. A first version of this asserted the two arms separately and
    // a mutation that gave the outbound arm `{ direction: 'outbound',
    // authorization_status: 'not_required' }` sailed through it, because a
    // bare `: {};` appears elsewhere in this function and satisfied the
    // second half on its own.
    expect(body).toMatch(
      /const directionExtra =\s*direction === 'inbound'\s*\?\s*\{ direction: 'inbound', authorization_status: 'pending' \}\s*:\s*\{\};/,
    );
  });

  /**
   * Mutation: delete the abort, or reorder it below the two restriction
   * fallbacks. The first goes red on the call; the second goes red on the
   * position, which is asserted against the other two fallbacks by index
   * rather than by both merely being present.
   */
  it('aborts on a missing column, before either restriction fallback', () => {
    const body = createAction();
    const abort = body.search(/resolveSigningDirectionColumnFallback\(\{/);
    expect(abort, 'the direction fallback is gone').toBeGreaterThan(-1);
    expect(body.slice(abort)).toMatch(/===\s*'abort-authorization-unsaved'/);
    expect(body.slice(abort)).toMatch(/error: INBOUND_AUTHORIZATION_UNSAVED_ERROR/);
    const methods = body.indexOf('resolveSignatureMethodsColumnFallback(');
    const download = body.indexOf('resolveDownloadColumnFallback(');
    expect(methods, 'the methods fallback is gone').toBeGreaterThan(-1);
    expect(download, 'the download fallback is gone').toBeGreaterThan(-1);
    expect(abort).toBeLessThan(methods);
    expect(abort).toBeLessThan(download);
  });

  /**
   * Mutation: add directionExtra to the retry insert. This goes red.
   *
   * The retry exists for the outbound case, where dropping the download
   * column loses nothing. An inbound request has already aborted by the time
   * it is reached, and carrying the direction onto it would turn the retry
   * into the inbound path's way around its own gate.
   */
  it('does not carry the direction onto the retry insert', () => {
    const body = createAction();
    const retry = body.indexOf('.insert({ ...requestInsert, ...methodsExtra })');
    expect(retry, 'the retry insert has changed shape').toBeGreaterThan(-1);
  });
});
