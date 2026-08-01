'use client';

import { useEffect, useState } from 'react';
import { lockScroll } from '@/lib/scroll-lock';
import { getTimelineMediaUrl } from '@/lib/timeline-actions';
import type { TimelineMedia } from '@/lib/timeline-types';

/**
 * Full-screen attachment viewer. Images fill the screen; audio and video load
 * a player with the transcript/caption beneath; PDFs render inline; anything
 * else offers an open link. Close with the X, the Escape key, or a backdrop
 * click.
 */
export function MediaLightbox({
  media,
  transcript,
  onClose,
}: {
  media: TimelineMedia;
  transcript?: string | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    getTimelineMediaUrl(media.path).then((u) => {
      if (on) setUrl(u);
    });
    return () => {
      on = false;
    };
  }, [media.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Locks <html> as well as <body>; a body-only lock silently does
    // nothing in this app - see lib/scroll-lock.ts.
    const unlockScroll = lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, [onClose]);

  const isImage = /^image\//.test(media.mime);
  const isAudio = /^audio\//.test(media.mime);
  const isVideo = /^video\//.test(media.mime);
  const isPdf = media.mime === 'application/pdf' || /\.pdf$/i.test(media.name);
  const hasTranscript = (isAudio || isVideo) && Boolean(transcript && transcript.trim());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={media.name}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-forest-950/92 p-4 backdrop-blur-sm"
      style={{
        paddingTop: 'calc(1rem + var(--safe-top, 0px))',
        paddingBottom: 'calc(1rem + var(--safe-bottom, 0px))',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="fixed right-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-cream-50 backdrop-blur hover:bg-white/20"
        style={{ top: 'calc(1rem + var(--safe-top, 0px))' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      <div onClick={(e) => e.stopPropagation()} className="flex max-h-full w-full max-w-4xl flex-col items-center gap-3">
        <p className="w-full truncate px-12 text-center text-sm text-cream-100/80" data-no-translate>
          {media.name}
        </p>

        {!url ? (
          <div className="py-16 text-cream-100/60">Loading…</div>
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={media.name} data-no-translate className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain shadow-2xl" />
        ) : isVideo ? (
          <video src={url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-lg bg-black shadow-2xl" data-no-translate />
        ) : isAudio ? (
          <div className="w-full max-w-lg rounded-2xl border border-cream-50/10 bg-forest-900/60 p-6">
            <div className="mb-4 text-center text-5xl">🎙️</div>
            <audio src={url} controls autoPlay className="w-full" data-no-translate />
          </div>
        ) : isPdf ? (
          <iframe src={url} title={media.name} className="h-[80vh] w-full rounded-lg bg-white shadow-2xl" />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-cream-50 hover:bg-white/20"
          >
            Open file
          </a>
        )}

        {hasTranscript && (
          <div className="max-h-[24vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-cream-50/10 bg-forest-900/50 p-4 text-sm text-cream-100/90" data-no-translate>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-cream-100/50">
              {isVideo ? 'Caption / transcript' : 'Transcript'}
            </p>
            <p className="whitespace-pre-line leading-relaxed">{transcript}</p>
          </div>
        )}
      </div>
    </div>
  );
}
