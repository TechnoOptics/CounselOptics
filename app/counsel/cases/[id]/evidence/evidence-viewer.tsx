'use client';

import { useEffect, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { getFirmEvidenceMediaUrl } from '@/lib/case-evidence-actions';
import { KindIcon } from '@/components/counsel/KindIcon';
import {
  exhibitLabel,
  folderForEvent,
  formatOccurred,
  isDisplayableImage,
  mediaCategory,
  KIND_LABEL,
  type TimelineEvent,
} from '@/lib/timeline-types';

/**
 * In-window evidence viewer. Opens an item without leaving the intake: images
 * zoom and pan, video/audio play inline, PDFs embed, and an email file renders
 * as a readable message (parsed headers from ai_extracted.email, body from
 * ocr_text). The X, a backdrop click, or Escape closes; the arrow keys step
 * through the current (already filtered) list. Signed URLs are firm-scoped via
 * getFirmEvidenceMediaUrl. Modelled on the consumer media lightbox, extended for
 * the firm intake with per-item facts and gallery navigation.
 */
export function EvidenceViewer({
  firmId,
  caseId,
  event,
  index,
  total,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onTimeline,
  onToggleTimeline,
}: {
  firmId: string;
  caseId: string;
  event: TimelineEvent;
  index: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** When provided, shows an "Add to / On timeline" control in the header. */
  onTimeline?: boolean;
  onToggleTimeline?: () => void;
}) {
  const t = useT();
  const media = event.media[0];
  const ext = event.aiExtracted ?? {};
  // Route by mime → extension → medium, so a file that arrived with a generic
  // `application/octet-stream` mime (common on drop) still renders correctly.
  const category = media ? mediaCategory(media, event.kind) : 'other';
  const isEmail = category === 'email';

  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // Load a fresh signed URL whenever the shown item changes. Reset zoom so a new
  // image opens fit-to-screen.
  useEffect(() => {
    let on = true;
    setUrl(null);
    setLoadError(null);
    setZoom(1);
    if (!media) return;
    getFirmEvidenceMediaUrl(firmId, caseId, media.path).then((res) => {
      if (!on) return;
      if (res.ok && res.url) setUrl(res.url);
      else setLoadError(res.error ?? t('Could not open the file.'));
    });
    return () => {
      on = false;
    };
  }, [firmId, caseId, media, t]);

  // Escape closes; the arrow keys navigate the gallery. Lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onNext, onPrev, hasNext, hasPrev]);

  // A HEIC/TIFF image can't be painted by <img>; treat it as a downloadable file.
  const isImage = category === 'image' && !!media && isDisplayableImage(media.mime, media.name);
  const isRawImage = category === 'image' && !isImage;
  const isVideo = category === 'video';
  const isAudio = category === 'audio';
  const isPdf = category === 'pdf';
  const transcript = ext.ocr_text?.trim() || null;

  const title = (event.title ?? '').trim() || media?.name || t('Untitled item');
  const exhibit = exhibitLabel(ext.exhibit_no);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-forest-950/92 backdrop-blur-sm"
      style={{
        paddingTop: 'var(--safe-top, 0px)',
        paddingBottom: 'var(--safe-bottom, 0px)',
      }}
    >
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('Close')}
        className="fixed right-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-cream-50 backdrop-blur hover:bg-white/20"
        style={{ top: 'calc(0.75rem + var(--safe-top, 0px))' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Prev / next */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label={t('Previous')}
          className="fixed left-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-cream-50 backdrop-blur hover:bg-white/20"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label={t('Next')}
          className="fixed right-3 top-1/2 z-20 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-cream-50 backdrop-blur hover:bg-white/20"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-12"
      >
        {/* Heading */}
        <div className="shrink-0 text-center">
          <p className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-cream-50" data-no-translate>
            {exhibit && (
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-cream-100/90">
                {exhibit}
              </span>
            )}
            <KindIcon kind={event.kind} className="h-4 w-4 shrink-0 text-gold-400/90" />
            <span className="break-words">{title}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-cream-100/60">
            <span data-no-translate>
              {KIND_LABEL[event.kind]} · {folderForEvent(event)} ·{' '}
              {formatOccurred(event.occurredAt, event.occurredPrecision)}
            </span>
            <RelevanceBadge score={ext.relevance_score} reason={ext.relevance_reason} size="xs" />
            <span className="text-cream-100/40">
              {index + 1} / {total}
            </span>
          </p>
          {onToggleTimeline && (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={onToggleTimeline}
                aria-pressed={onTimeline}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors ${
                  onTimeline
                    ? 'bg-forest-600 text-cream-50 ring-forest-600 hover:bg-forest-500'
                    : 'text-cream-100/85 ring-cream-50/25 hover:bg-white/10'
                }`}
              >
                <span aria-hidden>{onTimeline ? '✓' : '+'}</span>
                {onTimeline ? <T>On timeline</T> : <T>Add to timeline</T>}
              </button>
            </div>
          )}
        </div>

        {/* Media stage */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {isEmail ? (
            <EmailView event={event} url={url} />
          ) : loadError ? (
            <p className="rounded-lg bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{loadError}</p>
          ) : !url ? (
            <div className="py-16 text-cream-100/60">
              <T>Loading…</T>
            </div>
          ) : isImage ? (
            <div className="relative flex max-h-full w-full items-center justify-center overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={title}
                data-no-translate
                onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center', cursor: zoom > 1 ? 'zoom-out' : 'zoom-in' }}
                className="max-h-[74vh] w-auto max-w-full rounded-lg object-contain shadow-2xl transition-transform"
              />
              <ZoomControls zoom={zoom} onZoom={setZoom} />
            </div>
          ) : isVideo ? (
            <video src={url} controls autoPlay playsInline className="max-h-[74vh] w-full rounded-lg bg-black shadow-2xl" data-no-translate />
          ) : isAudio ? (
            <div className="w-full max-w-lg rounded-2xl border border-cream-50/10 bg-forest-900/60 p-6">
              <div className="mb-4 text-center text-5xl">🎙️</div>
              <audio src={url} controls autoPlay className="w-full" data-no-translate />
            </div>
          ) : isPdf ? (
            <iframe src={url} title={title} className="h-[74vh] w-full rounded-lg bg-white shadow-2xl" />
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-cream-50/10 bg-forest-900/50 px-8 py-10 text-center">
              <KindIcon kind={event.kind} className="h-14 w-14 text-cream-100/50" />
              <div>
                <p className="text-sm font-medium text-cream-50" data-no-translate>
                  {media?.name || title}
                </p>
                <p className="mt-1 text-[12px] text-cream-100/55">
                  {isRawImage ? (
                    <T>This image format can't be shown in the browser. Open it to view.</T>
                  ) : (
                    <T>This file can't be previewed here. Open it to view.</T>
                  )}
                </p>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-cream-50 hover:bg-white/20"
              >
                <T>Open file</T>
              </a>
            </div>
          )}
        </div>

        {/* Facts + transcript */}
        {(event.aiSummary || transcript || (ext.detected_people?.length ?? 0) > 0) && (
          <div className="shrink-0 space-y-2 rounded-xl border border-cream-50/10 bg-forest-900/50 p-4">
            {event.aiSummary && (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-cream-100/90" data-no-translate>
                {event.aiSummary}
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-cream-100/70" data-no-translate>
              <FactLine label={t('People')} items={ext.detected_people} />
              <FactLine label={t('Organizations')} items={ext.organizations} />
              <FactLine label={t('Locations')} items={ext.locations} />
              <FactLine label={t('Dates')} items={ext.detected_dates} />
            </div>
            {!isEmail && transcript && (
              <details className="text-[12px] text-cream-100/80">
                <summary className="cursor-pointer text-cream-100/60">
                  {isVideo || isAudio ? t('Transcript') : t('Extracted text')}
                </summary>
                <p className="mt-1 max-h-[22vh] overflow-y-auto whitespace-pre-wrap leading-relaxed" data-no-translate>
                  {transcript}
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Floating +/-/reset zoom controls over an image. */
function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const t = useT();
  const clamp = (z: number) => Math.max(1, Math.min(4, Math.round(z * 10) / 10));
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-forest-950/70 px-1.5 py-1 backdrop-blur">
      <button
        type="button"
        aria-label={t('Zoom out')}
        onClick={() => onZoom(clamp(zoom - 0.5))}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-cream-50 hover:bg-white/15"
      >
        −
      </button>
      <span className="w-10 text-center font-mono text-[11px] text-cream-100/80">{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        aria-label={t('Zoom in')}
        onClick={() => onZoom(clamp(zoom + 0.5))}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-cream-50 hover:bg-white/15"
      >
        +
      </button>
    </div>
  );
}

/** One inline "Label: a, b, c" fact row, hidden when empty. */
function FactLine({ label, items }: { label: string; items?: string[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <span>
      <span className="uppercase tracking-[0.06em] text-cream-100/40">{label}:</span>{' '}
      {items.slice(0, 8).join(', ')}
      {items.length > 8 ? ` +${items.length - 8}` : ''}
    </span>
  );
}

/** A readable rendering of a parsed email: headers, then the body text. */
/**
 * Strip a leading RFC-822 header block ("From:/To:/Cc:/Date:/Subject:" lines
 * up to the first blank line) off text stored in `ocr_text`. Used only for
 * emails imported before `email.body` existed - the parser prepends the header
 * block to `ocr_text` for analysis, and showing that verbatim double-prints the
 * headers the viewer already renders in its styled block. Only strips when the
 * lead-in really is a header block, so a normal body is never truncated.
 */
function stripEmailHeaderBlock(text: string): string {
  const sep = text.indexOf('\n\n');
  if (sep === -1) return text;
  const head = text.slice(0, sep);
  const isHeaderBlock =
    head.length > 0 &&
    head.split('\n').every((line) => /^(From|To|Cc|Date|Subject):\s/.test(line));
  return isHeaderBlock ? text.slice(sep + 2).trim() : text;
}

function EmailView({ event, url }: { event: TimelineEvent; url: string | null }) {
  const t = useT();
  const email = event.aiExtracted?.email ?? {};
  // New imports carry the clean message body; older rows only have `ocr_text`
  // with the header block prepended, so strip it there.
  const body =
    email.body?.trim() ||
    stripEmailHeaderBlock(event.aiExtracted?.ocr_text?.trim() || '');
  const row = (label: string, value?: string | null) =>
    value ? (
      <div className="flex gap-2 text-[13px]">
        <span className="w-16 shrink-0 text-right uppercase tracking-[0.05em] text-ink-400 dark:text-cream-100/45 text-[10.5px] pt-0.5">
          {label}
        </span>
        <span className="min-w-0 break-words text-forest-900 dark:text-cream-100" data-no-translate>
          {value}
        </span>
      </div>
    ) : null;

  return (
    <div className="max-h-[74vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl dark:bg-forest-900">
      <div className="space-y-1 border-b border-ink-100 p-5 dark:border-forest-700/40">
        <p className="mb-2 break-words text-[15px] font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
          {email.subject || t('(no subject)')}
        </p>
        {row(t('From'), email.from)}
        {row(t('To'), email.to?.join(', '))}
        {row(t('Cc'), email.cc?.join(', '))}
        {row(t('Date'), email.date)}
        {email.attachments?.length ? row(t('Files'), email.attachments.join(', ')) : null}
      </div>
      {body ? (
        <p className="whitespace-pre-wrap p-5 text-[13.5px] leading-relaxed text-ink-700 dark:text-cream-100/85" data-no-translate>
          {body}
        </p>
      ) : (
        <p className="p-5 text-[13px] italic text-ink-400 dark:text-cream-100/45">
          <T>This email had no readable body text.</T>
        </p>
      )}
      {url && (
        <div className="border-t border-ink-100 p-4 dark:border-forest-700/40">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] text-forest-700 hover:underline dark:text-cream-100/80"
          >
            <T>Download original message</T> →
          </a>
        </div>
      )}
    </div>
  );
}
