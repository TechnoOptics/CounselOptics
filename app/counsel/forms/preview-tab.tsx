'use client';

import { useEffect, useRef, useState } from 'react';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import { PdfViewer } from '@/components/PdfViewer';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * THE PAGE THIS BECOMES, on the page.
 *
 * The section used to hold a button that opened the document in a dialog. It
 * now draws the document itself, because "Preview" naming a control rather
 * than showing anything is a section an author has to be told how to use.
 *
 * WHAT IS NOT FORKED. The bytes still come from
 * /api/counsel/draft-template/pdf, which is the route the real export uses, so
 * the preview and the document a colleague sends go through one renderer and
 * cannot agree merely by inspection. Nothing here lays out a document;
 * PdfViewer, which the print-and-send dialog also uses, draws the blob that
 * route returned, with page navigation, zoom and a failure state that says
 * what happened.
 *
 * WHAT IT COSTS, AND WHAT IS DONE ABOUT IT. A draft render is a membership
 * read, a firm read, the letterhead and logo image fetches, and a pdf-lib
 * pass: a server round trip, with no model call, no paid API and no rate limit
 * behind it. It is drawn when this section is opened, and the result is cached
 * by the editor keyed by the exact request that produced it
 * (draftPreviewRequestBody), so moving between sections is free and each
 * version of a draft is drawn once. The editor's sections are exclusive, so
 * the draft cannot change while this one is on screen; there is nothing to
 * debounce.
 *
 * Nothing here saves. This is a render, and the Save buttons under the
 * sections remain the only thing that writes.
 */
export function PreviewTab({
  busy,
  name,
  body,
  deliveryMode,
  unmergedCount,
  buildPdf,
}: {
  busy: boolean;
  name: string;
  body: string;
  deliveryMode: DeliveryMode;
  unmergedCount: number;
  buildPdf: () => Promise<Blob>;
}) {
  const t = useT();
  const missingName = !name.trim();
  const missingBody = !body.trim();
  const ready = !missingName && !missingBody;

  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const built = await buildPdf();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(built);
        urlRef.current = objectUrl;
        setBlob(built);
        setUrl(objectUrl);
      } catch (e) {
        if (cancelled) return;
        // The server's own sentence, which says whether this was a permission,
        // an empty draft or a failed render. A generic message here is how a
        // preview that refused for a reason the author could fix reads as a
        // fault in the app. See buildPreviewPdf in template-editor.tsx.
        setError(
          e instanceof Error
            ? e.message
            : t('The preview could not be prepared. Try again in a moment.'),
        );
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
    // Runs once per mount of this section, which is once per visit to it. The
    // EDITOR's cache decides whether that visit costs a render. buildPdf is
    // captured deliberately and is not a dependency: the editor rebuilds it on
    // every keystroke elsewhere on the page, and depending on it would redraw
    // the document continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const print = () => {
    if (!url) return;
    const w = window.open(url, '_blank');
    w?.addEventListener('load', () => w.print());
  };

  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name.trim() || 'template').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-3">
      {/* WHAT THIS PAGE IS NOT, above the document rather than under it. A
          template has blanks nobody has answered and nothing has been signed,
          and both are real differences between these bytes and what the other
          side ends up holding. A preview that let somebody believe otherwise
          would manufacture confidence about a document leaving the firm. */}
      <p className="text-[12.5px] leading-relaxed text-muted">
        {unmergedCount > 0 && (
          <span className="mb-1.5 block font-medium text-amber-800 dark:text-amber-200">
            <T>
              This document still has placeholders nothing will fill in. They
              are on the page below exactly as they are written in the body,
              braces and all.
            </T>
          </span>
        )}
        <T>
          This is your template drawn by the same renderer that produces the
          document your colleague sends, on your firm&rsquo;s letterhead and this
          template&rsquo;s page layout. Two things look different here: the blanks
          show their labels until someone fills them in, and nothing has been
          signed yet, so anything your firm shows on an unsigned page is not on
          a signed one. Nothing is saved by looking at it.
        </T>{' '}
        {deliveryMode === 'signature' && (
          <T>
            This template goes out for signature, so the copy that is sent also
            carries a block naming the recipient and a place for them to sign,
            added once your colleague has addressed it.
          </T>
        )}
      </p>

      {/* The same condition the Save buttons are refused on, so what can be
          previewed and what can be saved are the same draft. */}
      {!ready && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
          {missingName && missingBody ? (
            <T>
              Give this template a name and a body on the Document section and
              the page appears here.
            </T>
          ) : missingName ? (
            <T>
              Give this template a name on the Document section and the page
              appears here.
            </T>
          ) : (
            <T>Write a body on the Document section and the page appears here.</T>
          )}
        </p>
      )}

      {ready && error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] leading-relaxed text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {error}
        </p>
      )}

      {ready && !error && (
        <>
          {blob ? (
            // Rounded and clipped here rather than inside the viewer, which is
            // also mounted flush inside a card elsewhere and would have the
            // wrong corners.
            <div className="overflow-hidden rounded-lg border border-edge">
              <PdfViewer
                source={{ kind: 'blob', blob }}
                title={name.trim() || t('Template')}
                className="h-[62dvh] w-full"
                fallbackHref={url ?? undefined}
              />
            </div>
          ) : (
            <div className="flex h-[62dvh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-edge">
              {/* A calm bar rather than a spinner, and it stops for anyone who
                  has asked their system for less motion. */}
              <div
                aria-hidden
                className="h-1 w-24 animate-pulse rounded-full bg-edge motion-reduce:animate-none"
              />
              <p className="text-[13px] text-muted" aria-live="polite">
                <T>Drawing this template as the page it becomes.</T>
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !url}
              onClick={download}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Download PDF</T>
            </button>
            <button
              type="button"
              disabled={busy || !url}
              onClick={print}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              <T>Print</T>
            </button>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-muted underline hover:text-foreground"
              >
                {/* Kept from the dialog. The viewer draws pixels, so a reader
                    who wants the text rather than a picture of it should have
                    the real file. */}
                <T>Open in a new tab</T>
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
