import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { findTextAnchors, normalizeAnchor } from '../lib/signature-anchor-text';

/**
 * Finding the signature line on a contract that says "By:".
 *
 * The old scan in lib/signature-anchors.ts reads RAW CONTENT-STREAM BYTES with
 * a regex, which only works when the text happens to be stored in a standard
 * encoding. A real commercial contract usually subsets its fonts, so "By:" is
 * a run of glyph indices and the byte scan sees nothing.
 *
 * Measured on the Mutual NDA reported as undetected: across all 447,801 bytes
 * of its decompressed streams, "By:" appeared 0 times, "Signature" 0 times,
 * "Name:" 0 times. The vocabulary was never the problem.
 *
 * THE FIXTURE IS SYNTHETIC ON PURPOSE. The real NDA is the user's document and
 * does not belong in this repository's history, so it is not committed. What
 * is committed is a PDF built here with the same shape: two "By: ____" blocks
 * on one page, the second under a party heading. The extractor was ALSO run
 * against the real file and found both lines at x=324, y=639 and y=438 on page
 * 8 of 8, which is what the numbers below are modelled on.
 */

async function contractWithTwoSignatureBlocks(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  pdf.addPage([612, 792]).drawText('Recitals and terms.', {
    x: 72, y: 700, size: 12, font,
  });
  const page = pdf.addPage([612, 792]);
  const line = (y: number, text: string) =>
    page.drawText(text, { x: 324, y, size: 12, font });
  line(639, 'By: _______________________________');
  line(612, 'Name:');
  line(580, 'Title:');
  line(470, 'ZINPRO CORPORATION');
  line(438, 'By: _______________________________');
  line(410, 'Name:');
  return pdf.save();
}

describe('reading the signature lines out of a contract', () => {
  it('finds BOTH blocks, not just the first', async () => {
    // The failure this exists for: a MUTUAL agreement has one block per party,
    // and returning the first leaves one side with nowhere to sign. That is
    // noticed after sending.
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    expect(anchors).toHaveLength(2);
    expect(anchors.every((a) => a.page === 2)).toBe(true);
  });

  it('recognises "By:", which the old vocabulary did not contain at all', async () => {
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    for (const a of anchors) expect(a.label.toLowerCase()).toContain('by');
  });

  it('reports a real position, not a page-bottom guess', async () => {
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    const ys = anchors.map((a) => Math.round(a.y)).sort((x, y) => x - y);
    expect(ys).toEqual([438, 639]);
    for (const a of anchors) {
      expect(a.pageWidth).toBe(612);
      expect(a.pageHeight).toBe(792);
    }
  });

  it('lands on the rule, not on the word "By:"', async () => {
    // FOUND BY RENDERING, not by a test. The first version placed the mark at
    // the text item's own x, and page 8 of the real NDA showed the box sitting
    // squarely on top of the word "By:". The label and the rule are ONE text
    // item - "By: ______" - so the item's x is the label's x.
    //
    // No assertion here could have caught it: the coordinate was the item's,
    // and the item was the right one. Only looking at the page did.
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    for (const a of anchors) {
      // The blocks are drawn at x=324; the anchor must sit to the RIGHT of it.
      expect(a.x).toBeGreaterThan(324);
      // And still inside the item rather than off across the page.
      expect(a.x).toBeLessThan(324 + 200);
    }
  });

  it('does not treat Name: or Title: as a place to sign', async () => {
    // Four marks stacked down the block is worse than none. Those are adjacent
    // fields; placing them is separate work with its own coordinates.
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    for (const a of anchors) {
      expect(a.label).not.toMatch(/name|title|date|email/i);
    }
  });

  it('normalizes into the 0-1 space the placement uses, lifted off the rule', async () => {
    const anchors = await findTextAnchors(await contractWithTwoSignatureBlocks());
    const top = anchors.find((a) => Math.round(a.y) === 639)!;
    const n = normalizeAnchor(top);
    expect(n.positionPage).toBe(2);
    // To the RIGHT of the label's own x, because the mark goes on the rule.
    // This asserted 324/612 while the anchor was placed at the label, which is
    // the placement the render disproved.
    expect(n.positionX).toBeGreaterThan(324 / 612);
    expect(n.positionX).toBeLessThan(0.75);
    // Lifted above the baseline: a mark drawn ON it reads as struck through.
    expect(n.positionY).toBeGreaterThan(639 / 792);
    expect(n.positionY).toBeLessThan(1);
  });

  it('returns nothing rather than throwing on bytes that are not a PDF', async () => {
    // The caller falls back to its previous behaviour, so a malformed upload
    // degrades to what it did before rather than failing the upload.
    expect(await findTextAnchors(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
  });
});
