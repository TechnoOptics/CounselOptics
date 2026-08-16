'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SIGNING_INTENT_PREFIX,
  signingIntentSuffix,
} from '@/lib/signing-intent';

/**
 * The phone half of a signing ceremony that started on a laptop.
 *
 * A pad and nothing else. The document, the electronic-records
 * disclosure and the confirmation that the record was read all happened
 * on the laptop before the code was offered, and repeating any of them
 * on a four-inch screen would either be theatre or would ask the signer
 * to affirm something they cannot see here.
 *
 * The one thing that IS repeated is the intent sentence, because the
 * mark is being made here. It comes from lib/signing-intent.ts, the
 * same module the laptop reads, so the two devices cannot end up
 * asserting intent in two different forms of words. The signer's name
 * sits in its own element marked data-no-translate, exactly as it does
 * on the laptop, so the runtime translation layer never rewrites a
 * person's name inside the operative clause.
 */
export function MobilePad({
  handoffToken,
  signerLabel,
  documentName,
  firmName,
  firmLogoUrl,
  submitPath = '/api/firm/sign/mobile',
  doneMessage = 'Your signature has been recorded. You can put your phone down and go back to your computer.',
}: {
  handoffToken: string;
  signerLabel: string;
  documentName: string;
  /** Whose paper this is. All optional: a firm with no logo is the common case
   *  and the screen is designed to look finished without one. */
  firmName?: string | null;
  firmLogoUrl?: string | null;
  /**
   * Where the mark goes. Two ceremonies end on this pad and they do not end in
   * the same place: an outside signer's phone COMPLETES a signature, and an
   * employee's phone hands a picture back to the desk that is still the only
   * thing able to file anything. A prop rather than a second copy of this
   * component, because the two have to draw the same mark and ask for intent
   * in the same words, and a copy is how that stops being true.
   */
  submitPath?: string;
  /**
   * What the phone says when it is finished. It travels with submitPath and
   * for the same reason: "recorded" is true of a signature that has just been
   * written to firm_signatures and is NOT true of a picture handed back to a
   * desk that has not filed anything yet. A pad that told the employee their
   * signature was recorded would be describing something that has not
   * happened.
   */
  doneMessage?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Size the backing store to the device pixel ratio. Without this the
  // stroke is drawn into a canvas a third of the resolution of the
  // screen showing it and a phone renders a soft, blurry signature.
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f2d24';
  }, []);

  useEffect(() => {
    sizeCanvas();
    // A phone rotated mid-signature would otherwise keep a canvas sized
    // for the old orientation. Resizing clears the ink, which is why the
    // button state is reset with it rather than left claiming a mark
    // that is no longer on the canvas.
    const onResize = () => {
      sizeCanvas();
      setHasInk(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [sizeCanvas]);

  // React attaches touch listeners at the root and treats them as
  // passive, so preventDefault inside an onTouchMove prop does nothing.
  // The listener has to be attached to the canvas itself with
  // passive:false or the page scrolls under the drawing finger and the
  // signature comes out as a smear.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    //
    // Only touchmove. Cancelling touchstart as well would buy nothing
    // that touch-action:none on the canvas does not already do, and on
    // some browsers it suppresses events the pointer handlers rely on.
    const block = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchmove', block, { passive: false });
    return () => canvas.removeEventListener('touchmove', block);
  }, []);

  function getXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setHasInk(true);
  }
  function up() {
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  async function submit() {
    setError(null);
    if (!intentAffirmed) {
      setError('Please affirm your intent to sign before submitting.');
      return;
    }
    if (!hasInk) {
      setError('Draw your signature first.');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSubmitting(true);
    try {
      const res = await fetch(submitPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The handoff token, which this phone already holds because it
          // is in the address bar. Never a signature id: the server
          // resolves that from the bound handoff and would refuse one
          // sent from here anyway.
          handoffToken,
          signatureDataUrl: canvas.toDataURL('image/png'),
          intentAffirmedAt: new Date().toISOString(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Could not record signature.');
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  // Once the mark is gone, this pad must not come back.
  //
  // The server already refuses a second submission and a re-fetch of this page
  // renders "Your signature has already gone to your computer" rather than a
  // pad, so nothing can be signed twice. What it does not stop is the BACK
  // BUTTON restoring this entry from the browser's cache: the person taps
  // back, sees a blank pad where they just signed, and reasonably concludes
  // the signature was lost.
  //
  // pushState + popstate rather than replaceState. replaceState only rewrites
  // the current entry, so back would still leave toward whatever preceded the
  // scan, which on a fresh tab is nothing and closes the tab mid-ceremony.
  // Pushing one entry and re-pushing it on popstate keeps a back press on this
  // confirmation, which is the screen that tells the truth.
  //
  // Armed ONLY after a successful submit, so it can never trap somebody who
  // has not signed and wants to leave.
  useEffect(() => {
    if (!done || typeof window === 'undefined') return;
    window.history.pushState(null, '', window.location.href);
    const hold = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', hold);
    return () => window.removeEventListener('popstate', hold);
  }, [done]);

  if (done) {
    return (
      /*
        The signed screen.
        ...
        This is the last thing a signer sees, and until now it was an eyebrow, a
        line of thanks and a sentence, left-aligned at the top of a card. It
        read like a form validation message at the end of a ceremony that had
        just put somebody's name on a legal instrument.
        ...
        The mark is the subject. A drawn tick, stroked rather than filled and
        animated once, because the thing being confirmed is an act rather than
        a state. Under prefers-reduced-motion it simply appears.
        ...
        The firm's logo sits at the FOOT, not the top. On a page reached by
        scanning a code, the question in the signer's mind is "did that work",
        and answering it first is the screen's job. Whose paper it was is the
        reassurance underneath, not the headline. A firm with no logo gets its
        name in the same slot, so the layout never has a hole in it.
      */
      <Shell>
        <div className="text-center">
          <SignedMark />
          <p className="eyebrow mt-5 justify-center">Signed</p>
          <h1 className="font-display mt-2 text-[26px] font-medium leading-[1.15] tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Thank you, <span data-no-translate>{signerLabel}</span>.
          </h1>
          <p className="mx-auto mt-3 max-w-[30ch] text-[15px] leading-relaxed text-ink-600 dark:text-cream-100/70">
            {doneMessage}
          </p>

          {/* The document, named, because a signer may have several open and
              this is their only record of which one they just signed. */}
          <p className="mt-5 border-t border-edge pt-4 text-[13px] text-ink-500 dark:text-cream-100/50">
            <span data-no-translate>{documentName}</span>
          </p>

          {(firmLogoUrl || firmName) && (
            <div className="mt-4 flex flex-col items-center gap-2">
              {firmLogoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={firmLogoUrl}
                  alt={firmName ? `${firmName} logo` : 'Company logo'}
                  className="h-8 w-auto max-w-[160px] object-contain"
                />
              ) : null}
              {firmName && (
                <p className="text-[12px] tracking-[0.02em] text-ink-500 dark:text-cream-100/50">
                  <span data-no-translate>{firmName}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="eyebrow mb-2">Sign on your phone</p>
      <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        <span data-no-translate>{documentName}</span>
      </h1>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
        Draw your signature below with your finger. It goes straight onto the
        document open on your computer.
      </p>

      <div className="mt-5 rounded-lg border-2 border-dashed border-ink-300 dark:border-forest-700/60 bg-white dark:bg-forest-950 p-1">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          className="w-full h-44 touch-none cursor-crosshair rounded-md"
          style={{ display: 'block' }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={clear} className="btn-ghost text-sm">
          Clear
        </button>
        <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
          Take your time. You can clear and start again.
        </span>
      </div>

      <label className="mt-5 flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={intentAffirmed}
          onChange={(e) => setIntentAffirmed(e.currentTarget.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          {SIGNING_INTENT_PREFIX}
          <strong data-no-translate>{signerLabel}</strong>
          {signingIntentSuffix(documentName)}
        </span>
      </label>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !hasInk || !intentAffirmed}
        className="btn-primary mt-5 w-full justify-center min-h-[52px]"
      >
        {submitting ? 'Recording signature...' : 'Sign document'}
      </button>
    </Shell>
  );
}

/**
 * A tick, drawn.
 *
 * Stroked rather than filled, and drawn once on arrival with a dash offset, so
 * it reads as the moment of confirmation rather than a badge that was always
 * there. No emoji: this is a legal instrument's confirmation screen, and a
 * glyph borrowed from a chat app would undercut it.
 */
function SignedMark() {
  return (
    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-forest-900/5 dark:bg-cream-100/10">
      <style>{`
        .sig-tick { stroke-dasharray: 32; stroke-dashoffset: 32; animation: sig-draw 620ms cubic-bezier(.22,.61,.36,1) 120ms forwards; }
        @media (prefers-reduced-motion: reduce) { .sig-tick { animation: none; stroke-dashoffset: 0; } }
        @keyframes sig-draw { to { stroke-dashoffset: 0; } }
      `}</style>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          className="sig-tick"
          d="M4 12.5l5.2 5.2L20 7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    /*
      Centred, and on the phone's real viewport.
      ...
      Photographed on a Samsung over wireless debugging: the card sat high with
      a screen of dead space under it, and a sliver of the page showed past the
      right edge. Three things were wrong and all three are here.
      ...
      `min-h-dvh` rather than `min-h-screen`, because `100vh` on a phone is the
      viewport WITHOUT the browser chrome, so the page was taller than the space
      it had and the whole thing could scroll a little. `dvh` is the space that
      actually exists.
      ...
      `overflow-x-hidden` for the sliver: something inside is wider than the
      column, and on a signing screen a page that slides sideways under the
      thumb reads as broken. Hidden here rather than hunted down inside, because
      this Shell is the boundary that owns the page width.
      ...
      The safe-area inset keeps the card off the home indicator, which on this
      device sits inside the viewport rather than below it.
    */
    <div
      className="flex min-h-dvh items-center justify-center overflow-x-hidden bg-cream-50 px-4 py-6 dark:bg-forest-950"
      style={{
        paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
      }}
    >
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  );
}
