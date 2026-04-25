import PDFDocument from 'pdfkit';
import type {
  AIReview,
  Case,
  Exhibit,
  Profile,
} from './types';
import { getExhibitFileBuffer } from './storage';

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
}): Promise<Buffer> {
  // Load image buffers up front so the stream can write them synchronously
  // later. Only grab files we can actually render; skip oversized / unreadable.
  const exhibitImages = new Map<string, Buffer>();
  const MAX_EMBED_BYTES = 20 * 1024 * 1024;
  for (const e of input.exhibits) {
    if (!isSupportedImage(e)) continue;
    if (e.fileSize > MAX_EMBED_BYTES) continue;
    const buf = await getExhibitFileBuffer(e).catch(() => null);
    if (buf) exhibitImages.set(e.id, buf);
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
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      writePdf(doc, input, exhibitImages);

      // Page numbers (skip cover)
      const range = doc.bufferedPageRange();
      for (let i = 1; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(doc, i, range.count - 1, input.caseRecord.title);
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
  },
  exhibitImages: Map<string, Buffer>,
) {
  const { caseRecord, exhibits, review, profile, clientName } = input;

  drawCoverPage(doc, caseRecord, { profile, clientName });

  // Case information page
  doc.addPage();
  drawCaseInformation(doc, caseRecord);

  // Case review
  if (review) {
    doc.addPage();
    drawReview(doc, review);
  }

  // Exhibits
  if (exhibits.length > 0) {
    doc.addPage();
    drawExhibitIndex(doc, exhibits);
    for (const e of exhibits) {
      doc.addPage();
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
  extras: { profile?: Profile | null; clientName?: string | null },
) {
  const jurisdiction = joinJurisdiction(c);

  // Subtle side rule
  doc.save();
  doc.fillColor(COLOR.accent).rect(MARGIN, MARGIN, 2, PAGE_HEIGHT - MARGIN * 2).fill();
  doc.restore();

  const x = MARGIN + 18;
  let y = MARGIN + 6;

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

  list(doc, 'Timeline', review.timeline);
  list(doc, 'Key facts', review.keyFacts);
  list(doc, 'Possible legal issues', review.possibleIssues);
  list(doc, 'Applicable legal doctrines', review.applicableLegalReferences ?? []);

  gap(doc, 8);
  subsection(doc, 'Evidence & discovery');
  list(doc, 'Evidence to strengthen the case', review.evidenceToStrengthen ?? []);
  list(doc, 'Possible subpoena / records targets', review.subpoenaTargets ?? []);

  gap(doc, 8);
  list(doc, 'Evidence mapping to exhibits', review.evidenceMapping);
  list(doc, 'Missing information', review.missingInformation);
  list(doc, 'Suggested next steps', review.suggestedNextSteps);
  list(doc, 'Questions to ask an attorney', review.questionsForAttorney);

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
  } else {
    drawAttachmentPlaceholder(doc, e);
  }
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
      'Advottic provides legal information, case organization tools, document summaries, and Legal Eye (AI-assisted) issue spotting. Advottic does not provide legal advice, does not represent users, and does not create an attorney-client relationship.',
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
