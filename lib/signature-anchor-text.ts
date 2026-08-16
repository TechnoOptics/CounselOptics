/**
 * Find the signature lines in a PDF by reading its TEXT, with positions.
 *
 * WHY THIS EXISTS. lib/signature-anchors.ts scans raw content-stream bytes
 * with a regex. That only works on a PDF whose text happens to be stored in a
 * standard encoding. A real commercial contract usually is not: fonts are
 * subset-embedded, so "By:" is a run of glyph indices and a byte regex sees
 * nothing at all.
 *
 * Measured on a real Mutual NDA that was reported as undetected: searching all
 * 447,801 bytes of its decompressed streams found "By:" 0 times, "Signature"
 * 0 times, "Name:" 0 times. Nothing was wrong with the vocabulary. The text
 * was simply not readable that way, and widening the regex would have changed
 * nothing while looking like a fix.
 *
 * `unpdf` already ships in this project, so no dependency is added.
 *
 * WHAT "By:" HAS TO DO WITH IT. `By:` is the standard US commercial-contract
 * signature label and was absent from the old vocabulary entirely. It is first
 * here. The older spellings stay, because a form that says "Signature:" is
 * still a form.
 *
 * `Signed:` IS OUR OWN LABEL, AND IT WAS MISSING. This vocabulary was written
 * against a third-party commercial NDA, where the labels are `By:` and
 * `Signature:`. But lib/firm-template-placeholders.ts appends the employee's
 * own block as `Signed: <name>`, and nothing here matched it.
 *
 * Reported as "I signed using the phone QR code and it has not showed up on the
 * document", and traced through the live database: the mark was written at
 * 22:13:36 and collected by the desk at 22:13:37, so the handoff was fine and
 * the signature really was on the page. What failed is that the viewer could
 * not FIND the page it was on, so it never turned to it, and a signature on
 * page two of a document showing page one is indistinguishable from no
 * signature at all.
 *
 * The lesson is narrow and worth keeping: a vocabulary borrowed for other
 * people's documents has to be checked against the documents this app writes
 * itself.
 *
 * EVERY BLOCK, NOT THE FIRST. The old scan returned at most one placement per
 * page. The NDA that prompted this has TWO signature blocks on its last page,
 * one per party, so returning the first would leave one side of a mutual
 * agreement with nowhere to sign - a failure noticed only after sending.
 */

/** What was found, in the PDF's own coordinate space (origin bottom-left). */
export type TextAnchor = {
  /** 1-indexed. */
  page: number;
  /** The label that matched, as written in the document. */
  label: string;
  /** Points from the left edge. */
  x: number;
  /** Points from the BOTTOM edge, matching PDF convention. */
  y: number;
  /** The page box, so a caller can normalize without re-opening the file. */
  pageWidth: number;
  pageHeight: number;
};

/**
 * Signature-line labels, most specific first.
 *
 * Deliberately NOT `Name:` / `Title:` / `Date:` / `Email:`. Those are adjacent
 * fields rather than places to put the signature image, and treating them as
 * signature anchors would stack four marks down the block. They are worth
 * placing eventually, from their own coordinates, which this returns enough
 * information to do later.
 */
export const LABEL_RE =
  /(\bBy\s*:|\bSignature\s*(of\b|:)|\bSigned\s*:|\bAuthorized\s+signature\b|\bSign\s+here\b|\bSigned\s+by\b|\/s\/)/i;

/**
 * Read a PDF's text and return every signature-line anchor, with positions.
 *
 * Returns [] rather than throwing when the document cannot be parsed. A
 * caller that cannot find anchors falls back to its previous behaviour, so a
 * malformed upload degrades to what it did before rather than failing the
 * upload outright.
 */
export async function findTextAnchors(bytes: Uint8Array): Promise<TextAnchor[]> {
  let getDocumentProxy: (b: Uint8Array) => Promise<unknown>;
  try {
    ({ getDocumentProxy } = await import('unpdf'));
  } catch {
    return [];
  }

  const out: TextAnchor[] = [];
  try {
    const pdf = (await getDocumentProxy(bytes)) as {
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        getTextContent: () => Promise<{
          items: Array<{ str?: string; transform?: number[]; width?: number }>;
        }>;
      }>;
    };

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        const text = (item.str ?? '').trim();
        if (!text) continue;
        const match = LABEL_RE.exec(text);
        if (!match) continue;
        const t = item.transform;
        // No transform means no position, and a placement without a position
        // is what the old code guessed at. Skipped rather than guessed.
        if (!t || t.length < 6) continue;
        // Start of the RULE, not of the label.
        //
        // Found by rendering the placement onto the real NDA and looking at
        // page 8: a box at the item's own x covers the word "By:" itself,
        // because the label and the rule are ONE text item -
        // "By: _______________________________". The signature belongs on the
        // rule, to the right of the word.
        //
        // The offset is the label's share of the item's width. It is an
        // approximation - a proportional font does not spend equal width per
        // character - but it is bounded by the item and lands on the rule,
        // where the alternative was landing on the label every time. The
        // tests could not have caught this: the coordinate was the item's,
        // and the item was the right one.
        const width = typeof item.width === 'number' ? item.width : 0;
        const after = match.index + match[0].length;
        const ruleOffset =
          width > 0 && text.length > 0 ? (width * after) / text.length : 0;
        out.push({
          page: n,
          label: match[0],
          x: t[4] + ruleOffset,
          y: t[5],
          pageWidth: view.width,
          pageHeight: view.height,
        });
      }
    }
  } catch {
    return [];
  }
  return out;
}

/**
 * Normalize an anchor to the 0-1 space SignaturePlacement uses.
 *
 * The signature sits slightly ABOVE the baseline the label sits on, because
 * the label and the rule share a line and a mark drawn at the baseline reads
 * as struck through it. `liftPt` is that offset, in points, and is applied
 * before normalizing so it does not scale with page size.
 */
export function normalizeAnchor(
  anchor: TextAnchor,
  opts: { liftPt?: number } = {},
): { positionPage: number; positionX: number; positionY: number } {
  // 4pt, set by looking at the render rather than by feel: at 2 the box's
  // bottom edge sat on the label's own baseline and read as struck through it.
  const lift = opts.liftPt ?? 4;
  return {
    positionPage: anchor.page,
    positionX: clamp01(anchor.x / anchor.pageWidth),
    positionY: clamp01((anchor.y + lift) / anchor.pageHeight),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
