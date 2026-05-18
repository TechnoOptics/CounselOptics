'use client';

/**
 * Watch voice-note inbox - web side (Wear Phase 3c).
 *
 * The watch captures a spoken note with the system recognizer and
 * hands it to the phone as advottic.com/cases/<id>?note=<text>.
 * This island runs in the already-authenticated WebView (or web):
 * it reads the `note` query param, surfaces it as a dismissible
 * card the user can copy/act on, then strips the param so a refresh,
 * back-navigation, or shared link never re-triggers or leaks it.
 *
 * Deliberately does NOT auto-write to the case: the transcript is
 * unreviewed voice input, and a silent background write would need a
 * new server endpoint + the WebView session bridge. Keeping the user
 * in the loop is both safer and schema-free. Inert with no param, so
 * it is a harmless no-op on plain web.
 */

import { useEffect, useRef, useState } from 'react';
import { PopupPortal } from './PopupPortal';

export function WatchNoteInbox() {
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (note) requestAnimationFrame(() => panelRef.current?.focus());
  }, [note]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      // URLSearchParams decodes %20 (and +) to spaces.
      const raw = url.searchParams.get('note');
      const text = raw?.trim() ?? '';
      if (!text) return;
      // Cap to a sane length; a voice note is a reminder, not a doc.
      setNote(text.slice(0, 2000));
      // Strip the param without a navigation so refresh/back/share
      // can't replay it.
      url.searchParams.delete('note');
      window.history.replaceState(
        null,
        '',
        url.pathname + url.search + url.hash,
      );
    } catch {
      // Malformed URL / no History API - just don't show the card.
    }
  }, []);

  if (!note) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked - the text is still visible to copy by hand.
    }
  };

  return (
    <PopupPortal>
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-forest-950/95 text-cream-100 shadow-card-hover backdrop-blur-md p-4 animate-fade-up focus:outline-none max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-cream-100/65">
            Voice note from your watch
          </p>
          <button
            type="button"
            onClick={() => setNote(null)}
            aria-label="Dismiss voice note"
            className="-mt-1 -mr-1 rounded-full p-1 text-cream-100/55 hover:text-cream-100 hover:bg-cream-100/10 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-cream-100/90 break-words">
          {note}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-gold-400/90 hover:bg-gold-300 text-forest-950 text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button
            type="button"
            onClick={() => setNote(null)}
            className="rounded-lg text-xs font-medium px-3 py-1.5 text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/10 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
    </PopupPortal>
  );
}
