import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { stripComments } from './support/strip-comments';

/**
 * The outside signer's page, on a phone.
 *
 * THE DEFECT. app/sign/[token]/signature-capture.tsx offered the QR handoff on
 * `phonePermitted` alone, with no device condition, on both of its steps. A
 * signer already holding a phone was asked to scan a code with the device
 * displaying it, and a document restricted to ['phone'] had no other route at
 * all: padModesFor(['phone']) is empty, so there was no canvas either. The
 * employee form had the same defect and it was fixed first; this is the higher
 * stakes surface, because what is being signed here is an executed instrument
 * and the signer is an outside party under legal stress.
 *
 * WHY THIS FILE BOTH RENDERS AND READS SOURCE, which is worth stating because
 * mixing the two is usually a smell.
 *
 * The disclosure step is RENDERED. It is reachable from the component's initial
 * state, so renderToStaticMarkup reaches the real markup a real signer's first
 * paint would contain, and the assertions are on the words and controls they
 * would see.
 *
 * The capture step is not reachable that way: it is behind a click, vitest runs
 * in environment: 'node' with no DOM, and this repo has no jsdom. So the second
 * mount of the handoff is held to account by READING the component, with
 * comments stripped first. That is a weaker instrument and it is used for
 * exactly one claim - that both mounts are gated on the same resolved flag -
 * rather than as a substitute for looking. The capture step on a real phone was
 * verified in a real browser with real pointer events; see the report attached
 * to this change.
 */

vi.mock('../app/sign/[token]/handoff-actions', () => ({
  mintSigningHandoffAction: async () => ({ ok: false, error: 'stub' }),
  signingCompletedAction: async () => ({ signed: false, scanned: false }),
}));

const { SignatureCapture } = await import('../app/sign/[token]/signature-capture');

/** The handoff card's own button label, from components/signing/PhoneHandoffCard. */
const MINT_BUTTON = 'Sign with mobile';
/**
 * The sentence the card shows on the DISCLOSURE step, which is the step these
 * renders reach.
 *
 * Deliberately not the `offer` copy. Before there is a consent to carry the card
 * is not yet able to mint, so it renders `notYet` instead, and a test asserting
 * the offer sentence here fails against correct code. That mistake was made
 * writing this file and is recorded rather than quietly corrected: a sentinel
 * that never appears would have turned every assertion using it into a
 * permanent green in the not.toContain direction.
 */
const NOT_YET_COPY = 'You can finish this on your phone.';

function ceremony(opts: {
  signatureMethods: unknown;
  viewerOnPhone: boolean;
  documentPresented?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(SignatureCapture as never, {
      token: 'tok-1',
      signerEmail: 'dana@outside.test',
      signerName: 'Dana Reyes',
      documentName: 'Mutual NDA',
      firmName: 'Anderson Foundation',
      documentPresented: opts.documentPresented ?? true,
      placement: { mode: 'deferred', reason: 'no-recorded-position' },
      signatureMethods: opts.signatureMethods,
      viewerOnPhone: opts.viewerOnPhone,
      copyPermitted: true,
      copyHref: '/api/firm/sign/copy/tok-1',
      onMarkChange: () => {},
      onStepChange: () => {},
    }),
  );
}

describe('the disclosure step on a phone', () => {
  it('does not offer a code to scan with the device showing it', () => {
    const html = ceremony({ signatureMethods: null, viewerOnPhone: true });
    expect(html).not.toContain(MINT_BUTTON);
    expect(html).not.toContain(NOT_YET_COPY);
  });

  it('still opens the ceremony, rather than withdrawing it with the handoff', () => {
    const html = ceremony({ signatureMethods: null, viewerOnPhone: true });
    expect(html).toContain('Continue to sign');
  });

  /**
   * A document restricted to the phone is the case the loop was total on: the
   * QR was the only route the page offered, and it was a code to scan with the
   * scanning device. The offer is gone and the ceremony still opens.
   */
  it('does not strand a phone-only document with no route at all', () => {
    const html = ceremony({ signatureMethods: ['phone'], viewerOnPhone: true });
    expect(html).not.toContain(MINT_BUTTON);
    expect(html).toContain('Continue to sign');
  });
});

describe('the disclosure step on a desktop', () => {
  /** Unchanged, and that is the point: this screen cannot be drawn on with a
   *  finger, so the phone is a genuine second device here. */
  it('still offers the phone', () => {
    const html = ceremony({ signatureMethods: null, viewerOnPhone: false });
    expect(html).toContain(MINT_BUTTON);
    expect(html).toContain(NOT_YET_COPY);
  });

  it('still offers the phone on a phone-only document', () => {
    const html = ceremony({ signatureMethods: ['phone'], viewerOnPhone: false });
    expect(html).toContain(MINT_BUTTON);
  });

  /** The firm's decision still comes first. A document that forbids the phone
   *  never shows the card, on any device. */
  it('does not offer the phone when the firm forbade it', () => {
    const html = ceremony({ signatureMethods: ['draw', 'type'], viewerOnPhone: false });
    expect(html).not.toContain(MINT_BUTTON);
  });

  /** A tablet is not a phone. iPadOS reports a Macintosh user agent, so
   *  lib/platform.ts cannot identify one and deliberately does not try; the
   *  handoff stays, which is the truthful route for a docked tablet. */
  it('keeps the handoff for anything not identified as a phone', () => {
    const html = ceremony({ signatureMethods: ['phone'], viewerOnPhone: false });
    expect(html).toContain(MINT_BUTTON);
  });
});

describe('a document that never opened', () => {
  /** The pre-existing rule, which the device must not have disturbed: with no
   *  document on the page there is nothing to sign on any device. */
  it('offers the handoff on neither device', () => {
    for (const viewerOnPhone of [true, false]) {
      const html = ceremony({
        signatureMethods: null,
        viewerOnPhone,
        documentPresented: false,
      });
      expect(html).not.toContain(MINT_BUTTON);
      expect(html).toContain('signing is not');
    }
  });
});

/**
 * The wiring the render above cannot reach.
 *
 * Comments are STRIPPED before every match here. The comments in this component
 * discuss `phonePermitted`, `signatureMethods` and the QR at length, so a guard
 * matching raw source would be satisfied by the prose explaining the fix rather
 * than by the fix. That has happened twice in this repo.
 */
const CAPTURE = 'app/sign/[token]/signature-capture.tsx';
const SURFACE = 'app/sign/[token]/signer-surface.tsx';
const PAGE = 'app/sign/[token]/page.tsx';
const read = (rel: string) =>
  stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));

describe('the capture step', () => {
  /**
   * One element, two mounts, as the pre-existing tests already require. If a
   * third appears this count fails and the two claims below stop covering the
   * whole component.
   *
   * Counting `mobileHandoff}` rather than the surrounding condition: an earlier
   * draft counted `{documentPresented && ` and got three, because the document
   * review checkbox on the disclosure step is gated on the same prop and has
   * nothing to do with the handoff.
   */
  it('mounts the handoff exactly twice, which is what the two gates below cover', () => {
    expect(read(CAPTURE).split('mobileHandoff}').length).toBe(3);
    expect(read(CAPTURE).split('<MobileHandoff').length).toBe(2);
  });

  /**
   * Both mounts read the device-resolved flag. This is the actual defect: the
   * capture step's mount was `{phonePermitted && mobileHandoff}` with no device
   * condition, so a phone still got a QR there even once the disclosure step
   * stopped showing one.
   */
  it('gates both mounts of the handoff on the device-resolved flag', () => {
    const src = read(CAPTURE);
    expect(src).toContain('{documentPresented && phoneOffered && mobileHandoff}');
    expect(src).toContain('{phoneOffered && mobileHandoff}');
  });

  /** The raw permission is never a render gate on its own. It is still read, to
   *  build phoneOffered, and that single use is what this pins. */
  it('never renders the handoff on the firm permission alone', () => {
    const src = read(CAPTURE);
    expect(src).not.toMatch(/\{\s*phonePermitted\s*&&\s*mobileHandoff\s*\}/);
    expect(src).not.toMatch(/documentPresented\s*&&\s*phonePermitted\s*&&/);
  });

  /** The pad is fed the device-resolved restriction, which is what gives a
   *  phone-only document a canvas on a phone. Fed the raw column it would have
   *  no tabs at all and the page would offer no route. */
  it('builds the pad from the device-resolved restriction', () => {
    const src = read(CAPTURE);
    expect(src).toContain('signatureMethodsOnDevice(signatureMethods, viewerOnPhone)');
    expect(src).toContain('padModesFor(methodsHere)');
    expect(src).not.toContain('padModesFor(signatureMethods)');
  });
});

/**
 * The intent affirmation, and how the device change interacts with it.
 *
 * This page HAS an affirmation, and it sits in a different place from the
 * employee form's: it is below the pad and gates SUBMISSION, while the thing
 * that gates the pad existing at all is the two-step disclosure. That ordering
 * is not changed here, because moving it is a separate decision.
 *
 * What matters for this change is that widening the pad on a phone did not route
 * around it. A phone-only document now has a canvas it never had, so the mark it
 * produces is new, and it must be behind the same affirmation every other mark
 * on this surface is. Verified in a real browser too, with real ink drawn: submit
 * stayed disabled until the box was ticked.
 */
describe('the intent affirmation', () => {
  it('still gates submission, including the mark a phone can now make', () => {
    const src = read(CAPTURE);
    expect(src).toContain('disabled={submitting || !hasInk || !intentAffirmed}');
  });

  /** And the handler refuses too, so the disabled attribute is not the control. */
  it('is re-checked in the submit handler and not only on the button', () => {
    const src = read(CAPTURE);
    expect(src).toMatch(/if \(!intentAffirmed\) \{/);
  });

  /**
   * The affirmation is not device-conditional. A phone must not get a shorter
   * ceremony than a desk, which is the way this change could have gone wrong.
   */
  it('is asked for on every device', () => {
    const src = read(CAPTURE);
    expect(src).not.toMatch(/viewerOnPhone[^\n]*intentAffirmed/);
    expect(src).not.toMatch(/intentAffirmed[^\n]*viewerOnPhone/);
    expect(src.split('intentAffirmed').length - 1).toBeGreaterThan(2);
  });
});

describe('where the device answer comes from', () => {
  /** Read off the request, on the server, before the first byte of HTML. */
  it('is established from the request header on the server', () => {
    const src = read(PAGE);
    expect(src).toContain('isPhoneUserAgent');
    expect(src).toContain("headers().get('user-agent')");
    expect(src).toContain('viewerOnPhone');
  });

  it('is passed down through the surface rather than resolved again', () => {
    expect(read(SURFACE)).toContain('viewerOnPhone={viewerOnPhone}');
    expect(read(PAGE)).toContain('viewerOnPhone={viewerOnPhone}');
  });

  /**
   * Not defaulted, anywhere on the chain. A default is how this regresses: a
   * caller that forgets the prop should be a type error, not a page that
   * quietly puts the QR back in front of somebody holding a phone.
   */
  it('is not defaulted at any hop', () => {
    for (const rel of [CAPTURE, SURFACE]) {
      expect(read(rel)).not.toMatch(/viewerOnPhone\s*=\s*(false|true)/);
      expect(read(rel)).not.toMatch(/viewerOnPhone\?\s*:/);
    }
  });
});
