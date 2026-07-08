'use client';

import { useEffect, useRef, useState } from 'react';
import { getFirmEvidenceMediaUrl } from '@/lib/case-evidence-actions';
import { contentIconFor, type TimelineEvent } from '@/lib/timeline-types';

/** Image types a browser will actually render inline (HEIC/HEIF will not). */
const DISPLAYABLE_IMAGE = /^image\/(jpe?g|png|webp|gif|avif|svg\+xml)$/i;

/**
 * A lazy-loading evidence thumbnail. For a browser-renderable image it fetches a
 * short-TTL signed URL only once the tile scrolls into view (so a grid of
 * hundreds of items does not mint hundreds of URLs up front), and shows the
 * content-aware icon until then. For everything else, or an image the browser
 * cannot render, it shows the content-aware icon on a tinted tile, giving visual
 * confirmation of what each item is. Used by both the grid and the list rows.
 */
export function EvidenceThumb({
  firmId,
  caseId,
  event,
  variant,
}: {
  firmId: string;
  caseId: string;
  event: TimelineEvent;
  variant: 'grid' | 'list';
}) {
  const media = event.media[0];
  const isImage = media ? DISPLAYABLE_IMAGE.test(media.mime) : false;
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const icon = contentIconFor(event);

  // Reveal when scrolled near the viewport.
  useEffect(() => {
    if (!isImage) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isImage]);

  // Fetch the signed URL once visible.
  useEffect(() => {
    if (!isImage || !inView || !media) return;
    let on = true;
    getFirmEvidenceMediaUrl(firmId, caseId, media.path).then((res) => {
      if (!on) return;
      if (res.ok && res.url) setUrl(res.url);
      else setFailed(true);
    });
    return () => {
      on = false;
    };
  }, [isImage, inView, media, firmId, caseId]);

  const box =
    variant === 'grid'
      ? 'aspect-square w-full'
      : 'h-12 w-12 shrink-0';
  const iconSize = variant === 'grid' ? 'text-4xl' : 'text-xl';

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-lg bg-cream-100/70 dark:bg-forest-800/50 ${box}`}
    >
      {isImage && url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          data-no-translate
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className={`flex h-full w-full items-center justify-center ${iconSize}`} aria-hidden>
          {icon}
        </div>
      )}
    </div>
  );
}
