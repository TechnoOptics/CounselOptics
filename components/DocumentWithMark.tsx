import { findSignatureBlockLine } from '@/lib/firm-template-placeholders';
import { splitAtCounterpartyMarkers } from '@/lib/template-field-boxes';

/**
 * A document rendered as plain text, with the signer's mark drawn in above the
 * signature block and the other side's blanks drawn as blanks.
 *
 * Both on-screen surfaces use this one component: the employee's live preview
 * and the reviewer's copy of what would be sent. Together with the same
 * locator inside lib/branded-document-pdf.ts, that means the three places a
 * signature can appear agree about where it goes by construction rather than
 * by three careful implementations. A preview that disagrees with the
 * delivered PDF is the exact defect this arrangement exists to prevent.
 *
 * THAT SENTENCE WAS FALSE FOR THE BLANKS, and this component is why it is true
 * again. The renderer stopped drawing the marker literal and started ruling
 * the blank it measures, so a preview printing the raw text showed the
 * employee and the approving attorney `_____<<entity_name>>_____` where the
 * recipient would receive a clean rule. Both read the document through here,
 * so neither can drift from the delivered PDF on its own.
 *
 * What is NOT changed is the text itself. The marker survives unchanged in
 * document_text, because that is what the renderer measures and records a box
 * from; only the presentation moves. The one surface that must keep showing
 * the literal is the reviewer's edit textarea, since it is what they must not
 * delete, and that surface says so instead.
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
  if (!markSrc) return <>{body(text)}</>;

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
        {body(text)}
        <span className="mt-3 block h-px w-[200px] bg-ink-200 dark:bg-forest-700/60" />
        {image}
      </>
    );
  }

  const lines = text.split('\n');
  return (
    <>
      {body(lines.slice(0, line).join('\n'))}
      {image}
      {body(lines.slice(line).join('\n'))}
    </>
  );
}

/**
 * The words alone, with the other side's blanks ruled.
 *
 * Exported so the paginated sheet view draws blanks the same way this one does.
 * A second copy of the blank rendering is exactly the drift this file's own
 * header warns about, so there is not one.
 */
export function DocumentText({ text }: { text: string }) {
  return <>{body(text)}</>;
}

/**
 * The words, with each of the other side's blanks drawn as a ruled blank.
 *
 * The rule is the same fact the PDF draws, not the same measurement: the
 * renderer gives an end-of-line blank the rest of the measure and a mid-line
 * blank its own width, which are point widths over a fixed page and have no
 * meaning in a reflowing column. What has to match is that the reader sees a
 * blank for the other side to fill and never sees our sentinel.
 *
 * The key goes in the title rather than in the text. A reviewer with two
 * blanks on one page can tell them apart on hover, and nothing internal is
 * printed into the body of the document.
 */
function body(text: string) {
  const segments = splitAtCounterpartyMarkers(text);
  if (segments.every((s) => s.kind === 'text')) return text;
  return segments.map((s, i) =>
    s.kind === 'text' ? (
      <span key={i}>{s.text}</span>
    ) : (
      <span
        key={i}
        title={`${s.key}: the recipient fills this in`}
        className="mx-0.5 inline-block min-w-[12ch] border-b border-ink-400 align-baseline dark:border-cream-100/40"
      />
    ),
  );
}
