'use client';

import { useState } from 'react';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * THE PAGE THIS BECOMES.
 *
 * The preview itself is still the shared PdfPreviewDialog, drawn by the
 * server that renders the real document. What this section adds is the
 * standing place to ask for it, and the sentence saying why the button is
 * off when it is: a Preview section whose only control is disabled with
 * nothing said is the shape of a page that looks broken.
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
  const [open, setOpen] = useState(false);
  const missingName = !name.trim();
  const missingBody = !body.trim();

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        <T>
          Draws this draft as the PDF it becomes, on your firm letterhead and
          this template page layout. Nothing is saved by asking for it.
        </T>
      </p>

      {(missingName || missingBody) && (
        <p className="text-[12.5px] text-amber-700 dark:text-amber-300">
          {missingName && missingBody ? (
            <T>
              Give this template a name and a body on the Document section and
              the preview turns on.
            </T>
          ) : missingName ? (
            <T>Give this template a name on the Document section and the preview turns on.</T>
          ) : (
            <T>Write a body on the Document section and the preview turns on.</T>
          )}
        </p>
      )}

      {/* Disabled on exactly the condition the Save buttons are disabled
          on, so what can be previewed and what can be saved are the same
          draft. */}
      <button
        type="button"
        disabled={busy || missingName || missingBody}
        onClick={() => setOpen(true)}
        className="btn-secondary text-sm disabled:opacity-50"
      >
        <T>Preview as PDF</T>
      </button>

      {open && (
        <PdfPreviewDialog
          title={name.trim() || 'Template'}
          filename={`${(name.trim() || 'template').replace(/[^a-z0-9]+/gi, '-')}.pdf`}
          buildPdf={buildPdf}
          onClose={() => setOpen(false)}
          note={
            <>
              {/* Said on the preview as well as in the editor, because the
                  preview is where an author actually reads the page, and the
                  token is sitting in the PDF behind this sentence. */}
              {unmergedCount > 0 && (
                <span className="mb-1.5 block font-medium text-amber-800 dark:text-amber-200">
                  <T>
                    This document still has placeholders nothing will fill in.
                    They are on the page below exactly as they are written in
                    the body, braces and all.
                  </T>
                </span>
              )}
              <T>
                This is your template drawn by the same renderer that produces the
                document your colleague sends, on your firm&rsquo;s letterhead and this
                template&rsquo;s page layout. Two things look different here: the blanks
                show their labels until someone fills them in, and nothing has been
                signed yet, so anything your firm shows on an unsigned page is not on
                a signed one.
              </T>{' '}
              {deliveryMode === 'signature' && (
                <T>
                  This template goes out for signature, so the copy that is sent also
                  carries a block naming the recipient and a place for them to sign,
                  added once your colleague has addressed it.
                </T>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
