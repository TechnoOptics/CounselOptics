import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { stripComments } from './support/strip-comments';
import { handoffCodeAvailable } from '../lib/signing-handoff-consent';
import {
  mintSigningHandoff,
  MINT_REFUSAL_DISCLOSURE,
  type MintHandoffDeps,
} from '../lib/signing-handoff-mint';

/**
 * The mobile handoff is now offered on the disclosure step, because an
 * option nobody can find is an option nobody has. Minting stayed behind
 * consent. These tests are what stands between those two sentences.
 *
 * The first describe EXECUTES the mint against the exact consent object
 * signature-capture.tsx holds while the disclosure step is open, and
 * fails if a row is written or a code encoded. The second checks the
 * component wiring by reading the source, which is what a node-env test
 * can do about a client component with hooks and is the same technique
 * tests/signing-handoff-routes.test.ts already uses on the phone half
 * of this ceremony. Both are needed: the first proves the mint refuses,
 * the second proves the button in front of it does not even ask.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const CAPTURE = 'app/sign/[token]/signature-capture.tsx';
const HANDOFF = 'app/sign/[token]/mobile-handoff.tsx';

/**
 * What the card is handed while the disclosure step is open.
 *
 * erdConsentedAt is set in advanceFromDisclosure and nowhere else, and
 * docPresentedAtReview is frozen at the same moment, so before the
 * signer continues every field is empty. Written out here rather than
 * imported, so a change to the component that started filling these in
 * early would fail the test rather than move it.
 */
const DISCLOSURE_STEP_CONSENT = {
  electronicRecordsConsentedAt: null,
  hardwareSoftwareConfirmedAt: null,
  documentPresented: false,
  documentReviewedAt: null,
};

/** The same object a moment after the signer presses Continue. */
const CAPTURE_STEP_CONSENT = {
  electronicRecordsConsentedAt: '2026-08-08T10:00:00.000Z',
  hardwareSoftwareConfirmedAt: '2026-08-08T10:00:00.000Z',
  documentPresented: true,
  documentReviewedAt: '2026-08-08T10:00:00.000Z',
};

function deps() {
  const created: string[] = [];
  const encoded: string[] = [];
  const value: MintHandoffDeps = {
    origin: 'https://advottic.com',
    loadSignature: async () => ({
      id: 'sig-1',
      signedAt: null,
      accessCodeHash: null,
      accessCodeVerifiedAt: null,
      response: null,
    }),
    createHandoff: async (signatureId) => {
      created.push(signatureId);
      return { ok: true, rawToken: 'handoff-token-bbbbbbbbbbbbbbbbbbbb' };
    },
    encode: (url) => {
      encoded.push(url);
      return '<svg></svg>';
    },
  };
  return { value, created, encoded };
}

describe('nothing is minted from the disclosure step', () => {
  it('refuses the consent the disclosure step actually holds', async () => {
    const { value, created, encoded } = deps();

    const result = await mintSigningHandoff(
      'durable-signer-token-aaaaaaaaaaaaaaaaaaaa',
      DISCLOSURE_STEP_CONSENT,
      value,
    );

    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_DISCLOSURE });
    // The security property, stated as the two side effects that must
    // not have happened: no handoff row exists, so there is nothing a
    // phone could scan, and nothing was encoded into an image.
    expect(created).toEqual([]);
    expect(encoded).toEqual([]);
  });

  it('mints once the signer has continued past the disclosure', async () => {
    const { value, created } = deps();

    const result = await mintSigningHandoff(
      'durable-signer-token-aaaaaaaaaaaaaaaaaaaa',
      CAPTURE_STEP_CONSENT,
      value,
    );

    expect(result.ok).toBe(true);
    expect(created).toEqual(['sig-1']);
  });

  it('lets the card ask the same question the mint answers', () => {
    // The client cannot import the mint, so it imports the mint's own
    // consent check. If these two ever disagree the card offers a
    // button that the server refuses, or hides one it would have
    // honoured.
    expect(handoffCodeAvailable(DISCLOSURE_STEP_CONSENT)).toBe(false);
    expect(handoffCodeAvailable(CAPTURE_STEP_CONSENT)).toBe(true);
  });
});

/**
 * The two checks below used to read one file. The card, its phase machine and
 * its poll now live in components/signing/PhoneHandoffCard.tsx, shared with
 * the employee's form, and only the consent binding stayed in HANDOFF. That
 * split is exactly the shape in which a guard keeps passing while the thing it
 * guards has moved out from under it, so the assertions follow the code into
 * both files rather than being relaxed to whatever still matches.
 */
const CARD = 'components/signing/PhoneHandoffCard.tsx';

describe('the button in front of the mint', () => {
  it('never calls the server action without a consent to carry', () => {
    const handoff = read(HANDOFF);
    const card = read(CARD);

    // The signer's binding computes availability from the mint's own consent
    // check, and it is the only thing that can call the action.
    expect(handoff).toContain('available={handoffCodeAvailable(consent)}');
    expect(handoff.match(/mintSigningHandoffAction\(/g)).toHaveLength(1);

    // The card refuses ahead of the only call to whatever it was given.
    const guard = card.indexOf('if (!availableRef.current) return;');
    const call = card.indexOf('await mintRef.current()');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    // The refusal is ahead of the only call, so no ordering of clicks reaches
    // it before consent exists.
    expect(guard).toBeLessThan(call);
    // And it is the only call site, so the guard is not standing in front of
    // one of two doors.
    expect(card.match(/mintRef\.current\(\)/g)).toHaveLength(1);
  });

  it('is disabled until a code could actually be minted', () => {
    // `|| disabled` was added for the employee's desk, where the affirmation
    // gates the section and a mint would otherwise be the way around a shut
    // pad. It only ever ADDS a reason to refuse, so the signer's own gate
    // below is untouched: !available still disables the button on its own.
    expect(read(CARD)).toContain(
      "disabled={phase.kind === 'minting' || !available || disabled}",
    );
    expect(read(HANDOFF)).toContain('handoffCodeAvailable(consent)');
  });

  /**
   * The surface's gate is re-checked inside the mint, not only on the button.
   *
   * The twin of the availability check above, and it needs its own guard for
   * the reason that check has one: a faded button is still a button. The
   * employee's affirmation is the only thing holding this shut, and a QR is
   * precisely the way around a shut pad, so a mint that trusted the disabled
   * attribute would hand back a signature made before anybody affirmed
   * anything.
   *
   * It is read from a ref rather than the prop so that the callback, which is
   * built once with an empty dependency list, cannot answer with the value
   * `disabled` had when the card first rendered.
   *
   * Deleting this whole re-check left all 4150 tests green, which is why the
   * assertion exists. Comments stripped before matching, because the lines
   * above the check explain it using the same words.
   */
  it('re-checks the surface gate inside the mint, not just on the button', () => {
    const card = stripComments(read(CARD));

    // Held in a ref and kept current, so a stale closure cannot reopen it.
    expect(card).toContain('const disabledRef = useRef(disabled);');
    expect(card).toContain('disabledRef.current = disabled;');

    const guard = card.indexOf('if (disabledRef.current) return;');
    const call = card.indexOf('await mintRef.current()');
    expect(guard, 'the mint no longer re-checks the surface gate').toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    // Ahead of the only call, so no ordering of clicks reaches the mint first.
    expect(guard).toBeLessThan(call);
    expect(card.match(/mintRef\.current\(\)/g)).toHaveLength(1);
  });
});

describe('one card, on both steps', () => {
  it('renders a single MobileHandoff, not a pre-consent copy of it', () => {
    const src = read(CAPTURE);
    // Placed twice, built once. A second <MobileHandoff means a second
    // set of props that can drift from the first.
    expect(src.match(/<MobileHandoff\b/g)).toHaveLength(1);
    // Built once above the step returns, placed in two of them.
    expect(src.match(/\bmobileHandoff\}/g)).toHaveLength(2);
  });

  it('offers it on the disclosure step and not only at capture', () => {
    const src = read(CAPTURE);
    const disclosure = src.indexOf("if (step === 'disclosure')");
    // The condition gained phonePermitted when the firm was given a
    // per-template say over the four signature methods. The card is still
    // offered on this step; it is now also absent when the firm has not
    // allowed the phone, which is why this looks for the guard rather than
    // for the old literal.
    //
    // That guard became phoneOffered when the device joined the decision: the
    // card is withdrawn from a signer already holding a phone, because scanning
    // a code with the device displaying it is a loop rather than a handoff. What
    // this test is for is unchanged and still true - the card is offered on the
    // disclosure step and not only at capture - so only the name it looks for
    // moved. Which devices see it is tests/signer-page-on-a-phone.test.ts.
    const offered = src.indexOf(
      '{documentPresented && phoneOffered && mobileHandoff}',
    );

    expect(disclosure).toBeGreaterThan(-1);
    expect(offered).toBeGreaterThan(disclosure);
  });
});

describe('the pre-consent copy is true', () => {
  const PRE_CONSENT =
    'You can finish this on your phone. Agree to the disclosure above and continue, then ask for a code to scan on step 2.';

  it('offers the ask, not an outcome the mint could refuse', () => {
    const src = read(HANDOFF);
    expect(src).toContain(PRE_CONSENT);
    // "ask for a code" survives a firm whose handoff table is missing:
    // the press is honoured, and the refusal below is what comes back.
    expect(PRE_CONSENT).not.toMatch(/\bwill work\b|\bwill appear\b|guarantee/i);
  });

  it('sends a refused signer back to the route that always works', () => {
    // MINT_REFUSAL_UNAVAILABLE is what createHandoff's { ok: false }
    // becomes, which is the case a firm without the handoff migration
    // is in. It has to name the page as the way out.
    const mint = read('lib/signing-handoff-mint.ts');
    expect(mint).toContain('You can sign on this page instead.');
  });
});
