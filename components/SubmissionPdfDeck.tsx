'use client';

import { useCallback, useEffect, useState } from 'react';

import { DocumentPdfDeck } from './DocumentPdfDeck';

/**
 * The approver's copy of the document, rendered from the REAL PDF.
 *
 * The attorney on this page is the one who decides the document leaves the
 * building, so of the three people in the chain they have the strongest claim
 * to be looking at what actually gets sent rather than a reflowed approximation
 * of it. The employee's fill page already renders the real thing; this closes
 * the gap on the surface where the decision is made.
 *
 * WHY A WRAPPER EXISTS AT ALL. The approvals page is a server component, and a
 * function cannot cross that boundary, so `buildPdf` has to be constructed on
 * the client from plain data. That is the whole job of this file.
 *
 * EMPLOYEE MODE, DELIBERATELY. The route offers a counsel mode that renders
 * free text, which would have been less work. Employee mode is used instead
 * because it makes the server load the firm's own published template and merge
 * the values itself, so the approver is shown a document built the same way the
 * recipient's is rather than one assembled from text this page happened to
 * hold. Its gate (requests.view plus the release check) is one an approver
 * passes.
 */
export function SubmissionPdfDeck({
  firmId,
  templateId,
  values,
  signatureName,
  markUrl,
  fallback,
}: {
  firmId: string;
  templateId: string;
  values: Record<string, string>;
  signatureName: string;
  /** Short-lived signed URL for the stored mark, or null for a typed name. */
  markUrl: string | null;
  fallback: React.ReactNode;
}) {
  // The mark as a data URL.
  //
  // The route decodes a data URL (decodeSignaturePng); the page holds a signed
  // storage URL. Converting is done HERE rather than by handing the route a URL
  // it would have to fetch, because a server that follows a URL from a request
  // body is a request-forgery surface, and this route deliberately does not.
  const [markData, setMarkData] = useState<string | null>(null);
  const [markResolved, setMarkResolved] = useState(false);

  useEffect(() => {
    if (!markUrl) {
      setMarkResolved(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(markUrl);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(blob);
        });
        if (!cancelled) setMarkData(dataUrl);
      } catch {
        // A mark that cannot be fetched must not stop the document rendering.
        // The approver still sees the real pages; what they lose is the drawn
        // mark, and the page shows the signature block either way.
      } finally {
        if (!cancelled) setMarkResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [markUrl]);

  const buildPdf = useCallback(async (): Promise<Blob> => {
    const res = await fetch('/api/counsel/draft-template/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firmId,
        templateId,
        values,
        signatureName,
        signatureDataUrl: markData,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  }, [firmId, templateId, values, signatureName, markData]);

  // Wait for the mark before the first build, so the approver is not shown an
  // unsigned document that then silently gains a signature. On this page that
  // swap would look like the document changed under them.
  if (!markResolved) return <>{fallback}</>;

  return (
    <DocumentPdfDeck
      buildPdf={buildPdf}
      revision={JSON.stringify([templateId, values, signatureName, Boolean(markData)])}
      signed={Boolean(markData)}
      fallback={fallback}
    />
  );
}
