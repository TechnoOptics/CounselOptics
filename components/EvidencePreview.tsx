'use client';

import { useEffect, useRef, useState } from 'react';
import { getFirmEvidenceMediaUrl } from '@/lib/case-evidence-actions';
import {
  contentIconFor,
  isDisplayableImage,
  mediaCategory,
  KIND_LABEL,
  type TimelineEvent,
} from '@/lib/timeline-types';

/**
 * A large, readable preview of one evidence item, shared by the firm intake
 * cards and the firm timeline chronology so both read the same way. It shows the
 * actual content wherever it can: a browser-renderable image is lazy-loaded
 * (only once the tile scrolls into view, so a grid of hundreds does not mint
 * hundreds of signed URLs up front); an email renders as a short readable peek
 * (subject, from/to, the first lines of the body); everything else falls back to
 * a content-aware icon on a tinted panel with the type + filename, and a play
 * glyph for video. Firm-scoped signed URLs come from getFirmEvidenceMediaUrl.
 */
export function EvidencePreview({
  firmId,
  caseId,
  event,
  className = '',
  rounded = 'rounded-xl',
}: {
  firmId: string;
  caseId: string;
  event: TimelineEvent;
  className?: string;
  rounded?: string;
}) {
  const media = event.media[0];
  const category = mediaCategory(media, event.kind);
  const displayable = media ? isDisplayableImage(media.mime, media.name) : false;
  const wantsImage = category === 'image' && displayable;

  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!wantsImage) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '250px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wantsImage]);

  useEffect(() => {
    if (!wantsImage || !inView || !media) return;
    let on = true;
    getFirmEvidenceMediaUrl(firmId, caseId, media.path).then((res) => {
      if (!on) return;
      if (res.ok && res.url) setUrl(res.url);
      else setFailed(true);
    });
    return () => {
      on = false;
    };
  }, [wantsImage, inView, media, firmId, caseId]);

  const base = `relative overflow-hidden bg-cream-100/70 dark:bg-forest-800/50 ${rounded} ${className}`;

  if (category === 'email') {
    return (
      <div ref={ref} className={base}>
        <EmailPeek event={event} />
      </div>
    );
  }

  if (wantsImage && url && !failed) {
    return (
      <div ref={ref} className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          data-no-translate
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  // Icon panel for docs / video / audio / non-displayable images / anything else.
  const label = category === 'pdf' ? 'PDF' : KIND_LABEL[event.kind];
  return (
    <div ref={ref} className={`${base} flex flex-col items-center justify-center gap-1 p-3 text-center`}>
      <span className="text-4xl leading-none sm:text-5xl" aria-hidden>
        {contentIconFor(event)}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-cream-100/55" data-no-translate>
        {label}
      </span>
      {media?.name && (
        <span className="line-clamp-1 max-w-full px-1 text-[10.5px] text-ink-400 dark:text-cream-100/40" data-no-translate>
          {media.name}
        </span>
      )}
      {category === 'video' && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-forest-950/55 text-cream-50 backdrop-blur">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      )}
    </div>
  );
}

/** A compact readable email preview: subject, from/to, and the first body lines. */
function EmailPeek({ event }: { event: TimelineEvent }) {
  const email = event.aiExtracted?.email ?? {};
  const body = (event.aiExtracted?.ocr_text ?? '').trim();
  return (
    <div className="flex h-full w-full flex-col gap-1 p-3 text-left" data-no-translate>
      <p className="line-clamp-2 text-[12.5px] font-semibold text-forest-900 dark:text-cream-100">
        {email.subject || event.title || '(no subject)'}
      </p>
      {(email.from || email.to?.length) && (
        <p className="line-clamp-1 text-[10.5px] text-ink-500 dark:text-cream-100/55">
          {email.from ? `From ${email.from}` : ''}
          {email.to?.length ? `  ·  To ${email.to.slice(0, 2).join(', ')}` : ''}
        </p>
      )}
      {body && (
        <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-600 dark:text-cream-100/70">
          {body.slice(0, 320)}
        </p>
      )}
      <span className="mt-auto self-start rounded bg-white/70 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-forest-700 dark:bg-forest-900/60 dark:text-cream-100/70">
        ✉︎ Email
      </span>
    </div>
  );
}
