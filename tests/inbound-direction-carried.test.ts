import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * THE DIRECTION IS ASKED ONCE AND CARRIED, NEVER ASKED AGAIN.
 *
 * The person filing the ticket already answered "does this involve a
 * signature, and which way", and lib/intake-signature-direction.ts reads that
 * answer. The chain from there to a created signing request is:
 *
 *   app/counsel/intake/[id]/page.tsx   reads the answer
 *   components/intake/IntakeWorkPanel  carries it on the counsel-only prop
 *   SendForSignatureDialog             passes it to the composer
 *   CreateSigningRequestForm           passes it to the action
 *
 * If any link drops it, the request is created outbound: ungated, with a live
 * signer link, on a document the other party wrote. Nothing would look wrong
 * on any screen. That is why the chain is asserted rather than assumed.
 *
 * A SECOND PROMPT would be the other failure, and it is why this file also
 * checks that the dialog takes the direction as a required prop rather than
 * offering a choice. Two records of one fact drift, and the ticket's answer
 * is the one the legal team has been reading.
 *
 * IntakeWorkPanel is SHARED between the counsel ticket and the employee
 * portal, so the direction rides on the opt-in `signing` prop the portal does
 * not pass, following the pattern that control already used.
 *
 * Comments are stripped before matching, because every one of these files
 * explains in prose exactly what is being searched for.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the direction reaches the action that creates the request', () => {
  /**
   * Mutation: drop `direction` from the options object. This goes red, and
   * it is the mutation that would silently create every request outbound.
   */
  it('the composer passes it to createSigningRequestAction', () => {
    const src = stripComments(read('app/counsel/documents/[id]/signing-form.tsx'));
    const at = src.indexOf('createSigningRequestAction(');
    expect(at, 'the composer no longer creates requests').toBeGreaterThan(-1);
    const call = src.slice(at, src.indexOf('));', at));
    expect(call).toMatch(/\{ signerCanDownload, direction \}/);
  });

  /**
   * Mutation: hard-code 'outbound' in the dialog. This goes red.
   */
  it('the dialog passes what it was given rather than a literal', () => {
    const src = stripComments(read('components/intake/SendForSignatureDialog.tsx'));
    expect(src).toMatch(/<CreateSigningRequestForm[\s\S]{0,200}?direction=\{direction\}/);
    expect(src).not.toMatch(/direction=\{'(inbound|outbound)'\}/);
    expect(src).not.toMatch(/direction="(inbound|outbound)"/);
  });

  /**
   * Mutation: drop `direction` from the dialog call in the panel. This goes
   * red on the call, not on the prop declaration, so declaring the prop and
   * forgetting to pass it does not satisfy it.
   */
  it('the shared panel carries it on the counsel-only prop', () => {
    const src = stripComments(read('components/intake/IntakeWorkPanel.tsx'));
    const at = src.indexOf('<SendForSignatureDialog');
    expect(at, 'the panel no longer opens the composer').toBeGreaterThan(-1);
    const el = src.slice(at, src.indexOf('/>', at));
    expect(el).toMatch(/direction=\{signing\.direction \?\? 'outbound'\}/);
  });

  /**
   * Mutation: pass a literal from the ticket page instead of reading the
   * answer. This goes red, because it asserts the CALL to the reader.
   */
  it('the ticket page reads the answer the person filing gave', () => {
    const src = stripComments(read('app/counsel/intake/[id]/page.tsx'));
    expect(src).toMatch(
      /direction: readSignatureDirection\(ans\.signature_direction\) \?\? 'outbound'/,
    );
  });

  /**
   * The employee's portal must NOT gain the send control by this change. It
   * passes no `signing` prop at all, which is what keeps a legal-team tool
   * off the employee's page, and the direction rides on that same prop.
   *
   * Mutation: add `signing={...}` to the portal's IntakeWorkPanel. This goes
   * red.
   */
  it('does not reach the employee portal', () => {
    const src = stripComments(read('app/portal/[id]/page.tsx'));
    expect(src).toContain('<IntakeWorkPanel');
    expect(src).not.toMatch(/signing=\{/);
  });
});
