'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * How the mark was made. These are the values the database column stores, used
 * here too so there is no translation table between what the pad reports and
 * what the row records. The buttons still read Draw, Type and Upload.
 */
export type SignatureMode = 'drawn' | 'typed' | 'uploaded';

export type SignaturePadValue = {
  /** A PNG data URL of the current mark, or null when the pad is empty. */
  dataUrl: string | null;
  mode: SignatureMode;
  hasInk: boolean;
  /** The text behind a Type-mode mark, so a caller that stores the typed name
   *  separately does not have to keep its own copy of the pad's state. */
  typedName: string | null;
};

/**
 * Draw, type or upload a signature on one canvas.
 *
 * Lifted out of app/sign/[token]/signature-capture.tsx, which had offered all
 * three to outside signers for months while the firm's own employees filling a
 * template got a plain text input. This component is now the single capture
 * surface for both, so the two flows cannot drift in quality again.
 *
 * It owns the mark and nothing else. No disclosure, no intent checkbox, no
 * submit: those are ceremony, and the two callers legitimately need different
 * ceremony. An outside consumer signer is owed the E-SIGN 15 USC 7001(c)
 * disclosure; an employee signing their employer's own paper is not a consumer
 * under 15 USC 7006(1) and is not owed a paper-copy right or a withdrawal
 * notice. Keeping ceremony out of here is what lets each caller be correct.
 *
 * All three modes render onto the same canvas, so the caller reads one PNG
 * regardless of how the mark was made. A typed name is rendered in a cursive
 * face; it is a valid signature and not a lesser one.
 */
export function SignaturePad({
  heading,
  defaultTypedName,
  onChange,
  onError,
  externalMark,
  allowedModes,
}: {
  /** Sits to the left of the mode tabs, so a caller keeps its own section
   *  label on the same row rather than stacking a second one above. */
  heading?: React.ReactNode;
  /** Pre-fills Type mode, and what Clear restores it to. */
  defaultTypedName?: string;
  onChange: (value: SignaturePadValue) => void;
  /** Upload problems are reported up so each caller shows them in its own
   *  error area rather than this component inventing a second one. */
  onError?: (message: string | null) => void;
  /**
   * A PNG data URL drawn in from outside the pad, used by the phone handoff so
   * a mark made on a phone lands in the desk session's pad. The seam exists
   * here so that work does not have to reopen this file.
   */
  externalMark?: string | null;
  /**
   * Which of the three modes to offer, or omitted for all three.
   *
   * The firm chooses this per template and the server enforces it; hiding a
   * tab here is a courtesy to the signer, not a control. See
   * lib/signature-write.ts, which refuses a forbidden method whatever this
   * component rendered, because /api/firm/sign reads a token out of a request
   * body and never sees this page at all.
   *
   * An empty or unusable list falls back to all three rather than leaving the
   * signer with no way to make a mark. That is the right direction HERE and
   * only here: the server still refuses whatever the firm forbade, so the
   * worst case is a signer offered a tab that will be declined, and the
   * alternative is a pad with nothing on it and no explanation.
   */
  allowedModes?: readonly SignatureMode[];
}) {
  const ALL_MODES: readonly SignatureMode[] = ['drawn', 'typed', 'uploaded'];
  const offered =
    allowedModes && allowedModes.length > 0 ? allowedModes : ALL_MODES;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Opens on the first mode the firm actually allows, so a template that
  // forbids drawing does not greet the signer with a pad they may not use.
  const [mode, setMode] = useState<SignatureMode>(offered[0]);
  const [typed, setTyped] = useState(defaultTypedName ?? '');
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  // Bumped whenever the pixels change without hasInk changing, so the report
  // below re-runs for a typed name that was edited rather than emptied.
  const [inkVersion, setInkVersion] = useState(0);

  // Held in a ref so an inline arrow function from the caller does not restart
  // the reporting effect on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Size the canvas for the device pixel ratio once it is on the page.
  // Declared first so the typed-name render below always finds a sized canvas.
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

  // Re-render the typed signature when the mode or the text changes.
  useEffect(() => {
    if (mode !== 'typed') return;
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
    setInkVersion((v) => v + 1);
  }, [mode, typed]);

  // A mark pushed in from outside, drawn fit-inside like an upload.
  useEffect(() => {
    if (!externalMark) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      const scale = Math.min(w / img.width, h / img.height);
      ctx.drawImage(
        img,
        (w - img.width * scale) / 2,
        (h - img.height * scale) / 2,
        img.width * scale,
        img.height * scale,
      );
      setHasInk(true);
      setInkVersion((v) => v + 1);
    };
    img.src = externalMark;
  }, [externalMark]);

  // Report the current mark upward. Reading toDataURL here rather than on
  // every pointer move keeps a long stroke cheap.
  useEffect(() => {
    const canvas = canvasRef.current;
    const dataUrl = hasInk && canvas ? canvas.toDataURL('image/png') : null;
    onChangeRef.current({
      dataUrl,
      mode,
      hasInk,
      typedName: mode === 'typed' ? typed : null,
    });
  }, [mode, hasInk, inkVersion, typed]);

  function getXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'drawn') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || mode !== 'drawn') return;
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setHasInk(true);
  }
  function up() {
    if (!drawing) return;
    setDrawing(false);
    setInkVersion((v) => v + 1);
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    setTyped(defaultTypedName ?? '');
    setInkVersion((v) => v + 1);
  }

  // Attach an existing signature image. The file is drawn onto the same canvas
  // the draw and type modes use, so the caller still reads one PNG. Fit-inside
  // so nothing is cropped; for an opaque photo of a signature on paper the PNG
  // carries whatever the signer supplied.
  function onUploadFile(file: File | null) {
    onError?.(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError?.('Choose an image file (PNG, JPG, or similar).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onError?.('That image is over the 5 MB limit.');
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
      setInkVersion((v) => v + 1);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      onError?.('Could not read that image. Try a different file.');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  const tab = (m: SignatureMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        // Switching away from Type leaves a rendered name behind, which would
        // read as a drawing the person did not make.
        if (m !== 'typed') clear();
      }}
      className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center ${mode === m ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {heading ?? <span />}
        <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]">
          {offered.includes('drawn') && tab('drawn', 'Draw')}
          {offered.includes('typed') && tab('typed', 'Type')}
          {offered.includes('uploaded') && tab('uploaded', 'Upload')}
        </div>
      </div>

      {mode === 'typed' && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type your full name"
          className="input"
          maxLength={80}
        />
      )}

      {mode === 'uploaded' && (
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
          {mode === 'drawn'
            ? 'Draw with your finger, mouse, or trackpad'
            : mode === 'typed'
              ? 'A font-rendered cursive signature'
              : 'Attach an image of your signature'}
        </span>
      </div>
    </div>
  );
}
