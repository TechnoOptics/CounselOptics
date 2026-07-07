'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation via the Web Speech API (SpeechRecognition). Works inside the
 * Safari/WebKit WebView the iOS app runs in and in Chrome; degrades to nothing
 * where unsupported (the mic button simply doesn't render). Final recognised
 * chunks are handed back so the caller can append them to a text field.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/** Toggle-to-talk mic. Appends each finalised phrase via onAppend. */
export function MicButton({
  onAppend,
  className = '',
  title = 'Dictate',
}: {
  onAppend: (text: string) => void;
  className?: string;
  title?: string;
}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const appendRef = useRef(onAppend);
  appendRef.current = onAppend;

  useEffect(() => {
    setSupported(dictationSupported());
    return () => { try { recRef.current?.abort(); } catch { /* ignore */ } };
  }, []);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let sinceFlush = '';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const chunk = r[0].transcript.trim();
          if (chunk && chunk !== sinceFlush) {
            sinceFlush = chunk;
            appendRef.current(chunk.endsWith('.') || chunk.endsWith('?') ? chunk + ' ' : chunk + ' ');
          }
        }
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      title={listening ? 'Stop dictation' : title}
      aria-pressed={listening}
      aria-label={listening ? 'Stop dictation' : title}
      className={`inline-grid h-8 w-8 flex-none place-items-center rounded-lg border transition-colors ${
        listening
          ? 'animate-pulse border-rose-400 bg-rose-500/15 text-rose-600'
          : 'border-forest-900/15 text-ink-500 hover:bg-forest-900/5 dark:border-cream-50/15 dark:text-cream-300 dark:hover:bg-cream-50/10'
      } ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 11a7 7 0 01-14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
