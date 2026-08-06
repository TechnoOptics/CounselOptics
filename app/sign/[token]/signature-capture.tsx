'use client';

import { useEffect, useRef, useState } from 'react';
import { useStepAnchor } from '@/lib/use-step-anchor';
import {
  canLeaveDisclosureStep,
  type SignatureLinePlacement,
} from '@/lib/signer-view';
import { SignatureLinePreview } from './signature-line-preview';

type Mode = 'draw' | 'type' | 'upload';
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
 * Step 2 also shows the signature line: the mark appears in the
 * position the executed copy will use, from the same recorded
 * coordinates the renderer stamps into.
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
  copyPermitted,
  copyHref,
}: {
  token: string;
  signerEmail: string;
  signerName: string | null;
  documentName: string;
  firmName: string;
  /** Whether the document is actually on the page above this. */
  documentPresented: boolean;
  placement: SignatureLinePlacement;
  /** Whether the firm allows this signer to download a copy. */
  copyPermitted: boolean;
  copyHref: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [step, setStep] = useState<Step>('disclosure');
  // Re-anchor the card on every step transition so the user
  // never has to scroll back up to find the new content.
  const cardRef = useStepAnchor<HTMLElement>(step);

  // Disclosure-step state.
  const [erdAgreed, setErdAgreed] = useState(false);
  const [hwAgreed, setHwAgreed] = useState(false);
  const [docReviewed, setDocReviewed] = useState(false);
  const [erdConsentedAt, setErdConsentedAt] = useState<string | null>(null);
  const [docReviewedAt, setDocReviewedAt] = useState<string | null>(null);

  // Capture-step state.
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState(signerName ?? '');
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A snapshot of the canvas, so the signature line above the pad can
  // show the mark in position without a second drawing surface. Taken
  // when a stroke ends rather than on every pointer move, which keeps
  // the drawing itself cheap.
  const [markDataUrl, setMarkDataUrl] = useState<string | null>(null);

  function captureMark() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      setMarkDataUrl(canvas.toDataURL('image/png'));
    } catch {
      // A tainted canvas would throw here. The pad still works and the
      // submit path reads the canvas directly; only the preview is lost.
      setMarkDataUrl(null);
    }
  }

  // Resize canvas when entering the capture step.
  useEffect(() => {
    if (step !== 'capture') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f2d24';
    }
  }, [step]);

  // Re-render typed signature when mode/text changes.
  useEffect(() => {
    if (step !== 'capture' || mode !== 'type') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    if (!typed.trim()) {
      setHasInk(false);
      return;
    }
    ctx.fillStyle = '#0f2d24';
    ctx.font = `italic 38px "Apple Chancery", "Lucida Handwriting", "Brush Script MT", cursive`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typed, 16, h / 2);
    setHasInk(true);
    try {
      setMarkDataUrl(canvas.toDataURL('image/png'));
    } catch {
      setMarkDataUrl(null);
    }
  }, [step, mode, typed]);

  function getXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || mode !== 'draw') return;
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setHasInk(true);
  }
  function up() {
    if (drawing) captureMark();
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setMarkDataUrl(null);
    setTyped(signerName ?? '');
  }

  // Upload / attach an existing signature image. The file is drawn onto
  // the same canvas the draw/type modes use, so the submit path (which
  // reads canvas.toDataURL) is unchanged. We fit-inside without cropping
  // and, for opaque photos of a signature on paper, the PNG carries
  // whatever the signer supplied - the firm reviews the executed doc.
  function onUploadFile(file: File | null) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (PNG, JPG, or similar).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('That image is over the 5 MB limit.');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      const scale = Math.min(w / img.width, h / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      setHasInk(true);
      captureMark();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setError('Could not read that image. Try a different file.');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSubmitting(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch('/api/firm/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signatureDataUrl: dataUrl,
          typedName: mode === 'type' ? typed : null,
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
            documentPresented,
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
        markDataUrl={markDataUrl}
        signerLabel={signerName || signerEmail}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Your signature</p>
        <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]">
          <button
            type="button"
            onClick={() => {
              setMode('draw');
              clear();
            }}
            className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center ${mode === 'draw' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
          >
            Draw
          </button>
          <button
            type="button"
            onClick={() => setMode('type')}
            className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center ${mode === 'type' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
          >
            Type
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('upload');
              clear();
            }}
            className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center ${mode === 'upload' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
          >
            Upload
          </button>
        </div>
      </div>

      {mode === 'type' && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type your full name"
          className="input"
          maxLength={80}
        />
      )}

      {mode === 'upload' && (
        <label className="flex items-center gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onUploadFile(e.currentTarget.files?.[0] ?? null)}
            className="block w-full text-[12px] file:mr-3 file:min-h-[40px] file:rounded-md file:border-0 file:bg-forest-900 file:px-3 file:text-white dark:file:bg-gold-metal dark:file:text-forest-950"
          />
        </label>
      )}

      <div className="rounded-lg border-2 border-dashed border-ink-300 dark:border-forest-700/60 bg-white dark:bg-forest-950 p-1">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className="w-full h-32 sm:h-40 touch-none cursor-crosshair rounded-md"
          style={{ display: 'block' }}
        />
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={clear} className="btn-ghost text-sm">
          Clear
        </button>
        <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
          {mode === 'draw'
            ? 'Draw with your finger, mouse, or trackpad'
            : mode === 'type'
              ? 'A font-rendered cursive signature'
              : 'Attach an image of your signature'}
        </span>
      </div>

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
