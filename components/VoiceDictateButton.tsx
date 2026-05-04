'use client';

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

/**
 * Mic button that streams speech-to-text into a callback. Two paths:
 *
 *   1. Native shells (Capacitor on Android / iOS) - uses
 *      @capacitor-community/speech-recognition. Permission prompt is
 *      handled by the plugin; transcribed text is appended in
 *      partial-result chunks so the user sees their words appear
 *      while they speak.
 *
 *   2. Web (desktop / mobile browsers) - uses the browser's built-in
 *      SpeechRecognition / webkitSpeechRecognition. On Chrome /
 *      Edge / mobile Chrome that's perfectly serviceable; on Safari
 *      it works only in iOS 14.5+ and the API is still vendor-
 *      prefixed in some contexts.
 *
 * Falls back to a hidden button when neither path is supported. We
 * never upload audio anywhere - both paths transcribe in-process or
 * via the device's own speech service.
 */
export function VoiceDictateButton({
  onTranscript,
  className,
}: {
  onTranscript: (segment: string) => void;
  className?: string;
}) {
  // Detection state. We probe both paths during mount; whichever
  // works first wins. Native path is preferred on Capacitor shells
  // because the OS-level recognizer outperforms the WebView's.
  const [path, setPath] = useState<'native' | 'web' | 'none'>('none');
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webRecRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      // Native path probe: only on Capacitor shells.
      if (Capacitor.isNativePlatform()) {
        try {
          const avail = await SpeechRecognition.available();
          if (cancelled) return;
          if (avail.available) {
            setPath('native');
            return;
          }
        } catch {
          /* fall through to web detection */
        }
      }
      // Web path probe.
      if (typeof window !== 'undefined') {
        const W = window as unknown as {
          SpeechRecognition?: typeof window.SpeechRecognition;
          webkitSpeechRecognition?: typeof window.SpeechRecognition;
        };
        const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
        if (Ctor) {
          if (!cancelled) setPath('web');
          return;
        }
      }
      if (!cancelled) setPath('none');
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Native (Capacitor) path. Uses partial-results so the user sees
   * the transcript fill in while they speak. Each finalised
   * partial is appended via the parent's onTranscript callback so
   * the textarea state updates in real time.
   */
  async function startNative() {
    setError(null);
    try {
      const perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') {
        const req = await SpeechRecognition.requestPermissions();
        if (req.speechRecognition !== 'granted') {
          setError('Microphone permission denied. Tap the lock icon in Settings to allow it.');
          return;
        }
      }
      // The plugin pushes partial-result events. The contract is
      // that each callback fires with the FULL transcript so far,
      // not deltas. We track the previous total and emit only the
      // delta to onTranscript so the parent can append cleanly.
      let prev = '';
      const listener = await SpeechRecognition.addListener(
        'partialResults',
        (data: { matches: string[] }) => {
          const next = (data.matches?.[0] ?? '').trim();
          if (!next || next === prev) return;
          // Sometimes recognition collapses an utterance; only emit
          // additions, never overwrites.
          if (next.startsWith(prev)) {
            const delta = next.slice(prev.length);
            if (delta.trim()) onTranscript(delta);
          } else {
            // New utterance segment - append a leading space.
            onTranscript(' ' + next);
          }
          prev = next;
        },
      );
      // Stash the listener handle on the recRef so stop() can clear it.
      webRecRef.current = listener as unknown as SpeechRecognition;
      await SpeechRecognition.start({
        language: navigator.language || 'en-US',
        partialResults: true,
        popup: false,
      });
      setRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start microphone.';
      setError(msg);
      setRecording(false);
    }
  }

  async function stopNative() {
    try {
      await SpeechRecognition.stop();
      await SpeechRecognition.removeAllListeners();
    } catch {
      /* best-effort cleanup */
    }
    setRecording(false);
  }

  /**
   * Web path. Uses the browser's SpeechRecognition. Each finalised
   * phrase is appended as a delta, matching the native path.
   */
  function startWeb() {
    setError(null);
    const W = window as unknown as {
      SpeechRecognition?: typeof window.SpeechRecognition;
      webkitSpeechRecognition?: typeof window.SpeechRecognition;
    };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) text += r[0].transcript + ' ';
      }
      if (text) onTranscript(text);
    };
    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setError('Microphone access was blocked. Tap the lock icon and allow it.');
      } else if (ev.error === 'no-speech') {
        /* quiet stop on natural pauses */
      } else {
        setError(`Voice input stopped (${ev.error}).`);
      }
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    try {
      rec.start();
      webRecRef.current = rec;
      setRecording(true);
    } catch {
      setError('Could not start the microphone.');
    }
  }

  function stopWeb() {
    webRecRef.current?.stop();
    setRecording(false);
  }

  function start() {
    if (path === 'native') void startNative();
    else if (path === 'web') startWeb();
  }
  function stop() {
    if (path === 'native') void stopNative();
    else if (path === 'web') stopWeb();
  }

  // Cleanup on unmount: native and web paths both have stale-listener
  // foot-guns if we leave a recognizer running while the parent
  // navigates away.
  useEffect(
    () => () => {
      if (path === 'native') void stopNative();
      else if (path === 'web') webRecRef.current?.abort?.();
    },
    [path],
  );

  if (path === 'none') return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={recording ? stop : start}
        aria-pressed={recording}
        aria-label={recording ? 'Stop dictation' : 'Dictate with your voice'}
        title={recording ? 'Stop dictation' : 'Dictate with your voice'}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition-colors ${
          recording
            ? 'bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
            : 'bg-white text-forest-900 ring-ink-200 hover:bg-cream-50 dark:bg-forest-900 dark:text-cream-100 dark:ring-forest-700/60 dark:hover:bg-forest-800'
        }`}
      >
        <MicIcon recording={recording} />
        {recording ? 'Listening...' : 'Dictate'}
      </button>
      {error && (
        <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}

function MicIcon({ recording }: { recording: boolean }) {
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
      className={recording ? 'animate-pulse' : ''}
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" />
    </svg>
  );
}
