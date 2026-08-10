'use client';

import { useState } from 'react';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * "Show me what would actually be sent."
 *
 * The page prints the wording as plain text, which is the right thing to read
 * closely. It is not the thing that leaves the firm: that is a letterheaded,
 * branded PDF, and until this button existed the one screen where somebody
 * decides to release confidential material to a third party was the screen
 * that did not show them the artifact they were releasing.
 *
 * It posts the revision and the wording THIS page rendered. The route refuses
 * anything else, so a document a colleague edited while this page was open
 * produces a plain refusal to read again rather than a preview of a version
 * this reviewer never saw. That is the same pin the decision itself carries.
 *
 * A failure is raised as an error with the server's own sentence in it, which
 * PdfPreviewDialog prints. Nothing here may end at an empty frame: on an
 * approvals queue a blank preview reads as "the document is empty", and that
 * is the one wrong conclusion to draw before sending something.
 */
export function SubmissionPreviewButton({
  submissionId,
  revision,
  documentText,
  title,
}: {
  submissionId: string;
  /** The revision this page rendered. The route refuses any other. */
  revision: number;
  /** The wording this page rendered. Compared, never drawn. */
  documentText: string;
  title: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const buildPdf = async (): Promise<Blob> => {
    const res = await fetch('/api/counsel/approvals/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId, revision, documentText }),
    });
    if (!res.ok) {
      const said = (await res.text()).trim();
      throw new Error(said || t('This document could not be prepared for preview.'));
    }
    const blob = await res.blob();
    // A 200 that is not a PDF would render as an empty frame, which is the one
    // outcome this surface must never produce.
    if (blob.size === 0 || (blob.type && !blob.type.includes('pdf'))) {
      throw new Error(t('This document could not be prepared for preview.'));
    }
    return blob;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary h-8 px-3 text-[12.5px]"
      >
        <T>Preview what would be sent</T>
      </button>
      {open && (
        <PdfPreviewDialog
          title={title}
          filename={`${title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'document'}.pdf`}
          buildPdf={buildPdf}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
