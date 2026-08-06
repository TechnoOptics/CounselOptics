import { findSignatureBlockLine } from '@/lib/firm-template-placeholders';

/**
 * A document rendered as plain text with the signer's mark drawn in above the
 * signature block.
 *
 * Both on-screen surfaces use this one component: the employee's live preview
 * and the reviewer's copy of what would be sent. Together with the same
 * locator inside lib/branded-document-pdf.ts, that means the three places a
 * signature can appear agree about where it goes by construction rather than
 * by three careful implementations. A preview that disagrees with the
 * delivered PDF is the exact defect this arrangement exists to prevent.
 *
 * The mark box mirrors the renderer's 200 by 56 point box, so the proportions
 * on screen are the proportions on the page.
 *
 * The caller supplies whitespace handling (both callers wrap this in a
 * whitespace-pre-wrap block) and marks the container data-no-translate, since
 * a legal document is not machine-translation material.
 */
export function DocumentWithMark({
  text,
  markSrc,
  markLine,
}: {
  text: string;
  /** The mark, as a data URL or a short-lived signed URL. Null renders text. */
  markSrc: string | null;
  /**
   * Where the mark goes. Passed in when the caller already computed it,
   * otherwise located here from the same text. Either way it is the one
   * locator that decides.
   */
  markLine?: number | null;
}) {
  if (!markSrc) return <>{text}</>;

  const line = markLine === undefined ? findSignatureBlockLine(text) : markLine;
  const image = (
    <img
      src={markSrc}
      alt="Signature"
      className="my-1 block max-h-[56px] w-auto max-w-[200px] object-contain object-left"
    />
  );

  if (line === null) {
    // The reviewer rewrote the signature block, so there is no line to sit
    // above. The mark goes at the end under a rule, which is what the PDF
    // renderer does with the same document. It is never dropped.
    return (
      <>
        {text}
        <span className="mt-3 block h-px w-[200px] bg-ink-200 dark:bg-forest-700/60" />
        {image}
      </>
    );
  }

  const lines = text.split('\n');
  return (
    <>
      {lines.slice(0, line).join('\n')}
      {image}
      {lines.slice(line).join('\n')}
    </>
  );
}
