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
  phoneTab = null,
  disabled = false,
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
   * OMITTED means no restriction, and all three are offered. An EMPTY LIST is
   * a different statement and is not widened back: it is what padModesFor
   * returns for a template restricted to the phone, and reading it as "no
   * preference" offered every method the firm had just forbidden, on this
   * page, in a component whose whole job here is to respect them. The same
   * asymmetry lib/signature-methods.ts keeps between null and [] on the way
   * in is kept here on the way out.
   *
   * With nothing to offer the pad says so instead of drawing a canvas. The
   * sentence is deliberately neutral about WHY, because this component does
   * not know: an empty list arrives both from a template restricted to the
   * phone, where the surface below has a QR card, and from a template
   * restricted to nothing at all, where it has an apology. Naming the phone
   * here would be false in the second case, and each surface says the true
   * thing beneath it.
   */
  allowedModes?: readonly SignatureMode[];
  /**
   * A fourth tab that is NOT a pad mode.
   *
   * Signing on a phone is one of the four methods a firm can allow, but it is
   * a HANDOFF, not something this pad produces: the phone draws and the mark
   * arrives back through `externalMark`. It used to render as a separate card
   * below the pad, which is why it was reported as missing from the options -
   * three tabs on one row and the fourth way somewhere further down does not
   * read as four ways of signing.
   *
   * So the caller supplies the panel and keeps the handoff logic, and this
   * component only lends it a place in the strip. `panel` replaces the pad
   * surface while its tab is selected; nothing about the pad's own modes
   * changes, and signatureMethodFromPadMode still refuses the string 'phone'.
   */
  phoneTab?: { label: string; panel: React.ReactNode } | null;
  /**
   * Hold every control shut, because the caller's ceremony is not ready.
   *
   * The employee's form ticks this until the signer has affirmed their intent,
   * so the affirmation is asked BEFORE a mark can be made rather than after
   * one already has been.
   *
   * It is real disabling and not a fade. The obvious version of this is
   * `opacity-50` on the wrapper, which changes nothing at all: the canvas
   * still takes a pointer, the tabs still take a click and a Tab key, the file
   * input still opens a picker, and a screen reader announces every one of
   * them as ordinary live controls. So each control carries the `disabled`
   * attribute that actually stops it and actually gets announced, and the
   * canvas, which has no such attribute, refuses in its handlers and says
   * `aria-disabled` for the readers that would otherwise never be told.
   *
   * The caller still has to shut its own `phoneTab` panel. This component only
   * lends that panel a place in the strip and cannot reach inside it, so the
   * tab button here is disabled and the panel's own button is the caller's to
   * hold. See the `disabled` prop on components/signing/PhoneHandoffCard.
   */
  disabled?: boolean;
}) {
  const ALL_MODES: readonly SignatureMode[] = ['drawn', 'typed', 'uploaded'];
  const offered = allowedModes ?? ALL_MODES;
  const nothingOffered = offered.length === 0;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Opens on the first mode the firm actually allows, so a template that
  // forbids drawing does not greet the signer with a pad they may not use.
  // `?? 'drawn'` only for the empty case, which returns the sentence below
  // before any of this state is reachable. A hook cannot be skipped, so the
  // state still has to be declared with something.
  const [mode, setMode] = useState<SignatureMode>(offered[0] ?? 'drawn');
  // Which tab is showing, when the answer is not one of the pad's own modes.
  // Separate from `mode` on purpose: `mode` is what the pad would PRODUCE, and
  // the phone produces nothing here. Defaults on when the phone is the only
  // way left, so a phone-only template opens on the thing it can do.
  const [onPhoneTab, setOnPhoneTab] = useState(nothingOffered && !!phoneTab);
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
    if (disabled || mode !== 'drawn') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = getXY(e);
    const ctx = e.currentTarget.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setDrawing(true);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || !drawing || mode !== 'drawn') return;
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
    if (disabled) return;
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
      disabled={disabled}
      onClick={() => {
        setOnPhoneTab(false);
        setMode(m);
        // Switching away from Type leaves a rendered name behind, which would
        // read as a drawing the person did not make.
        if (m !== 'typed') clear();
      }}
      className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center disabled:opacity-55 disabled:cursor-not-allowed ${mode === m ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
    >
      {label}
    </button>
  );

  // Nothing this pad can do is allowed here. Said plainly rather than by
  // drawing a canvas whose every mark the server would refuse.
  if (nothingOffered && !phoneTab) {
    return (
      <div className="space-y-3">
        {heading}
        <p className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 px-3 py-2.5 text-[13px] leading-relaxed text-ink-700 dark:text-cream-100/80">
          This document cannot be signed on this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {heading ?? <span />}
        <div className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]">
          {offered.includes('drawn') && tab('drawn', 'Draw')}
          {offered.includes('typed') && tab('typed', 'Type')}
          {offered.includes('uploaded') && tab('uploaded', 'Upload')}
          {phoneTab && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                // Leaving a pad mark behind while the phone draws would put
                // two signatures in play and send whichever won the race.
                clear();
                setOnPhoneTab(true);
              }}
              className={`px-3 py-1.5 min-h-[40px] inline-flex items-center justify-center disabled:opacity-55 disabled:cursor-not-allowed ${onPhoneTab ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
            >
              {phoneTab.label}
            </button>
          )}
        </div>
      </div>

      {/* The phone's panel stands in for the pad surface. The pad's own
          controls stay mounted below only when a pad mode is showing, so a
          person on the Phone tab is not offered a Clear for a canvas they
          cannot see. */}
      {onPhoneTab && phoneTab ? (
        phoneTab.panel
      ) : (
      <>
      {mode === 'typed' && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type your full name"
          className="input disabled:opacity-55 disabled:cursor-not-allowed"
          maxLength={80}
          disabled={disabled}
        />
      )}

      {mode === 'uploaded' && (
        <label className="flex items-center gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onUploadFile(e.currentTarget.files?.[0] ?? null)}
            disabled={disabled}
            className="block w-full text-[12px] file:mr-3 file:min-h-[40px] file:rounded-md file:border-0 file:bg-forest-900 file:px-3 file:text-white disabled:opacity-55 disabled:cursor-not-allowed dark:file:bg-gold-metal dark:file:text-forest-950"
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
          // A canvas takes no `disabled` attribute, so this is the only way it
          // is announced as unavailable at all. The handlers above refuse
          // independently: this attribute tells a reader, it does not enforce.
          aria-disabled={disabled || undefined}
          className={`w-full h-32 sm:h-40 touch-none rounded-md ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-crosshair'}`}
          style={{ display: 'block' }}
        />
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="btn-ghost text-sm disabled:opacity-55 disabled:cursor-not-allowed"
        >
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
      </>
      )}
    </div>
  );
}
