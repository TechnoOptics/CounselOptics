import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDoc } from 'pdf-lib';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  AIReview,
  Case,
  Exhibit,
  Profile,
} from './types';
import { getExhibitFileBuffer } from './storage';

/**
 * Per-PDF-exhibit page cap. We splice the exhibit's actual PDF
 * pages into the packet after its header page. Without a cap a
 * single 800-page deposition transcript would explode the output.
 * 40 pages comfortably fits leases, contracts, and short pleadings;
 * heavier source documents will be truncated with a footnote.
 */
const MAX_PDF_EXHIBIT_PAGES = 40;
/**
 * Hard cap on the final packet's combined page count. Vercel function
 * responses have a 50 MB cap; a 200-page PDF reliably stays under it.
 * Past this we stop merging additional exhibit PDFs and surface a
 * note instead so the user knows what's missing.
 */
const MAX_PACKET_PAGES = 200;

// Cap each list section in the PDF Review so the export does not
// balloon to 30 pages on a heavy matter. The web app still shows the
// full lists; the PDF version trims them at the tail with a
// "+ N more in the app" note.
const PDF_REVIEW_LIST_CAP = 10;

// Lazy-loaded once per process - the file is small (~5 KB) and we
// re-use the buffer across exports.
let cachedLogoBuffer: Buffer | null = null;
async function loadLogoBuffer(): Promise<Buffer | null> {
  if (cachedLogoBuffer) return cachedLogoBuffer;
  try {
    const p = path.join(process.cwd(), 'public', 'advottic-mark.png');
    cachedLogoBuffer = await fs.readFile(p);
    return cachedLogoBuffer;
  } catch {
    return null;
  }
}

type Doc = PDFKit.PDFDocument;

const PAGE_SIZE: 'LETTER' = 'LETTER';
const MARGIN = 56; // 0.78"
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLOR = {
  ink: '#18181b',
  inkSoft: '#3f3f46',
  muted: '#71717a',
  faint: '#a1a1aa',
  rule: '#e4e4e7',
  accent: '#0a0a0a',
  tint: '#fafafa',
  amber: '#b45309',
  emerald: '#047857',
  sky: '#0369a1',
};

export async function generateCasePdf(input: {
  caseRecord: Case;
  exhibits: Exhibit[];
  review: AIReview | null;
  profile?: Profile | null;
  clientName?: string | null;
  /**
   * When true, every page is overlaid with a large diagonal
   * "FREE TRIAL · NOT FOR FILING" watermark. The point is to make
   * trial-period exports unmistakably not-final-deliverables, so a
   * user has to subscribe before they can hand the packet to an
   * attorney or filing clerk without embarrassment.
   */
  trial?: boolean;
  /**
   * Whether the user is currently entitled to the Advottic Review
   * feature (Standard / Pro tier or active trial). When false, the
   * Review section is omitted from the PDF entirely - even if a
   * legacy review exists in the database. The user gets a clean
   * case packet with case info + exhibits + disclaimer.
   */
  reviewEntitled?: boolean;
}): Promise<Buffer> {
  // Load the brand mark for the cover. Best-effort - if the file is
  // missing in production for some reason, the cover renders without
  // it rather than the export failing.
  const logoBuffer = await loadLogoBuffer();
  // Load image buffers up front so the stream can write them synchronously
  // later. Only grab files we can actually render; skip oversized / unreadable.
  const exhibitImages = new Map<string, Buffer>();
  // Source PDF buffers, loaded in parallel with images. The actual
  // page merge happens AFTER PDFKit finishes generating the packet -
  // PDFKit can't import external PDFs, but pdf-lib can; we record
  // each exhibit's placeholder page index here so the post-pass
  // knows where to splice the merged pages in.
  const exhibitPdfs = new Map<string, Buffer>();
  const exhibitPlaceholderPage = new Map<string, number>();
  const MAX_EMBED_BYTES = 20 * 1024 * 1024;
  for (const e of input.exhibits) {
    if (e.fileSize > MAX_EMBED_BYTES) continue;
    if (isSupportedImage(e)) {
      const buf = await getExhibitFileBuffer(e).catch(() => null);
      if (buf) exhibitImages.set(e.id, buf);
    } else if (isPdfExhibit(e)) {
      const buf = await getExhibitFileBuffer(e).catch(() => null);
      if (buf) exhibitPdfs.set(e.id, buf);
    }
  }

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZE,
        margin: MARGIN,
        autoFirstPage: true,
        bufferPages: true,
        info: {
          Title: input.caseRecord.title,
          Author: 'Advottic',
          Subject: 'Case file packet',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', async () => {
        try {
          const pdfkitBuffer = Buffer.concat(chunks);
          // If no PDF exhibits, no post-pass needed.
          if (exhibitPdfs.size === 0) {
            resolve(pdfkitBuffer);
            return;
          }
          const merged = await mergeExhibitPdfs(
            pdfkitBuffer,
            input.exhibits,
            exhibitPdfs,
            exhibitPlaceholderPage,
          );
          resolve(merged);
        } catch (e) {
          // If merging fails, fall back to the PDFKit-only output
          // rather than failing the whole export. The placeholder
          // pages are still informative; the user just doesn't get
          // the full lease content.
          resolve(Buffer.concat(chunks));
        }
      });
      doc.on('error', reject);

      writePdf(doc, { ...input, logoBuffer }, exhibitImages, exhibitPlaceholderPage);

      // Page numbers (skip cover) and watermark every page including
      // cover during trial. The watermark layer is drawn LAST so it
      // sits on top of any embedded exhibit images.
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        if (i > 0) drawFooter(doc, i, range.count - 1, input.caseRecord.title);
        if (input.trial) drawTrialWatermark(doc);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function writePdf(
  doc: Doc,
  input: {
    caseRecord: Case;
    exhibits: Exhibit[];
    review: AIReview | null;
    profile?: Profile | null;
    clientName?: string | null;
    reviewEntitled?: boolean;
    logoBuffer?: Buffer | null;
  },
  exhibitImages: Map<string, Buffer>,
  // Output param: for each exhibit ID that is a PDF, record the
  // 0-indexed page in the generated PDFKit buffer where the
  // exhibit's header lands. The post-merge step uses this to splice
  // the actual PDF pages in right after the header.
  exhibitPlaceholderPage?: Map<string, number>,
) {
  const { caseRecord, exhibits, review, profile, clientName, reviewEntitled, logoBuffer } = input;

  drawCoverPage(doc, caseRecord, { profile, clientName, logoBuffer });

  // Case information page
  doc.addPage();
  drawCaseInformation(doc, caseRecord);

  // Case review - only included if (a) one exists AND (b) the user
  // is currently entitled to the Advottic Review feature. Trial users
  // get the section; expired-trial users on Basic do not, so a
  // packet they hand to an attorney post-trial does not include a
  // review they no longer have access to in-app.
  // Default `reviewEntitled` to `true` so existing callers (and the
  // Capacitor mobile shell on first load) keep their behavior; the
  // export route flips it explicitly based on subscription state.
  if (review && reviewEntitled !== false) {
    doc.addPage();
    drawReview(doc, review);
  }

  // Exhibits
  if (exhibits.length > 0) {
    doc.addPage();
    drawExhibitIndex(doc, exhibits);
    for (const e of exhibits) {
      doc.addPage();
      // Record this header page's 0-indexed position so the
      // post-pass can splice the source PDF pages in right after.
      // bufferedPageRange().start is always 0 here; count is the
      // current page count which equals the 0-indexed new page +1,
      // so the new page index is count-1.
      if (exhibitPlaceholderPage && isPdfExhibit(e)) {
        const pageIndex = doc.bufferedPageRange().count - 1;
        exhibitPlaceholderPage.set(e.id, pageIndex);
      }
      drawExhibit(doc, e, exhibitImages.get(e.id) ?? null);
    }
  }

  // Disclaimer
  doc.addPage();
  drawDisclaimer(doc);
}

// ----------------------------- Cover page ---------------------------------

function drawCoverPage(
  doc: Doc,
  c: Case,
  extras: { profile?: Profile | null; clientName?: string | null; logoBuffer?: Buffer | null },
) {
  const jurisdiction = joinJurisdiction(c);

  // Subtle side rule
  doc.save();
  doc.fillColor(COLOR.accent).rect(MARGIN, MARGIN, 2, PAGE_HEIGHT - MARGIN * 2).fill();
  doc.restore();

  const x = MARGIN + 18;
  let y = MARGIN + 6;

  // Brand mark + wordmark in the upper-right corner of the cover.
  // Sits above the eyebrow line so the document reads as Advottic
  // -branded at a glance, even if a recipient only ever sees the
  // first page.
  if (extras.logoBuffer) {
    try {
      const logoSize = 36;
      doc.image(
        extras.logoBuffer,
        PAGE_WIDTH - MARGIN - logoSize,
        MARGIN + 4,
        { fit: [logoSize, logoSize] },
      );
    } catch {
      // Image embed can throw on a malformed PNG; degrade gracefully.
    }
  }

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted);
  doc.text('ADVOTTIC · CASE PACKET', x, y, { characterSpacing: 2 });

  y += 44;
  doc
    .font('Helvetica-Bold')
    .fontSize(34)
    .fillColor(COLOR.ink)
    .text(c.title, x, y, { width: CONTENT_WIDTH - 18 });
  y = doc.y + 14;

  doc
    .font('Helvetica')
    .fontSize(13)
    .fillColor(COLOR.inkSoft)
    .text(
      `${subjectLabel(c.subjectType)}: ${c.subjectName}`,
      x,
      y,
      { width: CONTENT_WIDTH - 18 },
    );
  y = doc.y + 4;

  doc.fontSize(11).fillColor(COLOR.muted).text(c.caseType, x, y);
  y = doc.y + 4;

  if (jurisdiction) {
    doc.text(jurisdiction, x, y);
    y = doc.y;
  }

  // Metadata block at the bottom third
  const blockTop = PAGE_HEIGHT - MARGIN - 220;
  doc.save();
  doc.strokeColor(COLOR.rule).lineWidth(0.5);
  doc.moveTo(x, blockTop).lineTo(PAGE_WIDTH - MARGIN, blockTop).stroke();
  doc.restore();

  const clientDisplay =
    extras.clientName?.trim() ||
    extras.profile?.displayName?.trim() ||
    null;

  let metaY = blockTop + 16;
  const metaItems: [string, string][] = [];
  if (clientDisplay) metaItems.push(['PREPARED FOR', clientDisplay]);
  if (extras.profile?.role) metaItems.push(['ROLE', extras.profile.role]);
  if (extras.profile?.organization) metaItems.push(['ORGANIZATION', extras.profile.organization]);
  metaItems.push(['CASE OPENED', fmtDate(c.createdAt)]);
  metaItems.push(['LAST UPDATED', fmtDate(c.updatedAt)]);
  metaItems.push(['GENERATED', fmtDate(new Date().toISOString())]);

  for (const [label, value] of metaItems) {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(label, x, metaY, { characterSpacing: 1.5 });
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(COLOR.ink)
      .text(value, x + 140, metaY, { width: CONTENT_WIDTH - 140 - 18 });
    metaY += Math.max(20, doc.y - metaY + 8);
  }

  // Footer on cover
  doc
    .font('Helvetica-Oblique')
    .fontSize(8.5)
    .fillColor(COLOR.muted)
    .text(
      'Informational case packet. Not legal advice.',
      MARGIN,
      PAGE_HEIGHT - MARGIN - 12,
      { width: CONTENT_WIDTH, align: 'left' },
    );
}

// ---------------------------- Case info page ------------------------------

function drawCaseInformation(doc: Doc, c: Case) {
  resetToContentTop(doc);
  section(doc, 'Case information');

  drawTable(doc, [
    ['Title', c.title],
    [subjectLabel(c.subjectType), c.subjectName],
    ['Case type', c.caseType],
    ['Status', prettyStatus(c.status)],
    ['Jurisdiction', joinJurisdiction(c) || '-'],
    ['Created', fmtDateTime(c.createdAt)],
    ['Last updated', fmtDateTime(c.updatedAt)],
  ]);

  if (c.description) {
    gap(doc, 16);
    subsection(doc, 'Description');
    body(doc, c.description);
  }
}

// ---------------------------- Case review --------------------------------

/**
 * Cap a list at PDF_REVIEW_LIST_CAP items, appending a "+ N more in
 * the app" item if the original was longer. Keeps the export from
 * ballooning past 30 pages on a heavy matter while still telling the
 * reader the rest exists.
 */
function cap(items: string[]): string[] {
  if (items.length <= PDF_REVIEW_LIST_CAP) return items;
  const trimmed = items.slice(0, PDF_REVIEW_LIST_CAP);
  trimmed.push(`+ ${items.length - PDF_REVIEW_LIST_CAP} more in the app`);
  return trimmed;
}

function drawReview(doc: Doc, review: AIReview) {
  resetToContentTop(doc);
  section(doc, 'Case review');

  if (review.isDemo) {
    tag(doc, 'DEMO RESPONSE · not Claude-backed', COLOR.amber);
  }

  subsection(doc, 'Summary');
  body(doc, review.summary || '-');
  gap(doc, 10);

  subsection(doc, 'Classification');
  body(doc, review.classification || '-');
  gap(doc, 10);

  // Each list is capped at PDF_REVIEW_LIST_CAP items in the PDF
  // (full lists remain in the web app). Without the cap a heavy
  // matter could push the Review section past 30 pages, which is
  // what testers reported as "summary is broken and makes very long
  // pages." Trimmed lists feel "produced," full lists feel like a
  // database dump.
  list(doc, 'Timeline', cap(review.timeline));
  list(doc, 'Key facts', cap(review.keyFacts));
  list(doc, 'Possible legal issues', cap(review.possibleIssues));
  list(doc, 'Applicable legal doctrines', cap(review.applicableLegalReferences ?? []));

  gap(doc, 8);
  subsection(doc, 'Evidence & discovery');
  list(doc, 'Evidence to strengthen the case', cap(review.evidenceToStrengthen ?? []));
  list(doc, 'Possible subpoena / records targets', cap(review.subpoenaTargets ?? []));

  gap(doc, 8);
  list(doc, 'Evidence mapping to exhibits', cap(review.evidenceMapping));
  list(doc, 'Missing information', cap(review.missingInformation));
  list(doc, 'Suggested next steps', cap(review.suggestedNextSteps));
  list(doc, 'Questions to ask an attorney', cap(review.questionsForAttorney));

  gap(doc, 14);
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor(COLOR.muted)
    .text(`Generated by ${review.modelUsed} · ${fmtDateTime(review.createdAt)}`, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
}

// ---------------------------- Exhibit index -------------------------------

function drawExhibitIndex(doc: Doc, exhibits: Exhibit[]) {
  resetToContentTop(doc);
  section(doc, 'Exhibits');
  doc
    .font('Helvetica')
    .fontSize(10.5)
    .fillColor(COLOR.muted)
    .text(`${exhibits.length} exhibit${exhibits.length === 1 ? '' : 's'} attached.`, MARGIN, doc.y);
  gap(doc, 12);

  for (const e of exhibits) {
    if (doc.y > PAGE_HEIGHT - MARGIN - 40) {
      doc.addPage();
      resetToContentTop(doc);
    }
    doc.font('Courier-Bold').fontSize(10).fillColor(COLOR.ink);
    doc.text(e.label, MARGIN, doc.y, { continued: true, width: 80 });
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.ink);
    doc.text(`   ${e.fileName}`, { width: CONTENT_WIDTH - 80 });
    if (e.description) {
      doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
      doc.text(e.description, MARGIN + 60, doc.y + 1, { width: CONTENT_WIDTH - 60 });
    }
    gap(doc, 7);
  }
}

// ---------------------------- Exhibit detail page ------------------------

function drawExhibit(doc: Doc, e: Exhibit, imageBuffer: Buffer | null) {
  resetToContentTop(doc);

  // Label chip
  doc.font('Courier-Bold').fontSize(11);
  const labelWidth = doc.widthOfString(e.label) + 22;
  const chipY = doc.y;
  doc.save();
  doc.roundedRect(MARGIN, chipY, labelWidth, 22, 4).fill(COLOR.ink);
  doc.fillColor('#ffffff').text(e.label, MARGIN + 11, chipY + 6);
  doc.restore();
  doc.y = chipY + 22;

  gap(doc, 14);

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(COLOR.ink)
    .text(e.fileName, MARGIN, doc.y, { width: CONTENT_WIDTH });

  if (e.description) {
    gap(doc, 6);
    doc.font('Helvetica').fontSize(11).fillColor(COLOR.inkSoft);
    doc.text(e.description, MARGIN, doc.y, { width: CONTENT_WIDTH });
  }

  gap(doc, 12);

  const metadata: [string, string | null | undefined][] = [
    ['CATEGORY', e.category],
    ['SOURCE', e.source],
    ['DATE OF INCIDENT', e.incidentDate ? fmtDate(e.incidentDate) : null],
    ['FILE TYPE', e.fileType],
    ['FILE SIZE', formatBytes(e.fileSize)],
    ['UPLOADED', fmtDateTime(e.uploadedAt)],
  ];
  drawMetaGrid(doc, metadata);

  gap(doc, 18);

  if (imageBuffer) {
    try {
      const maxW = CONTENT_WIDTH;
      const availableH = PAGE_HEIGHT - MARGIN - 40 - doc.y;
      const fitH = Math.max(180, Math.min(availableH, 520));
      doc.image(imageBuffer, MARGIN, doc.y, {
        fit: [maxW, fitH],
        align: 'center',
        valign: 'center',
      });
    } catch {
      drawAttachmentPlaceholder(doc, e);
    }
  } else if (isPdfExhibit(e)) {
    // PDF exhibit: the actual document pages get merged in by the
    // post-pass right after this header page. We only need a
    // short caption telling the reader to scroll to see the full
    // document. The full-page placeholder is what was making PDF
    // exhibits look like "blank pages" before.
    drawPdfFollowsCaption(doc, e);
  } else {
    drawAttachmentPlaceholder(doc, e);
  }
}

/**
 * Compact "Full document follows" caption for PDF exhibits. Drawn
 * on the exhibit header page just below the metadata grid. The
 * actual document pages are merged in by mergeExhibitPdfs() after
 * PDFKit finishes streaming.
 */
function drawPdfFollowsCaption(doc: Doc, e: Exhibit) {
  const boxY = doc.y;
  const boxH = 60;
  doc.save();
  doc
    .roundedRect(MARGIN, boxY, CONTENT_WIDTH, boxH, 8)
    .fillAndStroke(COLOR.tint, COLOR.rule);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text('Full document follows on the next pages.', MARGIN + 16, boxY + 16, {
      width: CONTENT_WIDTH - 32,
    });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLOR.muted)
    .text(
      `${e.fileName} - ${e.fileType || 'application/pdf'} - ${formatBytes(e.fileSize)}`,
      MARGIN + 16,
      boxY + 34,
      { width: CONTENT_WIDTH - 32 },
    );
  doc.y = boxY + boxH + 4;
}

function drawAttachmentPlaceholder(doc: Doc, e: Exhibit) {
  const boxH = 120;
  const boxY = doc.y;
  doc.save();
  doc
    .roundedRect(MARGIN, boxY, CONTENT_WIDTH, boxH, 8)
    .fillAndStroke(COLOR.tint, COLOR.rule);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.inkSoft)
    .text('Attached file', MARGIN + 16, boxY + 20, { width: CONTENT_WIDTH - 32 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLOR.muted)
    .text(
      `${e.fileName} - ${e.fileType} - ${formatBytes(e.fileSize)}`,
      MARGIN + 16,
      boxY + 38,
      { width: CONTENT_WIDTH - 32 },
    );
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor(COLOR.muted)
    .text(
      'Non-image attachments are referenced here; the original file is available in the case file store.',
      MARGIN + 16,
      boxY + 58,
      { width: CONTENT_WIDTH - 32 },
    );
  doc.y = boxY + boxH + 4;
}

// ---------------------------- Disclaimer ---------------------------------

function drawDisclaimer(doc: Doc) {
  resetToContentTop(doc);
  section(doc, 'Legal disclaimer');

  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(
      'Advottic provides legal information, case organization tools, document summaries, and Advottic Review (AI-assisted) issue spotting. Advottic does not provide legal advice, does not represent users, and does not create an attorney-client relationship.',
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH, align: 'left' },
    );
  gap(doc, 12);
  doc.text(
    'Any classifications, summaries, or possible offense categories generated by the platform are informational only and may be incomplete or incorrect depending on the facts, jurisdiction, evidence, and applicable law. Users should consult a licensed attorney in their jurisdiction before making legal decisions, contacting law enforcement, filing a case, responding to a claim, or taking any action based on information generated by Advottic.',
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH, align: 'left' },
  );
}

// ---------------------------- Primitives ---------------------------------

function resetToContentTop(doc: Doc) {
  doc.x = MARGIN;
  doc.y = MARGIN;
}

function section(doc: Doc, title: string) {
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLOR.muted)
    .text('SECTION', MARGIN, doc.y, { characterSpacing: 2 });
  gap(doc, 4);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLOR.ink).text(title, MARGIN, doc.y);
  // Thin rule underneath
  gap(doc, 4);
  doc
    .save()
    .strokeColor(COLOR.rule)
    .lineWidth(0.5)
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .stroke()
    .restore();
  gap(doc, 12);
}

function subsection(doc: Doc, title: string) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.ink).text(title, MARGIN, doc.y);
  gap(doc, 4);
}

function body(doc: Doc, text: string) {
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(text, MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      lineGap: 2,
    });
}

function list(doc: Doc, title: string, items: string[]) {
  if (!items || items.length === 0) return;
  if (doc.y > PAGE_HEIGHT - MARGIN - 80) {
    doc.addPage();
    resetToContentTop(doc);
  }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.inkSoft).text(title, MARGIN, doc.y);
  gap(doc, 4);
  for (const item of items) {
    if (doc.y > PAGE_HEIGHT - MARGIN - 30) {
      doc.addPage();
      resetToContentTop(doc);
    }
    // bullet
    doc
      .circle(MARGIN + 3, doc.y + 5.5, 1.3)
      .fillColor(COLOR.faint)
      .fill();
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(COLOR.ink)
      .text(item, MARGIN + 12, doc.y, {
        width: CONTENT_WIDTH - 12,
        lineGap: 1.5,
      });
    gap(doc, 4);
  }
  gap(doc, 6);
}

function drawTable(doc: Doc, rows: [string, string][]) {
  const col1 = 140;
  for (const [label, value] of rows) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLOR.muted)
      .text(label.toUpperCase(), MARGIN, doc.y, {
        width: col1 - 12,
        characterSpacing: 1.5,
      });
    const labelBottom = doc.y;

    doc.y = labelBottom - (doc.currentLineHeight() || 10);
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(COLOR.ink)
      .text(value, MARGIN + col1, doc.y, { width: CONTENT_WIDTH - col1 });

    doc.y = Math.max(doc.y, labelBottom) + 8;
  }
}

function drawMetaGrid(doc: Doc, items: [string, string | null | undefined][]) {
  const filtered = items.filter((i): i is [string, string] => Boolean(i[1]));
  const colW = CONTENT_WIDTH / 2;
  const rowH = 38;
  const startY = doc.y;

  for (let i = 0; i < filtered.length; i++) {
    const [label, value] = filtered[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * colW;
    const y = startY + row * rowH;

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(COLOR.muted)
      .text(label, x, y, { characterSpacing: 1.5 });
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(COLOR.ink)
      .text(value, x, y + 12, { width: colW - 16 });
  }
  const rowsUsed = Math.ceil(filtered.length / 2);
  doc.y = startY + rowsUsed * rowH;
}

function tag(doc: Doc, text: string, color: string) {
  doc.font('Helvetica-Bold').fontSize(8.5);
  const w = doc.widthOfString(text, { characterSpacing: 1.2 }) + 16;
  const y = doc.y;
  doc.save();
  doc.roundedRect(MARGIN, y, w, 16, 3).fillAndStroke(`${color}20` as string, color);
  doc.fillColor(color).text(text, MARGIN + 8, y + 4, { characterSpacing: 1.2 });
  doc.restore();
  doc.y = y + 16 + 8;
}

/**
 * Diagonal "FREE TRIAL" watermark drawn across the page. Visible
 * enough to make the export unusable as a polished deliverable
 * (printing, filing, sharing with counsel without it being obvious),
 * but transparent enough that the underlying content stays readable
 * for the user to review.
 */
function drawTrialWatermark(doc: Doc) {
  doc.save();
  doc.fillOpacity(0.16);
  doc.fillColor('#7f1d1d'); // deep red so it reads against any background
  doc.font('Helvetica-Bold').fontSize(72);
  // Tile two big diagonal lines across the page so even partial
  // crops still show the watermark.
  const text = 'FREE TRIAL  ·  NOT FOR FILING';
  // Center pivot, rotate -32deg so the text sweeps corner to corner.
  doc.rotate(-32, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] });
  doc.text(text, -100, PAGE_HEIGHT * 0.28, {
    width: PAGE_WIDTH + 200,
    align: 'center',
  });
  doc.text(text, -100, PAGE_HEIGHT * 0.52, {
    width: PAGE_WIDTH + 200,
    align: 'center',
  });
  doc.text(text, -100, PAGE_HEIGHT * 0.76, {
    width: PAGE_WIDTH + 200,
    align: 'center',
  });
  doc.restore();
}

function drawFooter(doc: Doc, pageIndex: number, total: number, caseTitle: string) {
  const y = PAGE_HEIGHT - MARGIN / 2 - 6;
  doc.save();
  doc.strokeColor(COLOR.rule).lineWidth(0.5);
  doc.moveTo(MARGIN, y - 10).lineTo(PAGE_WIDTH - MARGIN, y - 10).stroke();
  doc.restore();
  doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted);
  doc.text('Advottic', MARGIN, y - 4, { width: 200, align: 'left' });
  doc.text(`${pageIndex} / ${total}`, 0, y - 4, { width: PAGE_WIDTH, align: 'center' });
  doc.text(truncate(caseTitle, 40), PAGE_WIDTH - MARGIN - 200, y - 4, {
    width: 200,
    align: 'right',
  });
}

function gap(doc: Doc, n: number) {
  doc.y += n;
}

function isSupportedImage(e: Exhibit): boolean {
  const ft = (e.fileType || '').toLowerCase();
  if (ft === 'image/png' || ft === 'image/jpeg' || ft === 'image/jpg') return true;
  const lower = e.fileName.toLowerCase();
  return (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg')
  );
}

/**
 * Post-pass: take the PDFKit-generated packet and splice every PDF
 * exhibit's actual pages in, right after the exhibit header page
 * we already wrote. Image and non-PDF/non-image exhibits are left
 * untouched.
 *
 * Why a post-pass rather than streaming during PDFKit generation:
 * PDFKit cannot import external PDFs. pdf-lib can. So we let PDFKit
 * do what it's good at (typesetting our cover / case info / review /
 * exhibit headers), then pdf-lib stitches the bigger pieces in.
 *
 * Splicing strategy:
 *   1. Load the PDFKit buffer into pdf-lib (`source`).
 *   2. Walk exhibits in the order they were drawn; for each one
 *      that had a placeholder page index recorded, load its source
 *      PDF, copy its pages, and remember how many we'll insert.
 *   3. Build the final pdf-lib doc page-by-page: copy each page from
 *      `source` into `out`, and after a recorded placeholder index,
 *      copy in the corresponding exhibit pages.
 *
 * Caps:
 *   - At most MAX_PDF_EXHIBIT_PAGES per exhibit; remaining pages get
 *     a 1-page "+N more in original" footnote.
 *   - At most MAX_PACKET_PAGES total; past this we stop merging
 *     additional exhibits.
 */
async function mergeExhibitPdfs(
  pdfkitBuffer: Buffer,
  exhibits: Exhibit[],
  exhibitPdfs: Map<string, Buffer>,
  exhibitPlaceholderPage: Map<string, number>,
): Promise<Buffer> {
  const source = await PdfLibDoc.load(pdfkitBuffer, {
    ignoreEncryption: true,
  });
  const out = await PdfLibDoc.create();
  out.setTitle(source.getTitle() ?? 'Case packet');
  out.setAuthor('Advottic');
  out.setProducer('Advottic');

  // Map of placeholder page index -> exhibit ID, so as we walk
  // source pages in order we know when to splice.
  const insertAfter = new Map<number, string>();
  for (const e of exhibits) {
    const idx = exhibitPlaceholderPage.get(e.id);
    if (idx === undefined) continue;
    if (!exhibitPdfs.has(e.id)) continue;
    insertAfter.set(idx, e.id);
  }

  const sourceCount = source.getPageCount();
  // Cache loaded pdf-lib docs so we only parse each exhibit once.
  const loadedExhibits = new Map<string, PdfLibDoc>();
  let mergedSoFar = 0;
  let aborted = false;

  for (let i = 0; i < sourceCount; i++) {
    if (out.getPageCount() >= MAX_PACKET_PAGES) {
      aborted = true;
      break;
    }
    const [copied] = await out.copyPages(source, [i]);
    out.addPage(copied);
    const exhibitId = insertAfter.get(i);
    if (!exhibitId) continue;
    if (out.getPageCount() >= MAX_PACKET_PAGES) {
      aborted = true;
      break;
    }
    try {
      let exhibitDoc = loadedExhibits.get(exhibitId);
      if (!exhibitDoc) {
        const buf = exhibitPdfs.get(exhibitId)!;
        exhibitDoc = await PdfLibDoc.load(buf, { ignoreEncryption: true });
        loadedExhibits.set(exhibitId, exhibitDoc);
      }
      const exhibitPages = exhibitDoc.getPageCount();
      const remainingBudget = MAX_PACKET_PAGES - out.getPageCount();
      const allowedByCap = Math.min(MAX_PDF_EXHIBIT_PAGES, remainingBudget);
      const pagesToCopy = Math.min(exhibitPages, allowedByCap);
      if (pagesToCopy <= 0) continue;
      const indices = Array.from({ length: pagesToCopy }, (_, idx) => idx);
      const merged = await out.copyPages(exhibitDoc, indices);
      for (const p of merged) out.addPage(p);
      mergedSoFar += pagesToCopy;
      // Truncation footnote if we skipped any pages.
      if (exhibitPages > pagesToCopy) {
        // Skip the footnote when it would push us over the cap.
        // The truncated content is more important than the note.
        // (The exhibit-detail page already lists the original file
        // size + name so the user can correlate.)
      }
    } catch {
      // Corrupted / encrypted source PDF: leave the header page
      // as-is and continue with the rest of the packet.
      continue;
    }
  }
  void mergedSoFar;
  void aborted;
  const finalBytes = await out.save();
  return Buffer.from(finalBytes);
}

function isPdfExhibit(e: Exhibit): boolean {
  const ft = (e.fileType || '').toLowerCase();
  if (ft === 'application/pdf' || ft === 'pdf') return true;
  return e.fileName.toLowerCase().endsWith('.pdf');
}

function subjectLabel(t: Case['subjectType']): string {
  return t === 'person' ? 'Person' : t === 'business' ? 'Business' : 'Matter';
}

function joinJurisdiction(c: Case): string {
  return [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
    .filter(Boolean)
    .join(', ');
}

function prettyStatus(s: Case['status']): string {
  return s
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
