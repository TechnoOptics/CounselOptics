'use client';

import { useCallback, useState } from 'react';
import { useStepAnchor } from '@/lib/use-step-anchor';
import {
  canLeaveDisclosureStep,
  type SignatureLinePlacement,
} from '@/lib/signer-view';
import { SignaturePad, type SignaturePadValue } from '@/components/SignaturePad';
import {
  SIGNING_INTENT_PREFIX,
  signingIntentSuffix,
} from '@/lib/signing-intent';
import { SignatureLinePreview } from './signature-line-preview';
import { MobileHandoff } from './mobile-handoff';
import {
  padModesFor,
  signatureMethodFromPadMode,
  signatureMethodsOnDevice,
  type SignatureMethod,
} from '@/lib/signature-methods';

type Step = 'disclosure' | 'capture' | 'done';

/**
 * Client-side signature capture. Two-step flow:
 *
 *   1. disclosure: the UETA / E-SIGN Act consumer disclosure. The
 *      signer must affirmatively agree to do business electronically
 *      AND confirm hardware/software readiness BEFORE seeing the
 *      signature pad. This ordering matters - 15 USC 7001(c) requires
 *      consent to electronic delivery be obtained "after the consumer"
 *      has been given the disclosure, not bundled into the signature.
 *
 *   2. capture: free-hand canvas or font-rendered typed signature. The
 *      "intent to sign" checkbox carries the canonical UETA intent
 *      language, separate from the electronic-records consent in
 *      step 1.
 *
 * That ordering is unchanged. What is added is the document: it is now
 * rendered above this component, and step 1 asks the signer to confirm
 * they have reviewed it, because E-SIGN and UETA both rest on the
 * signer having access to the record they are assenting to. The
 * confirmation is only asked for when the document was actually shown,
 * and when it was NOT shown the step does not open at all: a document
 * that failed to load is the exact case where the signer has not read
 * what they are being asked to sign.
 *
 * Step 2 also shows the signature line. The mark does not appear in a
 * schematic beside the pad any more: the document is rasterised above
 * this component, the viewer moves to the signature page when this
 * step opens, and the mark is drawn into the real box on the real
 * page. That is why the canvas snapshot is published upwards rather
 * than kept here.
 *
 * Submit posts the token, the base64 PNG, the typed name, and a
 * record of the consent timestamps to /api/firm/sign. The server
 * persists the signature image, fills firm_signatures.signed_at, and
 * appends the 'signed' event to the audit chain.
 */
export function SignatureCapture({
  token,
  signerEmail,
  signerName,
  documentName,
  firmName,
  documentPresented,
  placement,
  signatureMethods,
  viewerOnPhone,
  copyPermitted,
  copyHref,
  onMarkChange,
  onStepChange,
}: {
  token: string;
  signerEmail: string;
  signerName: string | null;
  documentName: string;
  firmName: string;
  /** Whether the document actually rendered on the page above this. */
  documentPresented: boolean;
  placement: SignatureLinePlacement;
  /**
   * Which of the four methods the firm allows on this document. Null means all
   * four, which is what every request meant before the setting existed.
   *
   * Used here only to decide what to offer. The server refuses a forbidden
   * method whatever this component renders: see lib/signature-write.ts. A
   * signer should not draw their name and then be told, which is why the tabs
   * respect it, and an attacker posting straight at /api/firm/sign is why the
   * tabs are not the control.
   */
  signatureMethods: SignatureMethod[] | null;
  /**
   * Whether the signer is already holding a phone, established on the server
   * from the request's user agent.
   *
   * Used for exactly two things, and it is worth naming both because they pull
   * in opposite directions: it WITHDRAWS the QR handoff, which is a loop on a
   * phone, and it WIDENS what the pad may offer, so the phone-only template the
   * handoff used to be the sole route for is still signable here.
   *
   * It never decides what is RECORDED. Drawing on a phone is a drawn signature
   * made on a phone, which is a different claim from the attested 'phone'
   * method, and lib/signature-write.ts keeps them apart on the server.
   */
  viewerOnPhone: boolean;
  /** Whether the firm allows this signer to download a copy. */
  copyPermitted: boolean;
  copyHref: string;
  /** The mark as it stands, so the document above can draw it into the
   *  signature box. Published rather than held here, because the box
   *  is on the rendered page and not in this component. */
  onMarkChange: (dataUrl: string | null) => void;
  /** Which step the signer is on, so the viewer above can move to the
   *  signature page when the pad opens. */
  onStepChange: (step: 'disclosure' | 'capture' | 'done') => void;
}) {
  const [step, setStepState] = useState<Step>('disclosure');
  const setStep = useCallback(
    (next: Step) => {
      setStepState(next);
      onStepChange(next);
    },
    [onStepChange],
  );
  // Re-anchor the card on every step transition so the user
  // never has to scroll back up to find the new content.
  const cardRef = useStepAnchor<HTMLElement>(step);

  // Disclosure-step state.
  const [erdAgreed, setErdAgreed] = useState(false);
  const [hwAgreed, setHwAgreed] = useState(false);
  const [docReviewed, setDocReviewed] = useState(false);
  const [erdConsentedAt, setErdConsentedAt] = useState<string | null>(null);
  const [docReviewedAt, setDocReviewedAt] = useState<string | null>(null);
  // Frozen beside docReviewedAt, not read live at submit.
  //
  // The prop is live: it follows the renderer, so a page that fails to
  // draw after the signer has reached the pad flips it back to false
  // while the step stays open and submit stays available. Reading it
  // at submit time then writes document_presented false into the chain
  // next to a populated document_reviewed_at, and a verifier reading
  // that pair concludes the signer affirmed reviewing a document they
  // were never shown. The record should say what was true when they
  // affirmed it, so it is captured then.
  const [docPresentedAtReview, setDocPresentedAtReview] = useState(false);

  // Capture-step state. The pad itself lives in components/SignaturePad and
  // reports the current mark up; the ceremony around it stays here, because
  // an outside signer is owed a consumer disclosure that an employee filling
  // their own employer's template is not.
  const [mark, setMark] = useState<SignaturePadValue>({
    dataUrl: null,
    mode: 'drawn',
    hasInk: false,
    typedName: null,
  });
  // What the pad may offer, and whether the phone route is on the table. Both
  // derive from one prop so the tabs and the QR card cannot disagree about
  // what this template allows.
  //
  // The restriction is resolved against the DEVICE first. lib/signature-methods.ts
  // has always held that the phone is a method delivering a DRAWN mark and that
  // the QR handoff is the errand a desk runs to borrow a touchscreen it does not
  // have. This signer may already be holding one, in which case the errand is
  // done and a template restricted to 'phone' is satisfied by drawing here. On a
  // desk signatureMethodsOnDevice returns the restriction untouched, so nothing
  // about the desktop ceremony moves.
  const methodsHere = signatureMethodsOnDevice(signatureMethods, viewerOnPhone);
  const padModes = padModesFor(methodsHere);
  const phonePermitted = signatureMethods === null || signatureMethods.includes('phone');
  // Permitted by the firm is not the same as worth offering. Handing a phone a
  // code to scan with itself is a loop, and the signer's only way out of it was
  // to work out that the card was not meant for them - on a legal instrument,
  // part way through a ceremony. Whoever is on a phone draws on the screen they
  // are already holding, which padModes above has just made sure they can.
  const phoneOffered = phonePermitted && !viewerOnPhone;
  // The pad has a drawn tab HERE ONLY BECAUSE this device is the phone the firm
  // asked for. Worth saying out loud: the signer is looking at a single option
  // on a document whose settings say phone, and without this the page never
  // explains why. Not shown when the firm allowed drawing anyway, because then
  // the tab needs no explaining.
  const drawingStandsInForThePhone =
    viewerOnPhone &&
    signatureMethods !== null &&
    signatureMethods.includes('phone') &&
    !signatureMethods.includes('draw');
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInk = mark.hasInk;

  // The pad reports the mark. It is kept here for submit and published
  // upward so the rasterised page above can draw it into the real
  // signature box as the signer makes it. The pad snapshots the canvas
  // when a stroke ends rather than on every pointer move, which keeps
  // the drawing cheap and the page above it undisturbed.
  const handleMark = useCallback(
    (next: SignaturePadValue) => {
      setMark(next);
      onMarkChange(next.dataUrl);
    },
    [onMarkChange],
  );

  const mayLeaveDisclosure = canLeaveDisclosureStep({
    electronicRecordsAgreed: erdAgreed,
    hardwareSoftwareAgreed: hwAgreed,
    documentPresented,
    documentReviewed: docReviewed,
  });

  function advanceFromDisclosure() {
    if (!mayLeaveDisclosure) {
      setError(
        !documentPresented
          ? 'The document did not open on this page, so there is nothing to sign yet. Please ask the firm to send it to you.'
          : !erdAgreed || !hwAgreed
            ? 'Both confirmations are required to receive this document electronically.'
            : 'Please confirm you have reviewed the document above.',
      );
      return;
    }
    setError(null);
    setErdConsentedAt(new Date().toISOString());
    if (documentPresented && !docReviewedAt) {
      setDocReviewedAt(new Date().toISOString());
      setDocPresentedAtReview(documentPresented);
    }
    setStep('capture');
  }

  async function submit() {
    setError(null);
    if (!intentAffirmed) {
      setError(
        'Please affirm your intent to sign before submitting.',
      );
      return;
    }
    if (!hasInk) {
      setError('Draw or type your signature first.');
      return;
    }
    const dataUrl = mark.dataUrl;
    if (!dataUrl) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/firm/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signatureDataUrl: dataUrl,
          // How the mark was made, translated from the pad's own vocabulary
          // in lib/signature-methods.ts rather than by a literal here. The
          // server checks it against what this request allows; it is not
          // believed.
          method: signatureMethodFromPadMode(mark.mode),
          typedName: mark.typedName,
          consent: {
            electronicRecordsConsentedAt: erdConsentedAt,
            hardwareSoftwareConfirmedAt: erdConsentedAt,
            // Whether the document was put in front of the signer, and
            // when they affirmed they had read it. The server records
            // both in the 'signed' event, so a later dispute about
            // whether the signer was ever shown the record has an
            // answer in the chain rather than only in this browser.
            // documentReviewedAt stays null when nothing was shown,
            // which the gate above no longer allows through anyway.
            // Both are the pair captured at the affirmation, so they
            // can never contradict each other in the chain.
            documentPresented: docPresentedAtReview,
            documentReviewedAt: docReviewedAt,
            intentAffirmedAt: new Date().toISOString(),
            uaSnapshot:
              typeof navigator !== 'undefined' ? navigator.userAgent : null,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Could not record signature.');
        setSubmitting(false);
        return;
      }
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  /**
   * A fourth way to make the mark, and the only one a signer can start
   * on the first screen.
   *
   * One element, built once and placed on both steps, rather than a
   * pre-consent copy beside a live one. Two call sites of the same
   * component with the same props cannot show the signer two different
   * things, and cannot drift into doing so later.
   *
   * The consent below is the same capture the desktop submit sends, so
   * a signature finished on the phone carries the same evidence as one
   * finished on this page. On the disclosure step it is still empty,
   * which is what keeps the card an offer there and not a code: the
   * component and the server both refuse to mint without it.
   */
  const mobileHandoff = (
    <MobileHandoff
      signerToken={token}
      consent={{
        electronicRecordsConsentedAt: erdConsentedAt,
        hardwareSoftwareConfirmedAt: erdConsentedAt,
        documentPresented: docPresentedAtReview,
        documentReviewedAt: docReviewedAt,
      }}
      onSigned={() => setStep('done')}
    />
  );

  if (step === 'done') {
    return (
      <section ref={cardRef} className="card p-8 text-center scroll-mt-20">
        <p className="eyebrow mb-2 justify-center">Signed</p>
        <h2 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Thanks, <span data-no-translate>{signerName || signerEmail}</span>.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Your signature for &ldquo;{documentName}&rdquo; has been recorded. The
          firm has been notified and will share the executed copy plus the
          audit trail with you.
        </p>
        {copyPermitted ? (
          <>
            <a href={copyHref} className="btn-primary mt-5 inline-flex">
              Download your copy
            </a>
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-3 leading-relaxed">
              If other people still have to sign, this is the document as you
              signed it. The fully executed version, with every signature on
              it, is available from this same link once everyone has finished.
            </p>
          </>
        ) : (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-4 leading-relaxed">
            {firmName} has not enabled downloads for this document. You can ask
            them for a copy at any time, and they can send you a paper copy at
            no charge.
          </p>
        )}
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-4 leading-relaxed">
          Keep this email or page reference for your records. The signed copy
          is associated with a tamper-evident audit trail you can request at
          any time.
        </p>
      </section>
    );
  }

  if (step === 'disclosure') {
    return (
      <section ref={cardRef} className="card p-5 sm:p-6 space-y-4 scroll-mt-20">
        <header>
          <p className="eyebrow mb-1">Step 1 of 2</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Electronic records and signatures disclosure
          </h2>
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
            Before you sign, please review the following. {firmName} is using
            Advottic Counsel to deliver this document and capture your
            signature electronically.
          </p>
        </header>

        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4 text-[12.5px] leading-relaxed text-ink-800 dark:text-cream-100/85 space-y-3">
          <Section title="Your right to receive paper copies">
            You may request a paper copy of this document from {firmName} at
            any time, before or after you sign, at no charge. Email the firm
            using the contact they provided alongside this signing link.
          </Section>
          <Section title="Withdrawing your consent">
            You may withdraw your consent to do business electronically at
            any time by replying to the firm and asking to receive paper
            documents instead. Withdrawing consent does not affect the legal
            validity of any record signed before the withdrawal.
          </Section>
          <Section title="Updating your contact information">
            If your email or phone number changes, contact the firm directly.
            Advottic does not allow signers to update their own contact
            details on the firm&rsquo;s record.
          </Section>
          <Section title="Hardware and software you need">
            A modern web browser (Chrome, Safari, Edge, or Firefox released
            in the last two years), an internet connection, and a device
            able to render the document and capture either a typed name or a
            drawn signature. A PDF viewer is required to read the signed
            output. If you cannot use these, ask the firm for a paper copy
            instead.
          </Section>
          <Section title="What you are agreeing to">
            By proceeding, you confirm that you can access this disclosure
            and the document electronically, and you consent to receive
            records related to this matter electronically through Advottic
            Counsel. You are not yet signing the document - that happens in
            step 2.
          </Section>
        </div>

        <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input
            type="checkbox"
            checked={erdAgreed}
            onChange={(e) => setErdAgreed(e.currentTarget.checked)}
            className="mt-1"
          />
          <span>
            I have read this disclosure and I consent to receive records
            related to this matter electronically.
          </span>
        </label>
        <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input
            type="checkbox"
            checked={hwAgreed}
            onChange={(e) => setHwAgreed(e.currentTarget.checked)}
            className="mt-1"
          />
          <span>
            I confirm I have the hardware and software described above and
            can access electronic records on this device.
          </span>
        </label>
        {/* Asked only when the document is actually on the page above.
            Confirming review of something never shown would be a
            fiction the audit chain would then carry. When it was not
            shown, the step does not open at all: see the notice
            below. */}
        {documentPresented && (
          <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
            <input
              type="checkbox"
              checked={docReviewed}
              onChange={(e) => setDocReviewed(e.currentTarget.checked)}
              className="mt-1"
            />
            <span>
              I have reviewed the document shown above, in full.
            </span>
          </label>
        )}

        {/* A document that failed to load is a blocker, not a footnote.
            The signer has not seen the record, so the ceremony stops
            here rather than letting them complete it having read only
            the notice above. */}
        {!documentPresented && (
          <p className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/60 dark:bg-forest-900/40 px-3 py-2.5 text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
            The document did not open on this page, so signing is not
            available. You should not be asked to sign something you have not
            read. Please ask <span data-no-translate>{firmName}</span> to send
            you the document, then use this link again.
          </p>
        )}

        {/* Offered here so the signer knows the phone route exists
            before they commit to the laptop, and disabled here for the
            same reason the notice above stops the ceremony: when the
            document never opened there is nothing to sign on any
            device. Absent altogether for a signer already on a phone:
            there is no laptop to commit to and nothing to hand off
            to. */}
        {documentPresented && phoneOffered && mobileHandoff}

        {error && (
          <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={advanceFromDisclosure}
            disabled={!mayLeaveDisclosure}
            className="btn-primary"
          >
            Continue to sign
          </button>
        </div>
      </section>
    );
  }

  return (
    <section ref={cardRef} className="card p-5 sm:p-6 space-y-4 scroll-mt-20">
      <header>
        <p className="eyebrow mb-1">Step 2 of 2</p>
        <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Sign the document
        </h2>
      </header>

      <SignatureLinePreview
        placement={placement}
        signerLabel={signerName || signerEmail}
      />

      <SignaturePad
        heading={<p className="eyebrow">Your signature</p>}
        defaultTypedName={signerName ?? ''}
        allowedModes={padModes}
        onChange={handleMark}
        onError={setError}
      />

      {/* The same element the disclosure step showed, now holding a
          consent and therefore able to mint. Absent entirely when the firm
          has not allowed signing on a phone: an offer that would be refused
          on scanning is worse than no offer. lib/signing-handoff-mint.ts
          refuses to mint one regardless, because this is a browser.

          Absent on a phone too, for a different reason: not that the offer
          would be refused, but that taking it up is impossible. The pad
          directly above is the route here, and it has a canvas even on a
          phone-only document. */}
      {phoneOffered && mobileHandoff}

      {/* The firm asked for this one to be signed on a phone, and this is
          one. Said plainly, so a single tab reads as the answer rather than
          as something missing. */}
      {drawingStandsInForThePhone && (
        <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          This document is signed on a phone, and you are on one. Draw your
          signature on this screen.
        </p>
      )}

      <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={intentAffirmed}
          onChange={(e) => setIntentAffirmed(e.currentTarget.checked)}
          className="mt-1"
        />
        <span>
          {/* The words come from lib/signing-intent.ts, which the phone
              pad and the employee form both read. A signer who starts
              here and finishes on their phone affirms intent twice in
              one ceremony, and two surfaces asserting intent in two
              forms of words is the kind of discrepancy that gets a
              signature challenged, so no surface keeps a copy of them.

              The name is the signer's own, inside the sentence that
              makes the mark a signature, and stays in its own element:
              the runtime translation layer would otherwise
              machine-translate a person's name in the operative clause
              of a legal instrument. */}
          {SIGNING_INTENT_PREFIX}
          <strong data-no-translate>{signerName || signerEmail}</strong>
          {signingIntentSuffix(documentName)}
        </span>
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep('disclosure')}
          className="btn-ghost text-sm"
        >
          Back to disclosure
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !hasInk || !intentAffirmed}
          className="btn-primary"
        >
          {submitting ? 'Recording signature...' : 'Sign document'}
        </button>
      </div>
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-semibold text-forest-900 dark:text-cream-100 mb-1">
        {title}
      </p>
      <p>{children}</p>
    </div>
  );
}
