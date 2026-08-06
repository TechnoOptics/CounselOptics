'use client';

import { useState } from 'react';
import { useStepAnchor } from '@/lib/use-step-anchor';
import { SignaturePad, type SignaturePadValue } from '@/components/SignaturePad';

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
}: {
  token: string;
  signerEmail: string;
  signerName: string | null;
  documentName: string;
  firmName: string;
}) {
  const [step, setStep] = useState<Step>('disclosure');
  // Re-anchor the card on every step transition so the user
  // never has to scroll back up to find the new content.
  const cardRef = useStepAnchor<HTMLElement>(step);

  // Disclosure-step state.
  const [erdAgreed, setErdAgreed] = useState(false);
  const [hwAgreed, setHwAgreed] = useState(false);
  const [erdConsentedAt, setErdConsentedAt] = useState<string | null>(null);

  // Capture-step state. The pad itself lives in components/SignaturePad and
  // reports the current mark up; the ceremony around it stays here, because
  // an outside signer is owed a consumer disclosure that an employee filling
  // their own employer's template is not.
  const [mark, setMark] = useState<SignaturePadValue>({
    dataUrl: null,
    mode: 'draw',
    hasInk: false,
    typedName: null,
  });
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInk = mark.hasInk;

  function advanceFromDisclosure() {
    if (!erdAgreed || !hwAgreed) {
      setError(
        'Both confirmations are required to receive this document electronically.',
      );
      return;
    }
    setError(null);
    setErdConsentedAt(new Date().toISOString());
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
          typedName: mark.typedName,
          consent: {
            electronicRecordsConsentedAt: erdConsentedAt,
            hardwareSoftwareConfirmedAt: erdConsentedAt,
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

  if (step === 'done') {
    return (
      <section ref={cardRef} className="card p-8 text-center scroll-mt-20">
        <p className="eyebrow mb-2 justify-center">Signed</p>
        <h2 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Thanks, {signerName || signerEmail}.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Your signature for &ldquo;{documentName}&rdquo; has been recorded. The
          firm has been notified and will share the executed copy plus the
          audit trail with you.
        </p>
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

        {error && (
          <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={advanceFromDisclosure}
            disabled={!erdAgreed || !hwAgreed}
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

      <SignaturePad
        heading={<p className="eyebrow">Your signature</p>}
        defaultTypedName={signerName ?? ''}
        onChange={setMark}
        onError={setError}
      />

      <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={intentAffirmed}
          onChange={(e) => setIntentAffirmed(e.currentTarget.checked)}
          className="mt-1"
        />
        <span>
          I, <strong>{signerName || signerEmail}</strong>, intend that the
          mark above be my signature on &ldquo;{documentName}&rdquo;, with the
          same legal effect as a handwritten signature. I am acting on my
          own behalf or as authorized for the entity I represent.
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
