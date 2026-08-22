/**
 * How one exhibit gets read, decided in one place.
 *
 * The same question was being answered twice with two different answers: the
 * server action asked whether a file was an image or a PDF, and the exhibit
 * row in the UI asked again with its own copy of the rule. When spreadsheets
 * became readable, one of those two would have been left behind and the
 * person would have been shown either a button that refuses or no button at
 * all. Both now call this.
 *
 * Pure. No I/O, no imports, testable on its own.
 */

export type ExhibitReadRoute =
  /** Bytes go to the vision model. Images and PDFs. */
  | { kind: 'vision'; mediaType: string }
  /** Text is pulled out first, then analysed. Spreadsheets and Word files. */
  | { kind: 'extract'; format: 'spreadsheet' | 'word'; label: string }
  /** Audio and video. Handled by Transcribe, not by Scan. */
  | { kind: 'transcribe' }
  /** Genuinely cannot be read. `reason` is written to be read by a person. */
  | { kind: 'unsupported'; reason: string };

/**
 * The one sentence that says what Scan can read.
 *
 * IT MUST STAY TRUE. Anything named here has to work end to end, because a
 * person deciding whether to re-export a file is acting on this list. Legacy
 * .xls, .doc and OpenDocument are deliberately absent: this codebase does not
 * read them, and lib/doc-review.ts refuses them for the same reason.
 */
export const SCAN_SUPPORTED_SENTENCE =
  'Scan can read PDFs, images (PNG, JPEG, WEBP, GIF), Excel workbooks saved as .xlsx, and Word documents saved as .docx.';

/** Legacy Office formats this codebase does not parse. */
const LEGACY_OFFICE =
  'Older Office files (.xls, .doc) and OpenDocument files (.ods, .odt) cannot be read automatically. Please open the file, save it again as .xlsx, .docx or PDF, and re-upload it.';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroenabled.12';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Decide how to read one exhibit.
 *
 * Both the declared MIME type and the file name are consulted, because some
 * browsers upload with no content type at all and the exhibits already in
 * storage carry whatever was recorded at the time.
 */
export function classifyExhibitForReading(exhibit: {
  fileName?: string | null;
  fileType?: string | null;
}): ExhibitReadRoute {
  const name = (exhibit.fileName ?? '').toLowerCase();
  const type = (exhibit.fileType ?? '').toLowerCase();

  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return { kind: 'vision', mediaType: 'application/pdf' };
  }

  if (/\.png$/.test(name)) return { kind: 'vision', mediaType: 'image/png' };
  if (/\.jpe?g$/.test(name)) return { kind: 'vision', mediaType: 'image/jpeg' };
  if (/\.webp$/.test(name)) return { kind: 'vision', mediaType: 'image/webp' };
  if (/\.gif$/.test(name)) return { kind: 'vision', mediaType: 'image/gif' };
  if (type.startsWith('image/')) {
    // A declared image type with an unfamiliar extension. Pass the declared
    // type through only when the vision API accepts it, otherwise read it as
    // PNG, which is what this path did before.
    const known = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    return { kind: 'vision', mediaType: known.includes(type) ? type : 'image/png' };
  }

  // Legacy Office is checked before the modern formats so that a file named
  // `.xls` is never handed to the .xlsx reader. A modern OOXML content type
  // wins, because that is the stronger signal about the actual bytes.
  const modernOoxml = type === XLSX_MIME || type === XLSM_MIME || type === DOCX_MIME;
  const legacyByName = /\.(xls|doc|ods|odt)$/.test(name);
  const legacyByType =
    type === 'application/vnd.ms-excel' ||
    type === 'application/msword' ||
    type.includes('opendocument');
  if (legacyByType || (legacyByName && !modernOoxml)) {
    return { kind: 'unsupported', reason: LEGACY_OFFICE };
  }

  if (type === XLSX_MIME || type === XLSM_MIME || /\.(xlsx|xlsm)$/.test(name)) {
    return { kind: 'extract', format: 'spreadsheet', label: 'spreadsheet' };
  }

  if (type === DOCX_MIME || /\.docx$/.test(name)) {
    return { kind: 'extract', format: 'word', label: 'Word document' };
  }

  if (type.startsWith('audio/') || type.startsWith('video/')) {
    return { kind: 'transcribe' };
  }

  return { kind: 'unsupported', reason: '' };
}

/**
 * What a person is told when Scan cannot read their file.
 *
 * The old sentence was "Scan only supports images and PDFs", which stopped
 * being true the moment spreadsheets became readable. The list comes from
 * SCAN_SUPPORTED_SENTENCE so the message and the behaviour cannot drift
 * apart.
 */
export function unsupportedScanMessage(
  fileType: string | null | undefined,
  reason?: string,
): string {
  const what = (fileType ?? '').trim() || 'unknown type';
  const lead = reason?.trim()
    ? reason.trim()
    : `This file is "${what}", which Scan cannot read.`;
  return `${lead} ${SCAN_SUPPORTED_SENTENCE} For audio or video, use Transcribe instead.`;
}

/** True when the Scan button should be offered for this exhibit. */
export function exhibitIsScannable(exhibit: {
  fileName?: string | null;
  fileType?: string | null;
}): boolean {
  const kind = classifyExhibitForReading(exhibit).kind;
  return kind === 'vision' || kind === 'extract';
}

/**
 * The sentence stored on a scan that was read from extracted text.
 *
 * Requirement, not decoration: a summary produced from a spreadsheet's cell
 * values is a different kind of claim from one produced by looking at a page,
 * and somebody relying on it in a hearing is entitled to know which they have.
 * When the file ran past the reading budget, the truncation sentence is part
 * of the same note, because a partial read presented as a whole one is the
 * worst outcome available here.
 */
export function extractedTextReadNote(
  label: string,
  truncationNote?: string | null,
): string {
  const base =
    label === 'spreadsheet'
      ? 'Read from the text inside this spreadsheet rather than from a picture of the page. Sheet names, row numbers and column positions were kept as they are in the file.'
      : `Read from the text inside this ${label} rather than from a picture of the page.`;
  const note = truncationNote?.trim();
  return note ? `${base} ${note}` : base;
}
