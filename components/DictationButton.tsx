'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * Browser dictation button that captures microphone audio and
 * streams transcribed text into the given input/textarea at the
 * cursor. Uses the Web Speech API
 * (window.SpeechRecognition / webkitSpeechRecognition) which is
 * supported in Chrome, Edge, Safari (recent), and Chromium-based
 * mobile browsers. Firefox does not support it and the button
 * gracefully disables itself.
 *
 * Interim results stream into the input live so the user sees their
 * words appear as they speak. When the recognizer finalizes a chunk
 * we replace the interim region with the final string. The input's
 * onChange handler runs on every update so any downstream listener
 * (distress detector, controlled state, etc.) keeps working as if
 * the user were typing.
 *
 * Usage:
 *   <textarea id="my-input" ... />
 *   <DictationButton targetId="my-input" />
 *
 * Or with a ref:
 *   const ref = useRef<HTMLTextAreaElement>(null);
 *   <textarea ref={ref} ... />
 *   <DictationButton targetRef={ref} />
 */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: {
    resultIndex: number;
    results: ArrayLike<{
      0: { transcript: string; confidence: number };
      isFinal: boolean;
      length: number;
    }>;
  }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function DictationButton({
  targetId,
  targetRef,
  lang = 'en-US',
  className,
  title,
}: {
  targetId?: string;
  targetRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
  lang?: string;
  className?: string;
  title?: string;
}) {
  const id = useId();
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const interimStartRef = useRef<number | null>(null);
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const getTarget = useCallback((): HTMLInputElement | HTMLTextAreaElement | null => {
    if (targetRef?.current) return targetRef.current;
    if (targetId) {
      const el = document.getElementById(targetId);
      if (
        el &&
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      )
        return el;
    }
    return null;
  }, [targetId, targetRef]);

  /**
   * Replace the value of a controlled or uncontrolled input/
   * textarea AND fire a synthetic 'input' + 'change' event so React
   * + onChange listeners see the update. Plain `el.value = ...`
   * works for the DOM but skips React's synthetic event system.
   *
   * We use the native HTMLInputElement / HTMLTextAreaElement value
   * setter so React's onChange properly re-renders controlled
   * components.
   */
  const setTargetValue = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement, newValue: string, cursorPos: number) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, newValue);
      } else {
        el.value = newValue;
      }
      try {
        el.setSelectionRange(cursorPos, cursorPos);
      } catch {
        /* some input types don't support selection - ignore */
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [],
  );

  const start = useCallback(() => {
    setError(null);
    const Ctor = getRecognitionCtor();
    const target = getTarget();
    if (!Ctor || !target) {
      setError(
        !Ctor
          ? "Your browser doesn't support voice dictation. Try Chrome or Safari."
          : 'Cannot find the input to dictate into.',
      );
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    // Anchor where in the existing text dictated content goes: at
    // the cursor at start time. We splice interim results into this
    // position and slide the cursor as we go.
    const startPos = target.selectionStart ?? target.value.length;
    interimStartRef.current = startPos;
    let lastInterim = '';
    rec.onresult = (e) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const text = r[0].transcript;
        if (r.isFinal) {
          finalChunk += text;
        } else {
          interimChunk += text;
        }
      }
      const anchor = interimStartRef.current ?? target.value.length;
      const before = target.value.slice(0, anchor);
      const after = target.value.slice(anchor + lastInterim.length);
      const composed = finalChunk
        ? finalChunk + interimChunk
        : interimChunk;
      const next = before + composed + after;
      lastInterim = composed;
      // Advance the anchor by the FINAL portion so future interim
      // chunks splice in after committed text rather than over it.
      if (finalChunk) {
        interimStartRef.current = anchor + finalChunk.length;
        lastInterim = interimChunk;
      }
      const cursorPos = before.length + composed.length;
      setTargetValue(target, next, cursorPos);
    };
    rec.onerror = (e) => {
      // 'no-speech' is fine - the user just paused. Everything
      // else is worth surfacing.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser settings.'
          : `Dictation error: ${e.error}`,
      );
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onstart = () => setListening(true);
    try {
      rec.start();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not start dictation.',
      );
    }
  }, [getTarget, lang, setTargetValue]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  // Always stop when the component unmounts so the mic light goes
  // off + we don't leak a recognizer.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* swallow */
      }
    };
  }, []);

  if (supported === false) {
    return (
      <button
        type="button"
        title="Voice dictation isn't supported in this browser. Try Chrome or Safari."
        disabled
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-ink-100 text-ink-400 text-[12px] font-medium cursor-not-allowed ${className ?? ''}`}
        aria-label="Voice dictation not supported"
      >
        <MicIcon />
        Dictate
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={listening ? stop : start}
        title={
          title ?? (listening ? 'Stop dictation' : 'Click to dictate into this field')
        }
        aria-pressed={listening}
        aria-controls={targetId}
        aria-label={listening ? 'Stop dictation' : 'Start voice dictation'}
        id={`dict-${id}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${
          listening
            ? 'bg-rose-500 text-white hover:bg-rose-400 animate-pulse'
            : 'bg-forest-900 text-cream-100 hover:bg-forest-800 dark:bg-cream-100/10 dark:text-cream-100 dark:hover:bg-cream-100/15'
        } ${className ?? ''}`}
      >
        <MicIcon />
        {listening ? 'Listening…' : 'Dictate'}
      </button>
      {error && (
        <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
    </>
  );
}

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
