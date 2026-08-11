import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDoc, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  AIReview,
  Case,
  Exhibit,
  Profile,
} from './types';
import type { CommunityExportData } from './community-types';
import { getExhibitFileBuffer } from './storage';
import { normalizeString, type NormRule } from './text-normalize';

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
/**
 * Largest exhibit we will pull into memory to embed. The upload form accepts
 * 50MB, so this cap is reachable by an ordinary upload: anything past it is
 * named on its own header page as not reproduced, never dropped in silence.
 */
const MAX_EMBED_BYTES = 20 * 1024 * 1024;

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
  // The exact source pages each PDF exhibit will contribute: blanks already
  // dropped, per-exhibit cap already applied. The header page and the merge
  // both read this, so the page cannot promise pages the merge won't add.
  const exhibitPageIndices = new Map<string, number[]>();
  const plans = new Map<string, ExhibitRenderPlan>();

  for (const e of input.exhibits) {
    const image = isSupportedImage(e);
    const pdf = isPdfExhibit(e);
    // An image we have no decoder for, and a file that is neither an image
    // nor a document, are different statements to the reader.
    if (!image && !pdf) {
      const looksLikeImage = (e.fileType || '').toLowerCase().startsWith('image/');
      plans.set(
        e.id,
        planExhibitRender(e, { status: looksLikeImage ? 'unsupported-image' : 'not-applicable' }),
      );
      continue;
    }
    if (e.fileSize > MAX_EMBED_BYTES) {
      plans.set(e.id, planExhibitRender(e, { status: 'too-large' }));
      continue;
    }
    const buf = await getExhibitFileBuffer(e).catch(() => null);
    if (!buf || buf.byteLength === 0) {
      plans.set(e.id, planExhibitRender(e, { status: 'unreadable' }));
      continue;
    }
    if (image) {
      exhibitImages.set(e.id, buf);
      plans.set(e.id, planExhibitRender(e, { status: 'ok', totalPages: 0, usablePages: 0 }));
      continue;
    }
    // A PDF: open it now so the page count on the header is the real one. A
    // source we cannot parse is withheld by name rather than promised and
    // then skipped by the merge's catch.
    try {
      const doc = await PdfLibDoc.load(buf, { ignoreEncryption: true });
      const totalPages = doc.getPageCount();
      const indices: number[] = [];
      for (let i = 0; i < totalPages && indices.length < MAX_PDF_EXHIBIT_PAGES; i++) {
        if (!isPageLikelyBlank(doc.getPage(i))) indices.push(i);
      }
      const plan = planExhibitRender(e, {
        status: 'ok',
        totalPages,
        usablePages: indices.length,
      });
      plans.set(e.id, plan);
      if (plan.kind === 'document') {
        exhibitPdfs.set(e.id, buf);
        exhibitPageIndices.set(e.id, indices);
      }
    } catch {
      plans.set(e.id, planExhibitRender(e, { status: 'unreadable' }));
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
            exhibitPageIndices,
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

      writePdf(doc, { ...input, logoBuffer }, exhibitImages, exhibitPlaceholderPage, plans);

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
  // What the packet is allowed to claim about each exhibit. Absent for the
  // legacy callers that pass no plans; those fall back to the old behaviour.
  plans?: Map<string, ExhibitRenderPlan>,
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
      drawExhibit(doc, e, exhibitImages.get(e.id) ?? null, plans?.get(e.id));
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

function drawExhibit(
  doc: Doc,
  e: Exhibit,
  imageBuffer: Buffer | null,
  plan?: ExhibitRenderPlan,
) {
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

  // An exhibit the packet cannot reproduce is named here, with the reason,
  // because a record that omits evidence without saying so is worse than one
  // that says plainly what is missing.
  if (plan?.kind === 'withheld') {
    drawWithheldNotice(doc, e, plan.reason);
    return;
  }

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
      drawWithheldNotice(
        doc,
        e,
        'This image could not be rendered into the packet. The original is unchanged in your case file.',
      );
    }
  } else if (plan ? plan.kind === 'document' : isPdfExhibit(e)) {
    // PDF exhibit: the actual document pages get merged in by the
    // post-pass right after this header page. We only need a
    // short caption telling the reader to scroll to see the full
    // document. The full-page placeholder is what was making PDF
    // exhibits look like "blank pages" before.
    drawPdfFollowsCaption(doc, e, plan?.kind === 'document' ? plan : undefined);
  } else {
    drawAttachmentPlaceholder(doc, e);
  }
}

/**
 * Say, on the exhibit's own page, that the file is not reproduced and why.
 *
 * Neutral register on purpose: this is a court-facing document, and the reader
 * is often the person whose evidence it is.
 */
function drawWithheldNotice(doc: Doc, e: Exhibit, reason: string) {
  const boxY = doc.y;
  const boxH = 118;
  doc.save();
  doc
    .roundedRect(MARGIN, boxY, CONTENT_WIDTH, boxH, 8)
    .fillAndStroke(COLOR.tint, COLOR.rule);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text('Not reproduced in this packet', MARGIN + 16, boxY + 18, {
      width: CONTENT_WIDTH - 32,
    });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLOR.inkSoft)
    .text(reason, MARGIN + 16, boxY + 36, { width: CONTENT_WIDTH - 32 });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLOR.muted)
    .text(
      `${e.fileName} - ${e.fileType || 'unknown type'} - ${formatBytes(e.fileSize)}`,
      MARGIN + 16,
      boxY + boxH - 26,
      { width: CONTENT_WIDTH - 32 },
    );
  doc.y = boxY + boxH + 4;
}

/**
 * Compact "Full document follows" caption for PDF exhibits. Drawn
 * on the exhibit header page just below the metadata grid. The
 * actual document pages are merged in by mergeExhibitPdfs() after
 * PDFKit finishes streaming.
 */
function drawPdfFollowsCaption(
  doc: Doc,
  e: Exhibit,
  plan?: { reproduced: number; total: number },
) {
  const boxY = doc.y;
  const boxH = 60;
  // A document trimmed by the per-exhibit page cap must not be described as
  // the full document. The cap was always there; the sentence saying so was
  // computed and then discarded.
  const partial = plan ? plan.reproduced < plan.total : false;
  const headline = partial
    ? `First ${plan!.reproduced} pages of ${plan!.total} follow. The rest is in the original file.`
    : 'Full document follows on the next pages.';
  doc.save();
  doc
    .roundedRect(MARGIN, boxY, CONTENT_WIDTH, boxH, 8)
    .fillAndStroke(COLOR.tint, COLOR.rule);
  doc.restore();
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(headline, MARGIN + 16, boxY + 16, {
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
      'Advottic provides legal information, case organization tools, document summaries, and Advottic Review issue spotting. Advottic does not provide legal advice, does not represent users, and does not create an attorney-client relationship.',
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

/**
 * What we found when we went to fetch an exhibit's bytes.
 *
 * `usablePages` is the number of pages that will actually be copied into the
 * packet: blanks removed, per-exhibit cap already applied. It is computed once,
 * in the pre-pass, and both the header page and the merge read the same number,
 * so the page cannot promise something the merge does not deliver.
 */
export type ExhibitSource =
  | { status: 'ok'; totalPages: number; usablePages: number }
  | { status: 'too-large' }
  | { status: 'unreadable' }
  | { status: 'unsupported-image' }
  | { status: 'not-applicable' };

/** What the packet will show for one exhibit, and what it may therefore say. */
export type ExhibitRenderPlan =
  | { kind: 'image' }
  | { kind: 'document'; reproduced: number; total: number }
  | { kind: 'attachment' }
  | { kind: 'withheld'; reason: string };

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decide what the packet may claim about one exhibit.
 *
 * The packet is offered as a record of a case, so an exhibit it cannot
 * reproduce has to be named as missing, with a reason, rather than quietly
 * left out. Every branch here ends in a statement the reader can act on.
 */
export function planExhibitRender(e: Exhibit, source: ExhibitSource): ExhibitRenderPlan {
  switch (source.status) {
    case 'too-large':
      return {
        kind: 'withheld',
        reason: `This file is too large to reproduce inside the packet (${mb(e.fileSize)}; the limit is ${mb(MAX_EMBED_BYTES)}). The original is unchanged in your case file.`,
      };
    case 'unreadable':
      return {
        kind: 'withheld',
        reason:
          'This file could not be read from storage while the packet was being generated, so it is not reproduced here. The original is still listed on the case.',
      };
    case 'unsupported-image':
      return {
        kind: 'withheld',
        reason: `This image format (${e.fileType || 'unknown'}) cannot be embedded in a PDF, so the picture itself is not reproduced here. The original is unchanged in your case file.`,
      };
    case 'not-applicable':
      return { kind: 'attachment' };
    case 'ok':
    default:
      if (isSupportedImage(e)) return { kind: 'image' };
      if (isPdfExhibit(e)) {
        if (source.usablePages <= 0) {
          return {
            kind: 'withheld',
            reason:
              'Every page of this document is blank, so there is nothing to reproduce here. The original is unchanged in your case file.',
          };
        }
        return { kind: 'document', reproduced: source.usablePages, total: source.totalPages };
      }
      return { kind: 'attachment' };
  }
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
  exhibitPageIndices: Map<string, number[]>,
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
  const cutByPacketCap: string[] = [];

  for (let i = 0; i < sourceCount; i++) {
    const [copied] = await out.copyPages(source, [i]);
    out.addPage(copied);
    const exhibitId = insertAfter.get(i);
    if (!exhibitId) continue;
    // The pages were chosen in the pre-pass, by the same pass that wrote the
    // header sentence. Recomputing them here is how the page and the merge
    // drifted apart: the page promised a document the merge then skipped.
    const chosen = exhibitPageIndices.get(exhibitId) ?? [];
    if (chosen.length === 0) continue;
    const remainingBudget = MAX_PACKET_PAGES - out.getPageCount();
    if (chosen.length > remainingBudget) {
      // The packet cap, not this exhibit, is what stops us. Record it and keep
      // going: the remaining source pages are this packet's own header and
      // disclaimer pages, and dropping those is how an exhibit would vanish
      // from the record entirely rather than merely losing its attachment.
      cutByPacketCap.push(exhibitId);
      continue;
    }
    try {
      let exhibitDoc = loadedExhibits.get(exhibitId);
      if (!exhibitDoc) {
        const buf = exhibitPdfs.get(exhibitId)!;
        exhibitDoc = await PdfLibDoc.load(buf, { ignoreEncryption: true });
        loadedExhibits.set(exhibitId, exhibitDoc);
      }
      const merged = await out.copyPages(exhibitDoc, chosen);
      for (const p of merged) out.addPage(p);
      mergedSoFar += chosen.length;
    } catch {
      // Corrupted / encrypted source PDF: the header page already said the
      // document follows, so name it rather than leaving a bare promise.
      cutByPacketCap.push(exhibitId);
    }
  }
  if (cutByPacketCap.length > 0) {
    await appendOmissionNote(out, exhibits, cutByPacketCap);
  }
  void mergedSoFar;
  const finalBytes = await out.save();
  return Buffer.from(finalBytes);
}

/**
 * Final page listing exhibits whose documents did not fit.
 *
 * Without it the packet simply ends, and an exhibit that promised "full
 * document follows" is followed by the disclaimer. A reader has no way to tell
 * that from a document that genuinely had nothing more in it.
 */
async function appendOmissionNote(
  out: PdfLibDoc,
  exhibits: Exhibit[],
  omittedIds: string[],
) {
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const page = out.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN - 20;
  page.drawText('Exhibits not reproduced in full', {
    x: MARGIN,
    y,
    size: 16,
    font: bold,
  });
  y -= 26;
  page.drawText(
    `This packet reached its ${MAX_PACKET_PAGES}-page limit. The exhibits below are`,
    { x: MARGIN, y, size: 10.5, font },
  );
  y -= 15;
  page.drawText(
    'listed on the case and unchanged in your case file, but their pages are not',
    { x: MARGIN, y, size: 10.5, font },
  );
  y -= 15;
  page.drawText('included here.', { x: MARGIN, y, size: 10.5, font });
  y -= 26;
  for (const id of omittedIds) {
    const e = exhibits.find((x) => x.id === id);
    if (!e || y < MARGIN + 30) continue;
    page.drawText(`${e.label}   ${e.fileName}`, { x: MARGIN, y, size: 10, font });
    y -= 16;
  }
}

/**
 * Heuristic blank-page detector for pdf-lib PDFPage instances.
 * Inspects the raw bytes of the page's content stream(s).
 *
 * Rationale: a PDF page that draws nothing has a content stream
 * of basically zero bytes (or a few harmless `q Q` save/restore
 * pairs). A page with even one short line of text easily passes
 * 100 bytes raw. We use a generous threshold so a real "blank
 * with footer/page-number" page can still slip through and be
 * kept - we'd rather show one near-blank page than drop a real one.
 *
 * Falls back to false (treat as non-blank) on any pdf-lib internal
 * shape we don't recognise, so a parsing quirk never causes a
 * missing page in the final packet.
 */
function isPageLikelyBlank(page: PDFPage): boolean {
  try {
    // We reach into pdf-lib internals because there's no public
    // API for "is this page blank." page.node is a PDFPageLeaf;
    // .Contents() returns a PDFRef, PDFArray, or undefined.
    const node = page.node as unknown as {
      Contents?: () => unknown;
    };
    const contents = node.Contents?.();
    if (!contents) return true;
    const doc = page.doc;
    const ctx = (doc as unknown as { context: { lookup: (r: unknown) => unknown } }).context;

    // Normalize to an array of stream-bearing values.
    const arr = contents as { asArray?: () => unknown[] };
    const refsOrStreams = typeof arr.asArray === 'function' ? arr.asArray() : [contents];

    let totalBytes = 0;
    for (const r of refsOrStreams) {
      // r might already be the stream object, or a ref we still
      // need to resolve. ctx.lookup is idempotent for already-
      // resolved objects in practice.
      const stream = ctx.lookup(r) as { contents?: Uint8Array } | undefined;
      if (stream && stream.contents && typeof stream.contents.length === 'number') {
        totalBytes += stream.contents.length;
      }
    }
    // 60 bytes is a tested threshold: an empty stream is 0 bytes,
    // a minimal `q Q` is ~5 bytes, page-numbers-and-footer pages
    // typically clock 200-1000 bytes, and even a single text line
    // is ~80-150 bytes. 60 leaves room for tiny watermark-only
    // pages while still catching auto-feed scanner blanks.
    return totalBytes < 60;
  } catch {
    return false;
  }
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

// ----------------------- Community Case export -----------------------

/**
 * Bundles a Community Case's public-facing summary plus every witness
 * submission (evidence/testimonial in v1; Letters of Support will extend
 * this once that slice ships) into one PDF for the case's attorney.
 * Reuses the same low-level primitives as generateCasePdf (section,
 * drawMetaGrid, drawFooter, etc.) rather than a parallel layout system.
 *
 * The cover page identifies the organizer (name, email, account age) -
 * this is a deliberate anti-fraud measure, not an incidental detail: it's
 * the artifact that lets an attorney (or a fraud investigation, if it
 * ever comes to that) trace a page back to a real, email-verified
 * Advottic account. It is never shown on the public page itself.
 */
export async function generateCommunitySubmissionsPdf(
  input: CommunityExportData,
): Promise<Buffer> {
  const logoBuffer = await loadLogoBuffer();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZE,
        margin: MARGIN,
        autoFirstPage: true,
        bufferPages: true,
        info: {
          Title: `${input.communityCase.displayName} - Community Case packet`,
          Author: 'Advottic',
          Subject: 'Community Case submissions packet',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      drawCommunityCoverPage(doc, input, logoBuffer);

      for (const s of input.submissions) {
        doc.addPage();
        drawWitnessSubmission(doc, s);
      }

      doc.addPage();
      drawDisclaimer(doc);

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        if (i > 0) drawFooter(doc, i, range.count - 1, input.communityCase.displayName);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawCommunityCoverPage(
  doc: Doc,
  input: CommunityExportData,
  logoBuffer: Buffer | null,
) {
  resetToContentTop(doc);
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, MARGIN, doc.y, { width: 28 });
    } catch {
      /* best-effort */
    }
  }
  doc.y += logoBuffer ? 40 : 0;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted).text('COMMUNITY CASE PACKET', MARGIN, doc.y, {
    characterSpacing: 2,
  });
  gap(doc, 6);
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLOR.ink).text(input.communityCase.displayName, MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  gap(doc, 16);

  drawMetaGrid(doc, [
    ['CASE NUMBER', input.communityCase.caseNumber],
    ['STATUS', input.communityCase.status],
    ['EXPORTED', fmtDateTime(new Date().toISOString())],
    ['LETTERS OF SUPPORT', String(input.communityCase.letterCount)],
    ['EVIDENCE / TESTIMONIALS', String(input.communityCase.evidenceCount)],
  ]);
  gap(doc, 20);

  if (input.communityCase.publicSummary) {
    subsection(doc, "Organizer's public summary");
    body(doc, input.communityCase.publicSummary);
    gap(doc, 16);
  }

  // Organizer identity block - see the function doc comment for why this
  // is not optional. Confidential; never rendered on the public page.
  doc
    .save()
    .roundedRect(MARGIN, doc.y, CONTENT_WIDTH, 76, 6)
    .fillAndStroke('#fafafa', COLOR.rule)
    .restore();
  const boxTop = doc.y + 12;
  doc.y = boxTop;
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(COLOR.muted)
    .text('ORGANIZER (VERIFIED ADVOTTIC ACCOUNT) - FOR YOUR RECORDS ONLY', MARGIN + 14, doc.y, {
      characterSpacing: 1.2,
    });
  gap(doc, 6);
  doc.x = MARGIN + 14;
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(COLOR.ink)
    .text(
      `${input.organizer.name} · ${input.organizer.email}${
        input.organizer.accountCreatedAt
          ? ` · account created ${fmtDate(input.organizer.accountCreatedAt)}`
          : ''
      }`,
      MARGIN + 14,
      doc.y,
      { width: CONTENT_WIDTH - 28 },
    );
  doc.y = boxTop + 76 - 12 + 12;
}

function drawWitnessSubmission(
  doc: Doc,
  s: CommunityExportData['submissions'][number],
) {
  resetToContentTop(doc);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(COLOR.muted)
    .text('SUBMISSION - CONFIDENTIAL, NOT FOR PUBLIC DISTRIBUTION', MARGIN, doc.y, {
      characterSpacing: 1.2,
    });
  gap(doc, 6);
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(COLOR.ink)
    .text(s.fullName || 'Anonymous submitter', MARGIN, doc.y, { width: CONTENT_WIDTH });
  gap(doc, 10);

  if (s.kind === 'letter_of_support') {
    const addr = s.mailingAddress;
    drawMetaGrid(doc, [
      ['SUBMITTED', fmtDateTime(s.createdAt)],
      ['TYPE', 'Letter of Support'],
      ['MAILING ADDRESS', addr ? `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}` : null],
    ]);
    gap(doc, 14);

    if (s.letterBody) {
      subsection(doc, 'Letter');
      body(doc, s.letterBody);
      gap(doc, 16);
    }

    if (s.signatureBuffer) {
      subsection(doc, 'Signature');
      try {
        doc.image(s.signatureBuffer, MARGIN, doc.y, { fit: [280, 100] });
        doc.y += 108;
      } catch {
        /* best-effort */
      }
      gap(doc, 10);
    }

    for (const [label, buf] of [
      ['ID - front', s.idFrontBuffer],
      ['ID - back', s.idBackBuffer],
    ] as const) {
      if (!buf) continue;
      if (doc.y > PAGE_HEIGHT - MARGIN - 220) doc.addPage();
      subsection(doc, label);
      try {
        doc.image(buf, MARGIN, doc.y, { fit: [CONTENT_WIDTH, 240], align: 'center' });
        doc.y += 248;
      } catch {
        /* best-effort */
      }
      gap(doc, 10);
    }
    return;
  }

  drawMetaGrid(doc, [
    ['SUBMITTED', fmtDateTime(s.createdAt)],
    ['ATTACHMENT', s.evidenceFileName ?? null],
    ['FILE SIZE', s.evidenceFileSize ? formatBytes(s.evidenceFileSize) : null],
  ]);
  gap(doc, 14);

  if (s.testimonialText) {
    subsection(doc, 'Testimonial');
    body(doc, s.testimonialText);
    gap(doc, 16);
  }

  if (s.imageBuffer) {
    try {
      const maxW = CONTENT_WIDTH;
      const availableH = PAGE_HEIGHT - MARGIN - 40 - doc.y;
      const fitH = Math.max(160, Math.min(availableH, 480));
      doc.image(s.imageBuffer, MARGIN, doc.y, { fit: [maxW, fitH], align: 'center' });
    } catch {
      /* best-effort - the metadata above still identifies the file */
    }
  } else if (s.evidenceFileName && s.evidenceFileType === 'application/pdf') {
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor(COLOR.muted)
      .text('PDF attachment - available separately in the case file.', MARGIN, doc.y);
  }
}

// ===========================================================================
// Case Timeline exhibit
// ===========================================================================

/** One catalogued file, authenticated by a SHA-256 digest computed at intake. */
/** One populated worksheet of a spreadsheet, parsed at export time. */
export type ExhibitTab = {
  name: string;
  rows: string[][]; // first row is treated as the header
  totalRows: number;
  totalCols: number;
};

/** A spreadsheet exhibit: EVERY populated worksheet (a workbook often keeps the
 *  actual figures on a later tab than the first), each rendered as its own
 *  table so no data is silently dropped. */
export type ExhibitSheet = {
  tabs: ExhibitTab[];
};

export type ExhibitFile = {
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string; // hex digest (or a short "(unavailable)" note)
  /** Embeddable JPEG/PNG bytes, or null for non-image / unsupported media. */
  image: Buffer | null;
  /** Raw PDF bytes when the file is a PDF (e.g. an emailed statement or a PDF
   *  email), so the exhibit reproduces the document in full, inline, right
   *  after the item that cites it. Null for non-PDF files. */
  pdf?: Buffer | null;
  /** Parsed spreadsheet preview (xlsx/xlsm), rendered inline as a table so the
   *  data itself is on the record. Null for non-spreadsheet files. */
  sheet?: ExhibitSheet | null;
};

/** A profiled individual or entity referenced across the matter. */
export type ExhibitEntity = {
  name: string;
  kind: 'person' | 'organization';
  roleLabel: string;
  aliases: string[];
  notes: string | null;
  /** Reference photo (JPEG/PNG) for identification assistance, or null. */
  photo: Buffer | null;
  /** How many catalogued items reference this entity. */
  appearances: number;
};

/** A selectable section of the exhibit. The cover and the closing
 *  Certification always render; everything else can be included or omitted so
 *  the user can export a single section (e.g. just the timeline, or just the
 *  exhibits) instead of the whole packet. */
export type ExhibitSectionKey =
  | 'overview'
  | 'timeline'
  | 'parties'
  | 'locations'
  | 'exhibits'
  | 'conclusion';

export const ALL_EXHIBIT_SECTIONS: ExhibitSectionKey[] = [
  'overview', 'timeline', 'parties', 'locations', 'exhibits', 'conclusion',
];

/** Human labels for the cover's scope line + the export menu. */
export const EXHIBIT_SECTION_LABEL: Record<ExhibitSectionKey, string> = {
  overview: 'Case summary',
  timeline: 'Timeline of events',
  parties: 'Parties & entities',
  locations: 'Locations of interest',
  exhibits: 'Record of exhibits',
  conclusion: 'Conclusion',
};

export type TimelineExhibitData = {
  caseTitle: string;
  caseRef: string | null;
  subjectName: string | null;
  preparedBy: string | null;
  generatedAt: string; // ISO
  /** Which sections to include. Omitted/empty ⇒ the full packet. The cover and
   *  the closing Certification always render regardless. */
  sections?: ExhibitSectionKey[] | null;
  narrative: { summary: string | null; narrative: string | null; conclusion: string | null } | null;
  /** A structured, court-facing timeline shown up front (e.g. an approach's
   *  supporting timeline). Rendered as a visible "Timeline of events" section
   *  right after the narrative summary. */
  narrativeTimeline?: { when: string; title: string; significance?: string | null }[] | null;
  entities: ExhibitEntity[];
  /** Themed static map of every geocoded location in the case, framed to the
   *  pinged area. Null when no locations resolved or Maps is not configured. */
  caseMap?: { image: Buffer; count: number; places: string[] } | null;
  entries: {
    index: number;
    /** The item's exhibit number label (e.g. "EX-1451"), shown in the Index of
     *  exhibits and beside the item header so every exhibit is citable. */
    exhibitNo?: string | null;
    when: string;
    kind: string;
    title: string;
    context: string | null;
    summary: string | null;
    sourceLabel: string | null;
    people: string[];
    exhibits: ExhibitFile[];
    /** Forensic metadata pulled from the file (EXIF/GPS/device/authoring). */
    coreDetails: { label: string; value: string }[];
  }[];
  /**
   * The naming-convention substitutions that were actually applied to the text
   * of this exhibit. Set by normalizeExhibitData(); it is not something a
   * caller fills in. generateTimelineExhibitPdf() prints it in the
   * Certification section, so a substitution can never reach a filed document
   * without the document saying so.
   */
  normalizations?: NormRule[] | null;
};

/**
 * Apply the matter's naming conventions (e.g. "SH" → "STH") to every piece of
 * DERIVED / narrative text in the exhibit before it is drawn: the narrative,
 * timeline, party profiles, and per-item titles/summaries. Reproduced source
 * files (filenames, embedded images, PDF pages, spreadsheet cells) are left
 * VERBATIM, since the exhibit must reproduce the original evidence unaltered.
 * This is the export-time guarantee that stored text generated before a rule
 * existed still renders in the correct form.
 *
 * The exhibit is offered as a true account of the record, so a substitution
 * that nobody can see is a document-integrity problem, not a convenience. This
 * function therefore records which rules actually changed something and hands
 * that list back on `normalizations`, and the renderer discloses it. The
 * tracking lives here, in the same function that performs the substitution, so
 * the disclosure cannot drift away from what was done.
 */
export function normalizeExhibitData(data: TimelineExhibitData, rules: NormRule[]): TimelineExhibitData {
  if (!rules.length) return data;
  const applied = new Set<number>();
  const s = <T extends string | null | undefined>(t: T): T => {
    if (typeof t !== 'string') return t;
    let out: string = t;
    rules.forEach((rule, i) => {
      const next = normalizeString(out, [rule]);
      if (next !== out) applied.add(i);
      out = next;
    });
    return out as T;
  };
  return {
    ...data,
    caseTitle: s(data.caseTitle),
    subjectName: s(data.subjectName),
    narrative: data.narrative
      ? { summary: s(data.narrative.summary), narrative: s(data.narrative.narrative), conclusion: s(data.narrative.conclusion) }
      : data.narrative,
    narrativeTimeline: data.narrativeTimeline
      ? data.narrativeTimeline.map((t) => ({ when: s(t.when), title: s(t.title), significance: s(t.significance) }))
      : data.narrativeTimeline,
    entities: data.entities.map((e) => {
      // A rule that rewrites the party's name usually rewrites its own alias
      // too ("S.H." and "SH" both become "STH"), and the profile then reads
      // "STH a.k.a. STH" on the page. An alias identical to the name is not an
      // alias, so drop the collapsed duplicates rather than print them.
      const name = s(e.name);
      const seen = new Set<string>([name]);
      const aliases: string[] = [];
      for (const a of e.aliases) {
        const v = s(a);
        if (!v || seen.has(v)) continue;
        seen.add(v);
        aliases.push(v);
      }
      return { ...e, name, roleLabel: s(e.roleLabel), aliases, notes: s(e.notes) };
    }),
    entries: data.entries.map((en) => ({
      ...en,
      title: s(en.title),
      context: s(en.context),
      summary: s(en.summary),
      sourceLabel: s(en.sourceLabel),
      people: en.people.map((p) => s(p)),
      // exhibits (reproduced source files) are left verbatim
    })),
    // Only the rules that changed something are disclosed. A rule that matched
    // nothing produced no substitution in this document, and naming it would
    // describe the exhibit inaccurately.
    normalizations: rules.filter((_, i) => applied.has(i)),
  };
}

const BATES_PREFIX = 'ADV';
const batesLabel = (n: number) => `${BATES_PREFIX}-${String(n).padStart(6, '0')}`;
const humanBytes = (n: number) => {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const BOTTOM = PAGE_HEIGHT - MARGIN - 28;

/** Add a page only if fewer than `needed` points remain, never leaving a blank. */
function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > BOTTOM) doc.addPage();
}

/**
 * Start a major section on a fresh page WITHOUT ever producing a blank one.
 * If the current page already holds content we break; if we're already at the
 * top of an untouched page (e.g. right after an auto-break) we reuse it. This
 * is the fix for "more pages than content": the previous version called
 * doc.addPage() unconditionally before every section, so a section whose prior
 * content happened to end near a page boundary left an empty page behind.
 */
function beginSection(doc: Doc, title: string) {
  if (doc.y > MARGIN + 2) doc.addPage();
  doc.x = MARGIN;
  doc.y = MARGIN;
  section(doc, title);
}

/** A reference profile card: optional photo + name + role + aliases + notes. */
function drawEntityCard(doc: Doc, ent: ExhibitEntity) {
  const cardH = ent.notes ? 96 : 76;
  ensureSpace(doc, cardH + 8);
  const top = doc.y;
  const photoW = 58;
  doc.save().roundedRect(MARGIN, top, CONTENT_WIDTH, cardH, 8)
    .fill('#faf8f2').restore();
  let textX = MARGIN + 14;
  if (ent.photo) {
    try {
      doc.save();
      doc.roundedRect(MARGIN + 12, top + 12, photoW, photoW, 6).clip();
      doc.image(ent.photo, MARGIN + 12, top + 12, { fit: [photoW, photoW], align: 'center', valign: 'center' });
      doc.restore();
      textX = MARGIN + 12 + photoW + 14;
    } catch { doc.restore(); }
  } else {
    doc.save().roundedRect(MARGIN + 12, top + 12, photoW, photoW, 6)
      .fill(COLOR.rule ?? '#e7e2d6').restore();
    doc.font('Helvetica-Bold').fontSize(20).fillColor(COLOR.muted)
      .text((ent.name[0] || '?').toUpperCase(), MARGIN + 12, top + 12 + photoW / 2 - 12, { width: photoW, align: 'center' });
    textX = MARGIN + 12 + photoW + 14;
  }
  const textW = MARGIN + CONTENT_WIDTH - textX - 12;
  // Kind + role, without repeating the kind when the role is just the generic
  // kind label (which produced "ORGANIZATION · ORGANIZATION").
  const kindLabel = ent.kind === 'organization' ? 'ORGANIZATION' : 'PERSON';
  const roleUpper = (ent.roleLabel || '').trim().toUpperCase();
  const eyebrow = roleUpper && roleUpper !== kindLabel ? `${kindLabel} · ${roleUpper}` : kindLabel;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.amber)
    .text(eyebrow, textX, top + 14, { characterSpacing: 1.2, width: textW });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLOR.ink)
    .text(ent.name, textX, top + 26, { width: textW });
  const meta: string[] = [];
  if (ent.aliases.length) meta.push(`a.k.a. ${ent.aliases.join(', ')}`);
  meta.push(`${ent.appearances} appearance${ent.appearances === 1 ? '' : 's'}`);
  doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted)
    .text(meta.join('  ·  '), textX, doc.y + 1, { width: textW });
  if (ent.notes) {
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.inkSoft)
      .text(ent.notes, textX, doc.y + 3, { width: textW, height: 26, ellipsis: true });
  }
  doc.y = top + cardH + 8;
}

/** Embed one image with its authentication caption; paginates as needed. */
function drawExhibitImage(doc: Doc, ex: ExhibitFile) {
  if (!ex.image) return;
  let iw = 0, ih = 0;
  try {
    const im = (doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(ex.image);
    iw = im.width; ih = im.height;
  } catch { return; }
  if (!iw || !ih) return;
  const maxW = CONTENT_WIDTH;
  const capH = 14;
  // Keep the image on the SAME page as the item's summary whenever there is
  // reasonable room: scale it to the space left on the page (down to a floor);
  // only spill to a fresh page when almost nothing is left.
  if (BOTTOM - doc.y - capH - 12 < 150) doc.addPage();
  const avail = BOTTOM - doc.y - capH - 12;
  const maxH = Math.min(360, Math.max(150, avail));
  let w = maxW, h = (w * ih) / iw;
  if (h > maxH) { h = maxH; w = (h * iw) / ih; }
  const x = MARGIN + (CONTENT_WIDTH - w) / 2;
  try {
    doc.save().roundedRect(x, doc.y, w, h, 6).clip();
    doc.image(ex.image, x, doc.y, { width: w, height: h });
    doc.restore();
    doc.save().roundedRect(x, doc.y, w, h, 6).lineWidth(0.5).stroke(COLOR.rule ?? '#e7e2d6').restore();
  } catch { doc.restore(); return; }
  doc.y += h + 4;
  doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.faint)
    .text(`${ex.name}  ·  ${humanBytes(ex.sizeBytes)}  ·  SHA-256 ${ex.sha256.slice(0, 24)}…`, MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
  doc.y += 10;
}

/** A human, court-legible type label for a non-image exhibit file. */
function attachmentKindLabel(ex: ExhibitFile): string {
  const m = (ex.mime || '').toLowerCase();
  const n = (ex.name || '').toLowerCase();
  if (ex.pdf || m.includes('pdf') || n.endsWith('.pdf')) return 'PDF DOCUMENT';
  if (
    m.includes('spreadsheet') || m.includes('excel') || m.includes('csv') ||
    /\.(xlsx|xlsm|xls|csv|numbers|ods)$/.test(n)
  ) return 'SPREADSHEET';
  if (m.startsWith('video/') || /\.(mov|mp4|m4v|avi|mkv|webm)$/.test(n)) return 'VIDEO';
  if (m.startsWith('audio/') || /\.(mp3|m4a|wav|aac)$/.test(n)) return 'AUDIO RECORDING';
  if (m.includes('word') || /\.(docx?|rtf|odt|pages)$/.test(n)) return 'DOCUMENT';
  if (m.includes('message') || /\.(eml|msg)$/.test(n)) return 'EMAIL';
  return 'FILE';
}

/**
 * What this packet is doing with one non-image exhibit, in one sentence.
 *
 * There is no silent branch, and that is the whole point of the function. The
 * card used to take an optional note, and the caller passed null whenever there
 * was nothing to reproduce, so a spreadsheet the packet could not parse got a
 * type chip, a filename and a digest and NOTHING about its contents. A reader
 * could not tell whether the workbook held nothing or whether the document had
 * quietly dropped it, and the same generator, reached through the firm route,
 * printed the figures as a table.
 *
 * tests/export-accounts-for-every-exhibit.test.ts states the rule this closes,
 * from the other generator and the other direction: three PDF exhibits went out
 * promising "Full document follows on the next pages." with nothing following.
 * Include it, or name it and say why. Never silence.
 *
 * The register is neutral and the vocabulary is a court's, not a product's: no
 * prompt text, no AI attribution, no product name. The reader of this line is
 * often the person whose evidence it is.
 */
export function exhibitContentNote(ex: ExhibitFile): string {
  if (ex.pdf) return 'reproduced in full on the pages that follow';
  if (ex.sheet?.tabs?.length) return 'contents shown below';
  // A digest the generator could not compute is a file it never held. Saying
  // "not reproduced" alone would imply a choice was made about contents nobody
  // ever read, so the two cases are named separately.
  if (!/^[0-9a-f]{64}$/i.test(ex.sha256)) {
    return 'file not retrieved for this packet, so its contents are not reproduced here';
  }
  return 'contents not reproduced here; the original file is unchanged in the case record';
}

/**
 * A prominent, authenticated exhibit card for a non-image file (PDF, spreadsheet,
 * document, video). A type chip, the filename, and a verification line (MIME ·
 * size · SHA-256), plus the note saying what became of its contents.
 */
function drawAttachmentCard(doc: Doc, ex: ExhibitFile, note?: string | null) {
  // THE NOTE GETS ITS OWN ROW, and this is not a preference. It used to be
  // appended to the verification line, and rendering a packet showed why that
  // could not hold: a spreadsheet MIME is 66 characters before the digest is
  // even reached, so the combined line ran past the card and the sentence
  // saying what became of the file wrapped OUTSIDE the box it belonged to.
  // No assertion in the suite could see it; the rendered page could.
  const cardH = note ? 66 : 52;
  if (doc.y + cardH + 8 > BOTTOM) doc.addPage();
  const top = doc.y;
  doc.save()
    .roundedRect(MARGIN, top, CONTENT_WIDTH, cardH, 8)
    .fillAndStroke(COLOR.tint, COLOR.rule)
    .restore();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.amber)
    .text(attachmentKindLabel(ex), MARGIN + 14, top + 11, { characterSpacing: 1.1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.ink)
    .text(ex.name, MARGIN + 14, top + 21, { width: CONTENT_WIDTH - 28, lineBreak: false, ellipsis: true });
  const meta = `${ex.mime || 'file'}  ·  ${humanBytes(ex.sizeBytes)}  ·  SHA-256 ${ex.sha256.slice(0, 24)}`;
  doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
    .text(meta, MARGIN + 14, top + 36, { width: CONTENT_WIDTH - 28, lineBreak: false, ellipsis: true });
  if (note) {
    // Darker than the verification line above it. This sentence is what the
    // reader needs in order to know whether the file's contents are in this
    // document, so it is not a footnote to the digest.
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.inkSoft)
      .text(note, MARGIN + 14, top + 49, { width: CONTENT_WIDTH - 28, lineBreak: false, ellipsis: true });
  }
  doc.y = top + cardH + 8;
}

/**
 * Render a spreadsheet's parsed contents as a table, inline, so the data is on
 * the record rather than merely referenced. The table SPANS PAGES: when it fills
 * the page it continues on the next one, repeating the header row so every page
 * is readable on its own. Column rules are drawn per page-segment so they stay
 * aligned across the break.
 */
function drawSheetTable(doc: Doc, sheet: ExhibitSheet) {
  const tabs = sheet.tabs.filter((t) => t.rows.length);
  if (!tabs.length) return;
  const multi = tabs.length > 1;
  tabs.forEach((tab, ti) => {
    if (ti > 0) gap(doc, 12);
    drawSheetTab(doc, tab, multi);
  });
}

/** Render one worksheet as a page-spanning table (header repeated per page). */
function drawSheetTab(doc: Doc, tab: ExhibitTab, labelAsTab: boolean) {
  if (!tab.rows.length) return;
  const cols = Math.max(1, Math.min(tab.rows[0].length || 1, 8));
  const colW = CONTENT_WIDTH / cols;
  const rowH = 15;
  const shown = tab.rows.length;
  const header = tab.rows[0];
  const rowsNote = tab.totalRows > shown ? `  (${shown} of ${tab.totalRows} rows)` : '';
  const caption = (labelAsTab ? `TAB "${tab.name}"` : `SPREADSHEET CONTENT: ${tab.name}`) + rowsNote;

  const drawCaption = (cont: boolean) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLOR.muted)
      .text(caption + (cont ? '  (continued)' : ''), MARGIN, doc.y, { characterSpacing: 1, width: CONTENT_WIDTH });
    gap(doc, 5);
  };
  const drawRow = (row: string[], y: number, isHeader: boolean) => {
    if (isHeader) doc.save().rect(MARGIN, y, CONTENT_WIDTH, rowH).fill(COLOR.tint).restore();
    for (let c = 0; c < cols; c++) {
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
        .fillColor(isHeader ? COLOR.ink : COLOR.inkSoft)
        .text((row[c] ?? '').toString(), MARGIN + c * colW + 3, y + 4, { width: colW - 6, height: rowH - 5, ellipsis: true, lineBreak: false });
    }
    doc.save().strokeColor(COLOR.rule).lineWidth(0.4)
      .moveTo(MARGIN, y + rowH).lineTo(MARGIN + CONTENT_WIDTH, y + rowH).stroke().restore();
  };
  // Vertical column rules + top border for one page-segment (segTop..segBot).
  const closeSegment = (segTop: number, segBot: number) => {
    doc.save().strokeColor(COLOR.rule).lineWidth(0.4);
    for (let c = 0; c <= cols; c++) doc.moveTo(MARGIN + c * colW, segTop).lineTo(MARGIN + c * colW, segBot).stroke();
    doc.moveTo(MARGIN, segTop).lineTo(MARGIN + CONTENT_WIDTH, segTop).stroke();
    doc.restore();
  };

  // Start the table; if barely any room remains, begin on a fresh page.
  if (BOTTOM - doc.y < 22 + rowH * 3) doc.addPage();
  drawCaption(false);
  let segTop = doc.y;
  let y = doc.y;
  drawRow(header, y, true);
  y += rowH;

  for (let i = 1; i < tab.rows.length; i++) {
    if (y + rowH > BOTTOM) {
      closeSegment(segTop, y);      // finish this page's grid
      doc.addPage();
      drawCaption(true);
      segTop = doc.y;
      y = doc.y;
      drawRow(header, y, true);     // repeat the header on the new page
      y += rowH;
    }
    drawRow(tab.rows[i], y, false);
    y += rowH;
  }
  closeSegment(segTop, y);
  doc.y = y + 8;
}

/**
 * Finalize the exhibit: interleave each PDF's real pages IN FULL immediately
 * after the item that cites it (so the document itself carries the evidence,
 * not a distant appendix), then stamp a continuous page-number / matter / Bates
 * footer onto every page in the final order. Uses pdf-lib because PDFKit can't
 * import external PDFs. Fail-safe throughout: an encrypted or corrupt PDF is
 * skipped (its item still carries the authenticated card), and any load/save
 * failure returns the pdfkit document unchanged. Honors the per-document and
 * per-packet page caps.
 *
 * `inserts[i].afterPage` is the 1-based pdfkit page number after which that
 * PDF's pages belong (captured when the item finished drawing).
 */
async function finalizeExhibit(
  pdfkitBuffer: Buffer,
  inserts: { afterPage: number; name: string; label: string; buf: Buffer }[],
  caseTitle: string,
  index?: {
    refs: { itemIndex: number; page: number; topY: number }[];
    itemPages: Map<number, number>;
    colRight: number;
  },
): Promise<Buffer> {
  let out: PdfLibDoc;
  try {
    out = await PdfLibDoc.load(pdfkitBuffer, { ignoreEncryption: true });
  } catch {
    return pdfkitBuffer;
  }

  // One entry per interleaved PDF page, holding the pdfkit page it was inserted
  // after. Lets us map an item's pdfkit page → its final (post-splice) page for
  // the Index of exhibits references.
  const insertOffsets: number[] = [];

  // Interleave, ascending by target position. Each page inserted before a later
  // target shifts that target's index, so we track a running offset.
  //
  // Each source page is EMBEDDED onto a fresh Letter page, scaled to fit inside
  // a content box that reserves a bottom margin for the Bates footer (and a top
  // margin), then framed with a hairline. This is what keeps the reproduced
  // document from running edge-to-edge into the footer, and normalizes every
  // reproduced page to the exhibit's own Letter geometry so it paginates
  // uniformly, instead of copying source pages verbatim (which collided with
  // the footer and could be any size).
  const TOP_RESERVE = 30;   // clean margin above the reproduced page
  const BOT_RESERVE = 42;   // clean band below it for the footer
  const SIDE = 44;
  const ordered = [...inserts].sort((a, b) => a.afterPage - b.afterPage);
  let insertedSoFar = 0;
  for (const ins of ordered) {
    if (out.getPageCount() >= MAX_PACKET_PAGES) break;
    try {
      const src = await PdfLibDoc.load(ins.buf, { ignoreEncryption: true });
      const total = src.getPageCount();
      const budget = Math.min(MAX_PDF_EXHIBIT_PAGES, MAX_PACKET_PAGES - out.getPageCount());
      const idxs: number[] = [];
      for (let i = 0; i < total && idxs.length < budget; i++) {
        if (!isPageLikelyBlank(src.getPage(i))) idxs.push(i);
      }
      if (!idxs.length) continue;
      const embedded = await out.embedPages(idxs.map((i) => src.getPage(i)));
      let at = ins.afterPage + insertedSoFar; // 0-based index just after the item
      for (const emb of embedded) {
        const page = out.insertPage(at, [PAGE_WIDTH, PAGE_HEIGHT]);
        const availW = PAGE_WIDTH - SIDE * 2;
        const availH = PAGE_HEIGHT - TOP_RESERVE - BOT_RESERVE;
        const scale = Math.min(availW / emb.width, availH / emb.height, 1);
        const w = emb.width * scale;
        const h = emb.height * scale;
        const x = (PAGE_WIDTH - w) / 2;
        const y = PAGE_HEIGHT - TOP_RESERVE - h; // top-aligned under the top margin
        page.drawPage(emb, { x, y, width: w, height: h });
        page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.85, 0.85, 0.87), borderWidth: 0.5 });
        insertOffsets.push(ins.afterPage);
        at += 1;
        insertedSoFar += 1;
      }
    } catch {
      // Encrypted / corrupt PDF: skip; the item still carries its card.
    }
  }

  // Stamp the running footer onto EVERY page in final order (pdfkit pages and
  // interleaved PDF pages alike), so numbering is continuous regardless of how
  // the documents were merged. (pdfkit no longer draws its own footer.)
  try {
    const font = await out.embedFont(StandardFonts.Helvetica);
    const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
    const muted = rgb(0.44, 0.44, 0.47);
    const ink = rgb(0.094, 0.094, 0.106);
    const ruleC = rgb(0.894, 0.894, 0.906);
    const title = truncate(caseTitle, 40);
    out.getPages().forEach((page, i) => {
      try {
        const { width } = page.getSize();
        const pageNo = i + 1;
        const bates = batesLabel(pageNo);
        const y = 22;
        // Soften the band behind the footer so it stays legible over dense page
        // content, without fully erasing anything beneath it.
        page.drawRectangle({ x: 0, y: 0, width, height: 30, color: rgb(1, 1, 1), opacity: 0.72 });
        page.drawLine({ start: { x: MARGIN, y: y + 12 }, end: { x: width - MARGIN, y: y + 12 }, thickness: 0.5, color: ruleC });
        page.drawText(`Page ${pageNo}`, { x: MARGIN, y, size: 8, font, color: muted });
        const tW = font.widthOfTextAtSize(title, 8);
        page.drawText(title, { x: (width - tW) / 2, y, size: 8, font, color: muted });
        const bW = fontBold.widthOfTextAtSize(bates, 8);
        page.drawText(bates, { x: width - MARGIN - bW, y, size: 8, font: fontBold, color: ink });
      } catch {
        // A malformed page geometry shouldn't abort the whole export.
      }
    });

    // Stamp the resolved Bates page onto each Index of exhibits row. An item's
    // final page = its pdfkit page + the count of PDF pages spliced in BEFORE
    // it. Index rows are front matter (before any item), so their own page is
    // unshifted: ref.page is already the final page they live on.
    if (index?.refs.length) {
      const finalPageOf = (p: number) => p + insertOffsets.filter((a) => a < p).length;
      const size = 8.5;
      const ascent = size * 0.72; // top-anchored pdfkit y → pdf-lib baseline
      for (const ref of index.refs) {
        try {
          const itemPage = index.itemPages.get(ref.itemIndex);
          if (itemPage == null) continue;
          const page = out.getPage(ref.page - 1);
          const bates = batesLabel(finalPageOf(itemPage));
          const w = fontBold.widthOfTextAtSize(bates, size);
          const yy = page.getSize().height - ref.topY - ascent;
          page.drawText(bates, { x: index.colRight - w, y: yy, size, font: fontBold, color: ink });
        } catch {
          // Skip a single unresolved row rather than abort the index.
        }
      }
    }
  } catch {
    // Font embed failed: return the merged (unstamped) document rather than nothing.
  }

  try {
    return Buffer.from(await out.save());
  } catch {
    return pdfkitBuffer;
  }
}

/**
 * Court-ready evidentiary exhibit, laid out as one planned document:
 *   Cover → Overview (narrative) → Timeline of events → Parties & entities →
 *   Locations → Record of exhibits (one dated item per page, with embedded
 *   evidence images, inline spreadsheet tables, and each PDF reproduced in
 *   full on the pages that immediately follow its item) → Conclusion →
 *   Certification & authentication. Each major section opens on its own page
 *   and every page carries a Bates-style identifier. Reuses the shared
 *   section/body/drawMetaGrid typography.
 */
export async function generateTimelineExhibitPdf(input: TimelineExhibitData): Promise<Buffer> {
  const logoBuffer = await loadLogoBuffer();
  const totalExhibits = input.entries.reduce((n, e) => n + e.exhibits.length, 0);
  const prepared = new Date(input.generatedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZE,
        margin: MARGIN,
        autoFirstPage: true,
        info: {
          Title: `${input.caseTitle}: Timeline exhibit`,
          Author: input.preparedBy || 'Confidential work product',
          Subject: 'Case timeline evidentiary exhibit',
        },
      });
      const chunks: Buffer[] = [];
      // Each PDF exhibit is reproduced IN FULL, inline, right after the item
      // that cites it. We record the running pdfkit page number the item ends
      // on, then finalizeExhibit() splices the PDF's pages in at that position
      // and stamps a continuous footer across the whole document.
      const pdfInserts: { afterPage: number; name: string; label: string; buf: Buffer }[] = [];
      // Index of exhibits: rows drawn during layout with the PAGE cell left
      // blank; the resolved Bates page is stamped onto each row in the same
      // post-pass that numbers the footers (final pages aren't known until the
      // PDF interleave is done). `itemPages` maps item index → its pdfkit page.
      const indexRefs: { itemIndex: number; page: number; topY: number }[] = [];
      const itemPages = new Map<number, number>();
      const indexPageColRight = PAGE_WIDTH - MARGIN;
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => {
        const base = Buffer.concat(chunks);
        finalizeExhibit(base, pdfInserts, input.caseTitle, { refs: indexRefs, itemPages, colRight: indexPageColRight })
          .then(resolve)
          .catch(() => resolve(base)); // fail-safe: still return the exhibit
      });
      doc.on('error', reject);

      // Running count of pdfkit pages. The footer is NOT drawn here; every page
      // (pdfkit pages and the interleaved PDF pages) is stamped uniformly in the
      // finalizeExhibit() post-pass, so numbering stays continuous after splice.
      let pageCount = 1; // page 1 already exists (autoFirstPage)
      doc.on('pageAdded', () => { pageCount += 1; });

      // Section selection: omitted/empty ⇒ full packet. The cover + closing
      // Certification always render. `scopeLabel` names the scope on the cover
      // when the user exported a subset.
      const picked = input.sections && input.sections.length ? input.sections : null;
      const want = (k: ExhibitSectionKey) => !picked || picked.includes(k);
      // A pure exhibits pull (the evidence page's "One document" export) is a
      // hand-over artifact, not a briefing: Cover -> Index -> Certification ->
      // the exhibits, and nothing else. The certification moves UP so all the
      // prose sits before the record.
      const exhibitsOnly = picked?.length === 1 && picked[0] === 'exhibits';
      const drawCertification = () => {
        beginSection(doc, 'Certification & authentication');
        body(doc, `This exhibit was assembled from ${input.entries.length} catalogued item(s) and ${totalExhibits} source file(s) submitted in connection with the above matter, and was prepared using counsel case-management software. Each file reproduced or referenced herein is identified by its original filename, media type, byte size, and a SHA-256 cryptographic digest computed at the time of intake. A digest that matches the original file establishes that the file has not been altered since it was catalogued.`);
        gap(doc, 8);
        body(doc, 'Items are numbered sequentially and every page carries a unique Bates-style identifier. Any description, transcription, or observation provided as a summary is included for organisational assistance only, and must be independently verified by counsel.');
        // A reader must be able to establish what this document says about
        // itself. Where the matter's naming conventions rewrote wording, the
        // exhibit states the substitutions it contains, so nothing is changed
        // silently on a record offered as a true account.
        const subs = input.normalizations ?? [];
        if (subs.length) {
          gap(doc, 8);
          const list = subs.map((r) => `"${r.from}" is written as "${r.to}"`).join('; ');
          body(doc, `Naming conventions. This matter records substitutions that are applied to the descriptive text of this exhibit so terminology stays consistent across the record: ${list}. The substitutions apply only to the descriptions, summaries, party details and narrative written in this exhibit. Source files reproduced or referenced herein, including their filenames and their SHA-256 digests, are unaltered.`);
        }
        gap(doc, 18);
        doc.save().moveTo(MARGIN, doc.y).lineTo(MARGIN + 56, doc.y).lineWidth(2.5).stroke(COLOR.amber).restore();
        gap(doc, 12);
        const line = input.preparedBy
          ? `Prepared exclusively for ${input.preparedBy}. Confidential attorney work product. Not for distribution.`
          : 'Confidential attorney work product. Not for distribution.';
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLOR.muted)
          .text(line.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.8, width: CONTENT_WIDTH });
      };
      const scopeLabel = picked
        ? picked.length === 1
          ? EXHIBIT_SECTION_LABEL[picked[0]]
          : picked.map((k) => EXHIBIT_SECTION_LABEL[k]).join('  ·  ')
        : null;

      // ── COVER
      if (logoBuffer) { try { doc.image(logoBuffer, MARGIN, MARGIN, { width: 34 }); } catch { /* ignore */ } }
      doc.y = MARGIN + 64;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.muted)
        .text('EVIDENTIARY TIMELINE EXHIBIT', MARGIN, doc.y, { characterSpacing: 2 });
      gap(doc, 10);
      doc.font('Helvetica-Bold').fontSize(26).fillColor(COLOR.ink)
        .text(input.caseTitle, MARGIN, doc.y, { width: CONTENT_WIDTH });
      gap(doc, 18);
      drawMetaGrid(doc, [
        ['MATTER / SUBJECT', input.subjectName],
        ['CASE REFERENCE', input.caseRef],
        ['PREPARED', prepared],
        ['PREPARED BY', input.preparedBy],
        ['ENTRIES', String(input.entries.length)],
        ['EXHIBITS', String(totalExhibits)],
      ]);
      gap(doc, 16);
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR.muted).text(
        'A factual chronology of the materials catalogued in connection with this matter. Each exhibit is authenticated by a SHA-256 digest recorded at intake, and every page carries a unique Bates-style identifier.',
        MARGIN, doc.y, { width: CONTENT_WIDTH },
      );
      // When a subset was exported, name the scope on the cover so the reader
      // knows this is one section of the matter, not the whole packet.
      if (scopeLabel) {
        gap(doc, 14);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted)
          .text('SCOPE OF THIS EXPORT', MARGIN, doc.y, { characterSpacing: 1.6 });
        gap(doc, 3);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.amber)
          .text(scopeLabel, MARGIN, doc.y, { width: CONTENT_WIDTH });
      }
      // Branded confidentiality band, anchored toward the foot of the cover so
      // the page reads as a finished, premium work-product cover rather than a
      // half-empty sheet. Gold accent rule + firm attribution + status line.
      {
        const bandY = Math.max(doc.y + 40, BOTTOM - 96);
        doc.save().moveTo(MARGIN, bandY).lineTo(MARGIN + 56, bandY)
          .lineWidth(2.5).stroke(COLOR.amber).restore();
        const firmLine = input.preparedBy
          ? `PREPARED EXCLUSIVELY FOR ${input.preparedBy.toUpperCase()}`
          : 'CONFIDENTIAL ATTORNEY WORK PRODUCT';
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.ink)
          .text(firmLine, MARGIN, bandY + 12, { characterSpacing: 1.4, width: CONTENT_WIDTH });
        doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted)
          .text('CONFIDENTIAL ATTORNEY WORK PRODUCT  ·  NOT FOR DISTRIBUTION', MARGIN, bandY + 26, { characterSpacing: 1.2, width: CONTENT_WIDTH });
      }

      // The exhibit reads as one planned document, front to back:
      //   Cover → Index of exhibits → Overview → Timeline → Parties → Locations
      //   → detailed Record of exhibits → Conclusion → Certification. Each major
      //   section begins on its own page (beginSection).

      // ── INDEX OF EXHIBITS (front matter for quick referencing). Each item is
      //   listed with its date, description, and the page it appears on. The
      //   PAGE cell is left blank here and stamped with the resolved Bates page
      //   in finalizeExhibit (final pages aren't known until PDF interleave).
      if (want('exhibits') && input.entries.length) {
        beginSection(doc, 'Index of exhibits');
        body(doc, 'Every catalogued item and the page on which it appears in this exhibit.');
        gap(doc, 12);
        const IROW = 16;
        const ITEM_X = MARGIN;
        const EXH_X = MARGIN + 40;
        const DESC_X = MARGIN + 108;
        const PAGE_LABEL_X = PAGE_WIDTH - MARGIN - 66;
        const descW = PAGE_LABEL_X - DESC_X - 8;
        let ry = doc.y;
        const idxRow = (num: string, exh: string, desc: string, head: boolean): number => {
          if (ry + IROW > BOTTOM) { doc.addPage(); ry = doc.y; }
          doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(head ? 8 : 8.5)
            .fillColor(head ? COLOR.muted : COLOR.ink);
          const one = { height: 11, lineBreak: false as const, ellipsis: true as const };
          doc.text(num, ITEM_X, ry + 3, { width: EXH_X - ITEM_X - 4, ...one, characterSpacing: head ? 1 : 0 });
          if (!head) doc.font('Helvetica-Bold').fillColor(COLOR.amber);
          doc.text(exh, EXH_X, ry + 3, { width: DESC_X - EXH_X - 6, ...one, characterSpacing: head ? 1 : 0.3 });
          doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fillColor(head ? COLOR.muted : COLOR.ink);
          doc.text(desc.length > 110 ? desc.slice(0, 109) + '…' : desc, DESC_X, ry + 3, { width: descW, ...one, characterSpacing: head ? 1 : 0 });
          if (head) doc.text('PAGE', PAGE_LABEL_X, ry + 3, { width: 66, align: 'right', lineBreak: false, characterSpacing: 1 });
          doc.save().strokeColor(COLOR.rule).lineWidth(0.3)
            .moveTo(MARGIN, ry + IROW).lineTo(PAGE_WIDTH - MARGIN, ry + IROW).stroke().restore();
          const rowTop = ry + 3;
          ry += IROW;
          return rowTop;
        };
        idxRow('ITEM', 'EXHIBIT', 'DESCRIPTION', true);
        for (const e of input.entries) {
          const topY = idxRow(String(e.index), e.exhibitNo || 'Not assigned', e.title || '(untitled item)', false);
          indexRefs.push({ itemIndex: e.index, page: pageCount, topY });
        }
        doc.y = ry + 4;
      }

      // Exhibits-only: certification comes right after the index, so the
      // record that follows is uninterrupted evidence.
      if (exhibitsOnly) drawCertification();

      // ── 1. OVERVIEW (narrative summary opens the document, court-ready)
      if (want('overview') && (input.narrative?.summary || input.narrative?.narrative)) {
        beginSection(doc, 'Overview');
        if (input.narrative.summary) body(doc, input.narrative.summary);
        if (input.narrative.narrative) {
          gap(doc, 14);
          subsection(doc, 'Statement of facts');
          body(doc, input.narrative.narrative);
        }
      }

      // ── 2. TIMELINE OF EVENTS (structured, at-a-glance chronology)
      if (want('timeline') && input.narrativeTimeline && input.narrativeTimeline.length) {
        beginSection(doc, 'Timeline of events');
        body(doc, 'A chronological overview of the key events in this matter. The full supporting record for each event appears in the Record of exhibits that follows.');
        gap(doc, 14);
        for (const t of input.narrativeTimeline) {
          ensureSpace(doc, 44);
          doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.amber)
            .text(t.when || '', MARGIN, doc.y, { characterSpacing: 0.5, width: CONTENT_WIDTH });
          gap(doc, 2);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.ink)
            .text(t.title || '(event)', MARGIN, doc.y, { width: CONTENT_WIDTH });
          if (t.significance) {
            gap(doc, 2);
            body(doc, t.significance);
          }
          gap(doc, 12);
        }
      }

      // ── 3. LOCATIONS (map of everywhere the evidence resolves to)
      if (want('locations') && input.caseMap?.image) {
        beginSection(doc, 'Locations of interest');
        body(doc, `Every location resolved from the catalogued evidence, plotted below. ${input.caseMap.count} location${input.caseMap.count === 1 ? '' : 's'} mapped. Coordinates are derived from embedded file GPS or from places named in the content, and are provided for orientation only.`);
        gap(doc, 14);
        try {
          const im = (doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(input.caseMap.image);
          const iw = im.width || 640, ih = im.height || 360;
          let w = CONTENT_WIDTH, h = (w * ih) / iw;
          if (h > 380) { h = 380; w = (h * iw) / ih; }
          if (doc.y + h + 10 > BOTTOM) doc.addPage();
          const x = MARGIN + (CONTENT_WIDTH - w) / 2;
          doc.save().roundedRect(x, doc.y, w, h, 6).clip();
          doc.image(input.caseMap.image, x, doc.y, { width: w, height: h });
          doc.restore();
          doc.save().roundedRect(x, doc.y, w, h, 6).lineWidth(0.5).stroke(COLOR.rule ?? '#e7e2d6').restore();
          doc.y += h + 8;
        } catch { /* map image is best-effort */ }
        if (input.caseMap.places.length) {
          doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.faint)
            .text(input.caseMap.places.join('  ·  '), MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
          doc.y += 10;
        }
      }

      // ── 5. RECORD OF EXHIBITS (the detailed, dated record: one item per page,
      //    with embedded evidence images and authenticated attachment cards)
      if (want('exhibits')) {
      beginSection(doc, 'Record of exhibits');
      body(doc, 'The dated record of every catalogued item. Each item is numbered, its supporting files are embedded or reproduced, and every file carries a SHA-256 digest recorded at intake.');
      gap(doc, 6);
      for (const e of input.entries) {
        // One item per page: each entry starts on its own fresh page so the
        // record reads as a clean, uniform sequence of exhibits.
        doc.addPage();
        itemPages.set(e.index, pageCount); // for the Index of exhibits page refs
        // Item number + exhibit number + date, so every exhibit is citable in place.
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.amber)
          .text(
            `ITEM ${e.index}${e.exhibitNo ? `  ·  ${e.exhibitNo}` : ''}  ·  ${e.when}`,
            MARGIN, doc.y, { characterSpacing: 0.8 },
          );
        gap(doc, 3);
        // Title.
        doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR.ink)
          .text(e.title || '(untitled item)', MARGIN, doc.y, { width: CONTENT_WIDTH });
        gap(doc, 3);
        // Kind / source / people metadata line, above a hairline that separates
        // the header from the body so each item reads as a self-contained card.
        const metaBits = [e.kind];
        if (e.sourceLabel) metaBits.push(`Source: ${e.sourceLabel}`);
        if (e.people.length) metaBits.push(`People: ${e.people.join(', ')}`);
        doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.muted)
          .text(metaBits.join('  ·  '), MARGIN, doc.y, { width: CONTENT_WIDTH });
        gap(doc, 8);
        doc.save().strokeColor(COLOR.rule).lineWidth(0.5)
          .moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).stroke().restore();
        gap(doc, 12);
        if (e.context) { body(doc, e.context); gap(doc, 4); }
        if (e.summary) {
          gap(doc, 4);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(COLOR.muted)
            .text('SUMMARY', MARGIN, doc.y, { characterSpacing: 1.4 });
          gap(doc, 3);
          body(doc, e.summary);
        }
        // Embedded evidence images + authentication captions.
        if (e.exhibits.some((x) => x.image)) {
          gap(doc, 10);
          for (const ex of e.exhibits) drawExhibitImage(doc, ex);
        }
        // Non-image files: each gets an authenticated card, and its CONTENT is
        // put on the record: spreadsheets as an inline table, PDFs reproduced
        // in full on the pages that immediately follow this item.
        const nonImg = e.exhibits.filter((x) => !x.image);
        if (nonImg.length) {
          gap(doc, 10);
          for (const ex of nonImg) {
            // Composed by exhibitContentNote rather than here, because the
            // branch that used to produce `null` is the defect: a file with
            // nothing to reproduce got a card that said nothing about it.
            drawAttachmentCard(doc, ex, exhibitContentNote(ex));
            if (ex.sheet) { gap(doc, 6); drawSheetTable(doc, ex.sheet); }
          }
        }
        // Record where this item's PDF pages should be spliced in: right after
        // the last page the item occupies. Captured after all inline drawing so
        // any overflow pages are counted.
        const itemPdfs = e.exhibits.filter((x) => x.pdf);
        if (itemPdfs.length) {
          const afterPage = pageCount;
          for (const ex of itemPdfs) {
            pdfInserts.push({ afterPage, name: ex.name, label: `Item ${e.index}`, buf: ex.pdf as Buffer });
          }
        }
      }
      } // end want('exhibits')

      // ── 6. CONCLUSION
      if (want('conclusion') && input.narrative?.conclusion) {
        beginSection(doc, 'Conclusion');
        body(doc, input.narrative.conclusion);
      }

      // ── 7. PARTIES (persons & organizations of interest). Placed as the last
      //    content section, a reference "cast of characters" a reader consults
      //    after the record, rather than an interruption near the front.
      if (want('parties') && input.entities.length) {
        beginSection(doc, 'Parties & entities');
        body(doc, 'Reference profiles for the individuals and entities named in this matter. Any reference image assists identification only and is not a biometric determination.');
        gap(doc, 14);
        for (const ent of input.entities) drawEntityCard(doc, ent);
      }

      // ── 8. CERTIFICATION & AUTHENTICATION (closing attestation), included in full
      //    packets. Exhibits-only packets drew it right after the index.
      if (!exhibitsOnly) drawCertification();

      // PDF exhibits are spliced in inline (right after their item) by
      // finalizeExhibit once the pdfkit document is finished, with no end appendix.
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Timeline PDF generation failed.'));
    }
  });
}

