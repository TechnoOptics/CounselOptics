'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Mic button that streams browser speech recognition into a callback,
 * appending each finalized phrase to whatever text the parent already
 * has. Designed for the case-description textarea: people in distress
 * type slowly and lose their thread - speaking it is much easier.
 *
 * Falls back to nothing (button hidden) when the browser doesn't
 * support webkitSpeechRecognition / SpeechRecognition. We never
 * upload audio anywhere - this is 100% on-device transcription via
 * the browser's built-in API.
 */
export function VoiceDictateButton({
  onTranscript,
  className,
}: {
  onTranscript: (segment: string) => void;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const Ctor =
      (typeof window !== 'undefined' &&
        ((window as unknown as { SpeechRecognition?: typeof SpeechRecognition })
          .SpeechRecognition ||
          (window as unknown as {
            webkitSpeechRecognition?: typeof SpeechRecognition;
          }).webkitSpeechRecognition)) ||
      null;
    setSupported(!!Ctor);
  }, []);

  function start() {
    setError(null);
    const Ctor =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition })
        .SpeechRecognition ||
      (window as unknown as {
        webkitSpeechRecognition?: typeof SpeechRecognition;
      }).webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      // Each result is a final phrase since interimResults=false.
      // Append a trailing space so consecutive utterances don't clash.
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
        // Quietly stop - common when the user pauses.
      } else {
        setError(`Voice input stopped (${ev.error}).`);
      }
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setError('Could not start the microphone.');
    }
  }

  function stop() {
    recRef.current?.stop();
    setRecording(false);
  }

  useEffect(() => () => recRef.current?.abort(), []);

  if (!supported) return null;

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
