'use client';

import { useEffect, useRef, useState } from 'react';

type Mode = 'draw' | 'type';

/**
 * Client-side signature capture. Two modes:
 *
 *   - draw: free-hand canvas. We export to a base64 PNG.
 *   - type: rendered as a script font on the same canvas so the
 *     output is a single image regardless of mode.
 *
 * On submit we POST to /api/firm/sign with the token, the
 * base64 PNG, and the typed name. The route validates the token
 * server-side (admin client), records IP + user-agent, writes the
 * signature image to the firm-signatures bucket, fills in
 * firm_signatures.signed_at, and updates the parent request's
 * status (sent -> partial or completed).
 */
export function SignatureCapture({
  token,
  signerEmail,
  signerName,
  documentName,
}: {
  token: string;
  signerEmail: string;
  signerName: string | null;
  documentName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState(signerName ?? '');
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Resize canvas to its CSS box so drawing matches the cursor.
  useEffect(() => {
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
  }, []);

  // Re-render typed signature when mode/text changes.
  useEffect(() => {
    if (mode !== 'type') return;
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
  }, [mode, typed]);

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

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setTyped(signerName ?? '');
  }

  async function submit() {
    setError(null);
    if (!agreed) {
      setError('Please confirm you intend to sign electronically.');
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
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Could not record signature.');
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="card p-8 text-center">
        <p className="eyebrow mb-2 justify-center">Signed</p>
        <h2 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Thanks, {signerName || signerEmail}.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Your signature has been recorded for &ldquo;{documentName}&rdquo;. The firm has
          been notified and will share the executed copy with you.
        </p>
      </section>
    );
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Your signature</p>
        <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]">
          <button
            type="button"
            onClick={() => {
              setMode('draw');
              clear();
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
        <button type="button" onClick={clear} className="btn-ghost text-sm">
          Clear
        </button>
        <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
          {mode === 'draw' ? 'Draw with your finger or mouse' : 'Choose a font-rendered signature'}
        </span>
      </div>

      <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.currentTarget.checked)}
          className="mt-1"
        />
        <span>
          I, <strong>{signerName || signerEmail}</strong>, intend to sign this document
          electronically. I understand the v1 output is watermarked &ldquo;DRAFT - NOT
          LEGALLY BINDING&rdquo; for review purposes.
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
          onClick={submit}
          disabled={submitting || !hasInk || !agreed}
          className="btn-primary"
        >
          {submitting ? 'Recording signature...' : 'Sign document'}
        </button>
      </div>
    </section>
  );
}
