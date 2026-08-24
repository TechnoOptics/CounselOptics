'use client';

import { useCallback, useState } from 'react';

import { brandedCopyNotice } from '@/lib/signed-copy-view';
import { useT } from './i18n/LocaleProvider';
import { DocumentPdfDeck } from './DocumentPdfDeck';

/**
 * The employee's own copy of a document they filed, rendered from the REAL PDF.
 *
 * WHAT WAS WRONG. This surface rendered components/DocumentSheets.tsx, which
 * reflows plain text and estimates where the pages fall, and it passed no mark
 * at all. So the person whose signature is on the document was the only one in
 * the chain shown neither the firm's letterhead nor their own signature, while
 * the fill page and the approver's page both showed the real pages.
 *
 * WHY A WRAPPER EXISTS AT ALL. The submission page is a server component, and
 * a function cannot cross that boundary, so `buildPdf` has to be built on the
 * client from plain data. That is the same reason components/SubmissionPdfDeck.tsx
 * exists for the approver, and this file does the same job for the employee.
 *
 * WHY IT IS NOT SubmissionPdfDeck. That component renders through the
 * draft-template route, which RE-MERGES the firm's currently published
 * template with the stored field values. For a person deciding what to send
 * that is the right document. For a person's record of what they already
 * signed it is not: it would show today's template rather than the wording
 * they affirmed, it would date the page today, and on a submission the legal
 * team edited it would show the pre-edit wording underneath a heading that
 * says the document below is the edited one. So this posts to the approvals
 * preview route instead, which draws the STORED document_text and the STORED
 * mark and never re-merges anything (see lib/submission-preview.ts).
 *
 * ITS GATE IS THE ONE THIS PAGE ALREADY APPLIES. That route is gated on
 * canReadSubmissionDocument, the same predicate that decided whether this page
 * prints the wording at all, and its first clause is that the colleague who
 * filled a document in always reads it. Nothing was widened to make this
 * render: the employee already passed that gate, which is why the wording is
 * on the page in the first place.
 *
 * IT IS PINNED, AND A REFUSAL IS SAID OUT LOUD. The route refuses any revision
 * or wording but the one this page rendered. That refusal, and any other, ends
 * at the text with a line naming itself as a fallback, because a person is
 * entitled to see the document they signed and a silent downgrade to reflowed
 * text is indistinguishable from the defect this replaces.
 */
export function SignedCopyDeck({
  submissionId,
  revision,
  documentText,
  markUrl,
  fallback,
}: {
  submissionId: string;
  /** The revision this page rendered. The route refuses any other. */
  revision: number;
  /** The wording this page rendered. Compared by the route, never drawn by it. */
  documentText: string;
  /** Short-lived signed URL for the stored mark, or null when there is none. */
  markUrl: string | null;
  /** The text sheets, shown while the first build runs and if it fails. */
  fallback: React.ReactNode;
}) {
  /**
   * Why the failure is recorded HERE rather than read off the deck.
   *
   * DocumentPdfDeck shows the fallback in two different states, 'first' and
   * 'failed', and tells the caller neither. But `buildPdf` is this component's
   * own function, so this component learns the status code before it throws,
   * and setting it re-renders with a `fallback` that now carries the notice.
   * No change to the deck was needed, and neither of its other two callers can
   * see a difference.
   */
  const t = useT();
  const [failure, setFailure] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const buildPdf = useCallback(async (): Promise<Blob> => {
    let res: Response;
    try {
      res = await fetch('/api/counsel/approvals/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, revision, documentText }),
      });
    } catch (err) {
      // A network error has no status. brandedCopyNotice treats that as "not
      // just now", which is the honest reading of it.
      setFailure(null);
      setFailed(true);
      throw err;
    }
    if (!res.ok) {
      setFailure(res.status);
      setFailed(true);
      throw new Error(await res.text());
    }
    const blob = await res.blob();
    // A 200 that is not a PDF would open as an empty deck, which on a document
    // somebody signed reads as "there is nothing in it". Treated as a failure
    // so the text and the notice are shown instead.
    if (blob.size === 0 || (blob.type && !blob.type.includes('pdf'))) {
      setFailure(null);
      setFailed(true);
      throw new Error('The document could not be prepared.');
    }
    setFailed(false);
    return blob;
  }, [submissionId, revision, documentText]);

  return (
    <DocumentPdfDeck
      buildPdf={buildPdf}
      // Everything that changes the document. The mark is not in it: the route
      // draws the mark stored beside this revision, so a revision that has not
      // moved cannot have gained or lost one.
      revision={JSON.stringify([submissionId, revision, documentText])}
      signed={Boolean(markUrl)}
      fallback={
        <div className="flex flex-col gap-3">
          {/* App copy, so it goes through the dictionary the rest of the
              portal uses. Not <T>, which only takes a literal: the sentence is
              chosen by the status. Not data-no-translate either, which marks
              user data and this is not. */}
          {failed && (
            <p className="text-[12.5px] text-muted">{t(brandedCopyNotice(failure))}</p>
          )}
          {fallback}
        </div>
      }
    />
  );
}
