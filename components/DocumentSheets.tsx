import { DocumentText } from './DocumentWithMark';
import { locateLine, pageGeometry, paginate } from '@/lib/document-pagination';

/**
 * A document shown as a stack of paper sheets, with the signer's mark drawn on
 * the sheet it belongs to.
 *
 * REPLACES a single `whitespace-pre-wrap` block inside a `max-h-[70vh]` scroll
 * pane. Measured on production, that pane was 530px tall around 4168px of
 * content, so a person about to sign saw roughly an eighth of the document at a
 * time through a window that also swallowed the page's own scrolling.
 *
 * Three things follow from being sheets rather than a column:
 *
 * 1. There is NO inner scroll. The sheets are laid out at full height and the
 *    PAGE scrolls, which is what "only make the document preview scroll if it
 *    is at the bottom of the page" asks for: there is nothing left to capture
 *    the wheel, so the page is the only thing that moves.
 * 2. Each sheet holds the real page proportions, 612 by 792 points, so the
 *    shape on screen is the shape of the paper.
 * 3. The sheets are numbered, so a signer can say which page a term is on.
 *
 * The pagination is approximate and lib/document-pagination.ts says why. The
 * exact rendering is the full preview dialog, which builds the real PDF.
 */
export function DocumentSheets({
  text,
  markSrc,
  markLine,
}: {
  text: string;
  /** The mark, as a data URL or a short-lived signed URL. Null renders text. */
  markSrc: string | null;
  /** Which SOURCE line the mark sits above, or null for the end of the document. */
  markLine?: number | null;
}) {
  const pages = paginate(text);
  const geom = pageGeometry();

  // Where the mark goes, translated from a source line into a sheet.
  //
  // A null locator means the signature block was rewritten and the renderer
  // puts the mark at the end under a rule. The same thing happens here, on the
  // last sheet, rather than the mark being dropped - which is the defect this
  // component was written to fix.
  const at =
    markSrc && markLine !== null && markLine !== undefined
      ? locateLine(text, markLine)
      : null;
  const markPage = markSrc ? (at ? at.page : pages.length - 1) : -1;

  // data-signature-mark is how the fill page finds the mark in order to scroll
  // it into view the moment it arrives. Worth having because the signature
  // block is usually the last thing in a multi-page document, so a mark that
  // renders correctly can still land several sheets below what the signer is
  // looking at, which is indistinguishable from not rendering at all.
  const image = (
    <img
      src={markSrc ?? ''}
      alt="Signature"
      data-signature-mark
      className="my-1 block max-h-[56px] w-auto max-w-[200px] object-contain object-left"
    />
  );

  return (
    <div className="flex flex-col items-center gap-5">
      {pages.map((page, i) => (
        <div
          key={i}
          className="w-full max-w-[612px] rounded-md border border-edge bg-white px-[8%] py-[6%] shadow-card dark:bg-cream-50"
          style={{ aspectRatio: `${geom.widthPt} / ${geom.heightPt}` }}
        >
          {/*
            NO fixed height and NO overflow-hidden, and this is load-bearing.

            The first version had `h-full overflow-hidden`, which turned the
            aspect ratio into a hard clip. Every test passed. The rendered page
            showed the first sheet cutting a definition of Confidential
            Information off mid-sentence, because the lines-per-page estimate
            under-counts what a browser fits at its own font size, and the
            remainder was simply hidden.

            Hiding text from somebody about to sign it is worse than the
            scrolling column this replaced. Without a fixed height the aspect
            ratio acts as a MINIMUM: a sheet that holds more than the estimate
            grows a little rather than swallowing the difference. An
            approximate page break is a cosmetic fault; a silently truncated
            covenant is not.
          */}
          <div className="whitespace-pre-wrap font-serif text-[clamp(9px,1.6vw,12px)] leading-[1.45] text-forest-950">
            {i === markPage ? (
              <MarkedPage
                page={page}
                lineInPage={at ? at.lineInPage : Number.MAX_SAFE_INTEGER}
                image={image}
              />
            ) : (
              <DocumentText text={page} />
            )}
          </div>
        </div>
      ))}
      <p className="text-[12px] text-muted">
        {pages.length === 1 ? '1 page' : `${pages.length} pages`}
      </p>
    </div>
  );
}

/**
 * One sheet with the mark drawn into it.
 *
 * `lineInPage` past the end of the sheet puts the mark under a rule at the
 * bottom, matching what the renderer does with a document whose signature block
 * it cannot find.
 */
function MarkedPage({
  page,
  lineInPage,
  image,
}: {
  page: string;
  lineInPage: number;
  image: React.ReactNode;
}) {
  const lines = page.split('\n');
  if (lineInPage >= lines.length) {
    return (
      <>
        <DocumentText text={page} />
        <span className="mt-3 block h-px w-[200px] bg-ink-300" />
        {image}
      </>
    );
  }
  return (
    <>
      <DocumentText text={lines.slice(0, lineInPage).join('\n')} />
      {image}
      <DocumentText text={lines.slice(lineInPage).join('\n')} />
    </>
  );
}
