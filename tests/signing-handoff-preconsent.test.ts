import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
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

describe('the button in front of the mint', () => {
  it('never calls the server action without a consent to carry', () => {
    const src = read(HANDOFF);
    const guard = src.indexOf('if (!handoffCodeAvailable(consentRef.current)) return;');
    const call = src.indexOf('await mintSigningHandoffAction(');

    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    // The refusal is ahead of the only call to the action, so no
    // ordering of clicks reaches it before consent exists.
    expect(guard).toBeLessThan(call);
    // And it is the only call site, so the guard is not standing in
    // front of one of two doors.
    expect(src.match(/mintSigningHandoffAction\(/g)).toHaveLength(1);
  });

  it('is disabled until a code could actually be minted', () => {
    expect(read(HANDOFF)).toContain(
      "disabled={phase.kind === 'minting' || !available}",
    );
    expect(read(HANDOFF)).toContain('handoffCodeAvailable(consent)');
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
    const offered = src.indexOf('{documentPresented && mobileHandoff}');

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
