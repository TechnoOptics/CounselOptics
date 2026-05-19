'use client';

import { useEffect, useRef, useState } from 'react';
// Capacitor plugins are loaded at runtime via dynamic import so the
// SSR module graph never resolves them. Importing them eagerly used
// to pull native side-effects into the server render of every page
// that transitively reaches /cases/new (smart-assist tree), which
// surfaced as React #419 crashes on cases/new and on any other route
// that shares its chunk graph. Audit V3 CR-22 / V5 CR-22.
async function loadNativeMods() {
  const [core, sr] = await Promise.all([
    import('@capacitor/core'),
    import('@capacitor-community/speech-recognition'),
  ]);
  return { Capacitor: core.Capacitor, SpeechRecognition: sr.SpeechRecognition };
}

// Synchronous "is this a native shell?" probe that doesn't trigger
// the dynamic import. Capacitor sets `window.Capacitor` on app
// boot, so we can read it the same way lib/biometric.ts does.
function isNativeShellSync(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

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
  // `SpeechRecognition` (the global DOM type) is the web-API recognizer
  // ref; for the native path we stash a listener handle in here too,
  // which is why the type is intentionally broad.
  const webRecRef = useRef<SpeechRecognition | null>(null);
  // Web SpeechRecognition (Chrome) auto-stops after a short silence
  // and fires `onend`. Users read that as "dictation is broken - it
  // won't let me keep talking". We keep a desired-state flag so
  // `onend` can transparently restart the recognizer until the user
  // actually presses Stop. Also lets cleanup tell a real stop from
  // an auto-stop.
  const wantWebRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function detect() {
      // Native path probe: only on Capacitor shells. The native
      // probe synchronously short-circuits on web via the
      // window.Capacitor check so we never trigger the dynamic
      // imports on desktop browsers.
      if (isNativeShellSync()) {
        try {
          const { SpeechRecognition } = await loadNativeMods();
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
      const { SpeechRecognition } = await loadNativeMods();
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
      const { SpeechRecognition } = await loadNativeMods();
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
   *
   * Two reliability fixes vs. the naive version:
   *  1. getUserMedia permission pre-flight. webkitSpeechRecognition's
   *     own permission prompt is flaky on some Chromium builds (it can
   *     silently no-op or throw `not-allowed` with no prompt). Asking
   *     for the mic explicitly first makes the grant deterministic and
   *     gives a clear, actionable error when it is blocked. We release
   *     the tracks immediately - the recognizer opens its own stream.
   *  2. Auto-restart on `onend`. Chrome ends recognition after a few
   *     seconds of silence; without this the user has to re-press the
   *     button after every pause, which reads as "dictation doesn't
   *     work". We restart until the user actually presses Stop.
   */
  async function startWeb() {
    setError(null);
    const W = window as unknown as {
      SpeechRecognition?: typeof window.SpeechRecognition;
      webkitSpeechRecognition?: typeof window.SpeechRecognition;
    };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return;

    // Permission pre-flight.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setError(
        'Microphone access was blocked. Click the lock icon in the address bar, allow the microphone, and try again.',
      );
      return;
    }

    wantWebRef.current = true;

    const buildRec = (): SpeechRecognition => {
      const rec = new Ctor();
      rec.lang = navigator.language || 'en-US';
      // interimResults so words appear while speaking (matches the
      // native path), but only finals are emitted to the parent so
      // the textarea never fills with provisional, re-written text.
      rec.interimResults = true;
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
        if (
          ev.error === 'not-allowed' ||
          ev.error === 'service-not-allowed'
        ) {
          wantWebRef.current = false;
          setError(
            'Microphone access was blocked. Click the lock icon in the address bar and allow it.',
          );
          setRecording(false);
        } else if (ev.error === 'no-speech' || ev.error === 'aborted') {
          /* transient - onend will restart while the user wants it */
        } else {
          wantWebRef.current = false;
          setError(`Voice input stopped (${ev.error}).`);
          setRecording(false);
        }
      };
      rec.onend = () => {
        // Chrome auto-stops on silence. Restart unless the user
        // pressed Stop (or a fatal error cleared the flag).
        if (wantWebRef.current) {
          try {
            rec.start();
          } catch {
            // A failed restart (e.g. too rapid) - try a fresh
            // instance once before giving up.
            try {
              const fresh = buildRec();
              webRecRef.current = fresh;
              fresh.start();
            } catch {
              wantWebRef.current = false;
              setRecording(false);
            }
          }
        } else {
          setRecording(false);
        }
      };
      return rec;
    };

    try {
      const rec = buildRec();
      rec.start();
      webRecRef.current = rec;
      setRecording(true);
    } catch {
      wantWebRef.current = false;
      setError('Could not start the microphone.');
    }
  }

  function stopWeb() {
    wantWebRef.current = false;
    webRecRef.current?.stop();
    setRecording(false);
  }

  function start() {
    if (path === 'native') void startNative();
    else if (path === 'web') void startWeb();
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
      else if (path === 'web') {
        // Clear desired-state FIRST so the recognizer's onend doesn't
        // auto-restart into an unmounted component.
        wantWebRef.current = false;
        webRecRef.current?.abort?.();
      }
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
