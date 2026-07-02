'use client';

import { useEffect, useRef, useState } from 'react';
import { useStepAnchor } from '@/lib/use-step-anchor';

type Mode = 'draw' | 'type';
type Step = 'compose' | 'disclosure' | 'sign' | 'id' | 'done';

/**
 * Public, unauthenticated Letter of Support flow. Forks the UETA/E-SIGN
 * consent-then-sign pattern from app/sign/[token]/signature-capture.tsx
 * (rather than importing it directly - that component is tightly coupled
 * to /api/firm/sign and firm-branding props) and adds three more steps:
 * compose the letter + address, then capture ID front/back. Posts
 * everything together as one multipart request to
 * /api/community/[slug]/witness/letter, which is the actual trust
 * boundary (rate limiting, magic-byte validation, service-role writes) -
 * this component just collects the fields.
 */
export function LetterForm({ slug }: { slug: string }) {
  const [step, setStep] = useState<Step>('compose');
  const cardRef = useStepAnchor<HTMLElement>(step);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Compose-step state.
  const [fullName, setFullName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setStateField] = useState('');
  const [zip, setZip] = useState('');
  const [letterBody, setLetterBody] = useState('');

  // Disclosure-step state.
  const [erdAgreed, setErdAgreed] = useState(false);
  const [hwAgreed, setHwAgreed] = useState(false);
  const [erdConsentedAt, setErdConsentedAt] = useState<string | null>(null);

  // Sign-step state.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  // Captured from the canvas when leaving the sign step, since the canvas
  // itself unmounts once the flow advances to the ID step (each step is
  // conditionally rendered) - reading canvasRef.current at final submit
  // time would find nothing and silently send an empty signature.
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  // ID-step state.
  const [idFront, setIdFront] = useState<File | null>(null);
  const [idBack, setIdBack] = useState<File | null>(null);

  useEffect(() => {
    if (step !== 'sign') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f2d24';

    // Re-entering this step (e.g. clicking "Back" from the ID step) remounts
    // a blank canvas even though a drawn (not typed) signature was already
    // captured into signatureDataUrl - redraw it so the two don't drift out
    // of sync with what's on screen.
    if (mode === 'draw' && signatureDataUrl) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = signatureDataUrl;
    }
    // Only re-run this setup when the step itself changes - re-running on
    // every signatureDataUrl/mode change would reset the canvas mid-draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step !== 'sign' || mode !== 'type') return;
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
    setDrawing(false);
  }
  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setTyped('');
  }

  function advanceFromCompose() {
    if (!fullName.trim() || !street.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setError('Please fill in your name and full mailing address.');
      return;
    }
    if (!letterBody.trim()) {
      setError('Please write your letter of support.');
      return;
    }
    setError(null);
    setStep('disclosure');
  }

  function advanceFromDisclosure() {
    if (!erdAgreed || !hwAgreed) {
      setError('Both confirmations are required to continue.');
      return;
    }
    setError(null);
    setErdConsentedAt(new Date().toISOString());
    setStep('sign');
  }

  function advanceFromSign() {
    if (!intentAffirmed) {
      setError('Please affirm your intent to sign before continuing.');
      return;
    }
    if (!hasInk) {
      setError('Draw or type your signature first.');
      return;
    }
    const canvas = canvasRef.current;
    const dataUrl = canvas?.toDataURL('image/png') ?? '';
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      setError('Could not capture your signature. Please try again.');
      return;
    }
    setSignatureDataUrl(dataUrl);
    setError(null);
    setStep('id');
  }

  async function submit() {
    if (!idFront || !idBack) {
      setError('Please add a photo of the front and back of your ID.');
      return;
    }
    if (!signatureDataUrl) {
      setError('Your signature was lost - please go back and sign again.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set('fullName', fullName);
      formData.set('street', street);
      formData.set('city', city);
      formData.set('state', state);
      formData.set('zip', zip);
      formData.set('letterBody', letterBody);
      formData.set('signatureDataUrl', signatureDataUrl);
      formData.set('typedName', mode === 'type' ? typed : '');
      formData.set('electronicRecordsConsentedAt', erdConsentedAt ?? '');
      formData.set('intentAffirmedAt', new Date().toISOString());
      formData.set('idFront', idFront);
      formData.set('idBack', idBack);

      const res = await fetch(`/api/community/${slug}/witness/letter`, {
        method: 'POST',
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not submit. Please try again.');
      }
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'done') {
    return (
      <section ref={cardRef} className="card p-8 text-center scroll-mt-20">
        <p className="eyebrow mb-2 justify-center">Submitted</p>
        <h2 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Thank you, {fullName}.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Your letter of support has been recorded privately. It goes only to the organizer and
          their attorney — it is never shown publicly.
        </p>
      </section>
    );
  }

  if (step === 'compose') {
    return (
      <section ref={cardRef} className="card p-5 sm:p-6 space-y-4 scroll-mt-20">
        <header>
          <p className="eyebrow mb-1">Step 1 of 4</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Your letter
          </h2>
        </header>

        <div>
          <label className="label" htmlFor="fullName">
            Your full name
          </label>
          <input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.currentTarget.value)}
            maxLength={200}
            className="input"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="street">
              Street address
            </label>
            <input id="street" value={street} onChange={(e) => setStreet(e.currentTarget.value)} maxLength={200} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="city">
              City
            </label>
            <input id="city" value={city} onChange={(e) => setCity(e.currentTarget.value)} maxLength={100} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="state">
                State
              </label>
              <input id="state" value={state} onChange={(e) => setStateField(e.currentTarget.value)} maxLength={50} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="zip">
                ZIP
              </label>
              <input id="zip" value={zip} onChange={(e) => setZip(e.currentTarget.value)} maxLength={12} className="input" />
            </div>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="letterBody">
            What would you like the attorney and the court to know?
          </label>
          <textarea
            id="letterBody"
            value={letterBody}
            onChange={(e) => setLetterBody(e.currentTarget.value)}
            rows={8}
            maxLength={20000}
            className="input"
            placeholder="How you know this person, what you can speak to, why you're writing in support"
          />
        </div>

        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

        <div className="flex justify-end">
          <button type="button" onClick={advanceFromCompose} className="btn-primary">
            Continue
          </button>
        </div>
      </section>
    );
  }

  if (step === 'disclosure') {
    return (
      <section ref={cardRef} className="card p-5 sm:p-6 space-y-4 scroll-mt-20">
        <header>
          <p className="eyebrow mb-1">Step 2 of 4</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Electronic records and signatures disclosure
          </h2>
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
            Before you sign, please review the following. Advottic is capturing your signature
            electronically for this letter of support.
          </p>
        </header>

        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4 text-[12.5px] leading-relaxed text-ink-800 dark:text-cream-100/85 space-y-3">
          <p>
            You may request a paper copy of this letter at any time by contacting the organizer.
            You may withdraw consent to do business electronically at any time; this does not
            affect the validity of a letter already signed. You need a modern web browser, an
            internet connection, and a device that can capture a typed or drawn signature and a
            photo of your ID.
          </p>
          <p>
            By proceeding, you confirm you can access this disclosure electronically and consent
            to sign this letter electronically. You are not yet signing — that happens next.
          </p>
        </div>

        <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input type="checkbox" checked={erdAgreed} onChange={(e) => setErdAgreed(e.currentTarget.checked)} className="mt-1" />
          <span>I have read this disclosure and consent to sign electronically.</span>
        </label>
        <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input type="checkbox" checked={hwAgreed} onChange={(e) => setHwAgreed(e.currentTarget.checked)} className="mt-1" />
          <span>I confirm I have the hardware and software described above.</span>
        </label>

        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setStep('compose')} className="btn-ghost text-sm">
            Back
          </button>
          <button type="button" onClick={advanceFromDisclosure} disabled={!erdAgreed || !hwAgreed} className="btn-primary">
            Continue to sign
          </button>
        </div>
      </section>
    );
  }

  if (step === 'sign') {
    return (
      <section ref={cardRef} className="card p-5 sm:p-6 space-y-4 scroll-mt-20">
        <header>
          <p className="eyebrow mb-1">Step 3 of 4</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Sign your letter
          </h2>
        </header>

        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Your signature</p>
          <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]">
            <button
              type="button"
              onClick={() => {
                setMode('draw');
                clearSignature();
              }}
              className={`px-3 py-1.5 ${mode === 'draw' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
            >
              Draw
            </button>
            <button
              type="button"
              onClick={() => setMode('type')}
              className={`px-3 py-1.5 ${mode === 'type' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
            >
              Type
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
          <button type="button" onClick={clearSignature} className="btn-ghost text-sm">
            Clear
          </button>
          <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
            {mode === 'draw' ? 'Draw with your finger or mouse' : 'Choose a font-rendered signature'}
          </span>
        </div>

        <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input type="checkbox" checked={intentAffirmed} onChange={(e) => setIntentAffirmed(e.currentTarget.checked)} className="mt-1" />
          <span>
            I, <strong>{fullName || 'the undersigned'}</strong>, intend that the mark above be my
            signature on this letter of support, with the same legal effect as a handwritten
            signature.
          </span>
        </label>

        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setStep('disclosure')} className="btn-ghost text-sm">
            Back
          </button>
          <button type="button" onClick={advanceFromSign} disabled={!hasInk || !intentAffirmed} className="btn-primary">
            Continue
          </button>
        </div>
      </section>
    );
  }

  // step === 'id'
  return (
    <section ref={cardRef} className="card p-5 sm:p-6 space-y-5 scroll-mt-20">
      <header>
        <p className="eyebrow mb-1">Step 4 of 4</p>
        <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Confirm you&rsquo;re a real person
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          A photo of the front and back of a government ID (driver&rsquo;s license, state ID, or
          passport). This is never shown publicly — only the organizer and their attorney can see
          it, and it&rsquo;s deleted once the case is closed.
        </p>
      </header>

      <IdCapture label="Front of ID" file={idFront} onChange={setIdFront} />
      <IdCapture label="Back of ID" file={idBack} onChange={setIdBack} />

      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep('sign')} className="btn-ghost text-sm">
          Back
        </button>
        <button type="button" onClick={submit} disabled={submitting || !idFront || !idBack} className="btn-primary">
          {submitting ? 'Submitting…' : 'Submit letter'}
        </button>
      </div>
      <p className="text-xs text-ink-500 dark:text-cream-100/55 text-center leading-relaxed">
        This submission is never shown publicly. Only the organizer and their attorney can view
        it.
      </p>
    </section>
  );
}

function IdCapture({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const inputId = `id-file-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const cameraId = `id-camera-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const mainRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="btn-secondary cursor-pointer">
          Choose file
        </label>
        <label htmlFor={cameraId} className="btn-secondary cursor-pointer inline-flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Take photo
        </label>
        <span className="text-sm text-ink-500 truncate">{file?.name ?? 'No file selected'}</span>
      </div>
      <input
        ref={mainRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => onChange(e.currentTarget.files?.[0] ?? null)}
      />
      <input
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onChange(f);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}
