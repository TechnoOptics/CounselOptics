/**
 * Read the text out of an exhibit that a vision model cannot look at.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scanDocument` sends raw bytes to a vision model, which can look at an
 * image or a PDF and nothing else. A spreadsheet and a Word document are not
 * pictures, so both were refused outright with "Scan only supports images and
 * PDFs". On one real matter that left an expense sheet and a payment and debt
 * tracker unread going into a hearing. This module pulls their text out so
 * the analysis has something true to read.
 *
 * WHAT FAITHFUL MEANS HERE
 * ------------------------
 * A spreadsheet is a grid of facts about money. Every rule below exists
 * because breaking it would put a wrong number or a wrong day in front of a
 * judge:
 *
 *   1. COLUMN POSITION IS PRESERVED. `row.values` from exceljs is a SPARSE
 *      array: a row with values only in columns A and D has holes at indices
 *      2 and 3. The rule is that a hole is a COLUMN, not an absence. Anything
 *      that compacts the array drops those two blanks, slides D into B, and
 *      puts a payment under the wrong heading. `.filter(...)`, `.flat()` and
 *      `row.eachCell` without `includeEmpty` all compact. (`.map()` does not:
 *      it skips holes but keeps their positions, and `join` then fills them.
 *      That was checked by mutation rather than assumed, because the two
 *      behaviours are easy to confuse and only one of them is safe.) This
 *      module walks the row by index from 1 to `values.length - 1` and turns
 *      every hole into an explicit empty column, so no later change can
 *      compact it by accident.
 *
 *   2. ROW ORDER AND ROW IDENTITY ARE PRESERVED. Rows are emitted in sheet
 *      order and each line begins with the spreadsheet's own row number, so a
 *      blank row that exceljs skipped shows up as a gap in the numbering
 *      instead of silently pulling the next row upward.
 *
 *   3. VALUES ARE NOT REFORMATTED. Numbers are stringified as they came back,
 *      with no rounding, grouping or currency symbol added. A formula cell
 *      renders its cached result, which is what the sheet displays.
 *
 *   4. DATES RENDER AS THE DAY THEY SAY, IN ANY TIME ZONE. exceljs hands back
 *      a JavaScript Date, which is an instant, and a date-only cell arrives as
 *      midnight UTC. Formatting that instant with any local getter in a zone
 *      behind UTC prints the day before: the 1st becomes the 28th. This
 *      module reads Dates through UTC accessors only. lib/format.ts and
 *      lib/exhibit-chronology.ts take the same position for the same reason.
 *
 *   5. TRUNCATION IS NEVER SILENT. See EXTRACT_CHAR_BUDGET below.
 *
 * The one thing that is altered: a tab or a line break INSIDE a single cell
 * is replaced with a space, because either one would split that cell across
 * columns or rows and destroy the alignment rule 1 exists to protect.
 */

/**
 * Upper bound on the text taken out of one exhibit, in characters.
 *
 * Chosen to match `SHEET_CHAR_BUDGET` in lib/doc-review.ts, which is the
 * figure this codebase already settled on for real evidence workbooks, so
 * there is one number and not two. It is roughly 50,000 tokens: comfortably
 * inside a model request, and small enough that the bulk reader can do six
 * exhibits in a row without outrunning a serverless function timeout. A
 * payment tracker or an expense sheet for a household matter is far below it.
 *
 * When the budget is reached, extraction STOPS and says where it stopped.
 * Nothing here quietly returns a partial file as though it were whole.
 */
export const EXTRACT_CHAR_BUDGET = 200_000;

/** Per-sheet row ceiling, also matching lib/doc-review.ts. */
export const EXTRACT_MAX_ROWS_PER_SHEET = 5_000;

/** Which reader to use. */
export type ExtractFormat = 'spreadsheet' | 'word';

export type ExtractedText = {
  /** The extracted text. Empty when `error` is set. */
  text: string;
  /** True when the budget stopped the read before the end of the file. */
  truncated: boolean;
  /**
   * Plain sentence naming exactly what was not read. Null when nothing was
   * left out. Never null while `truncated` is true.
   */
  truncationNote: string | null;
  /** Set when nothing could be read at all. Written to be read by a person. */
  error?: string;
};

/**
 * Render one exceljs cell value as text.
 *
 * Exported for its own tests. A Date is rendered through UTC accessors and
 * never through a local getter or `toLocaleString`; see rule 4 above.
 */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = String(value.getUTCFullYear()).padStart(4, '0');
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    const day = `${y}-${mo}-${d}`;
    const ms =
      value.getUTCHours() * 3600000 +
      value.getUTCMinutes() * 60000 +
      value.getUTCSeconds() * 1000 +
      value.getUTCMilliseconds();
    if (ms === 0) return day;
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mi = String(value.getUTCMinutes()).padStart(2, '0');
    const ss = String(value.getUTCSeconds()).padStart(2, '0');
    return `${day} ${hh}:${mi}:${ss}`;
  }

  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // Hyperlink cell: the visible text is what the sheet shows.
    if (typeof o.text === 'string') return sanitizeCell(o.text);
    if (Array.isArray(o.richText)) {
      return sanitizeCell(
        (o.richText as Array<{ text?: string }>).map((r) => r?.text ?? '').join(''),
      );
    }
    // A formula cell displays its cached result, so that is what is read.
    if ('result' in o && o.result !== null && o.result !== undefined) {
      return cellToText(o.result);
    }
    if (typeof o.formula === 'string') return sanitizeCell(`=${o.formula}`);
    if (o.error !== null && o.error !== undefined) return sanitizeCell(String(o.error));
    return '';
  }

  return sanitizeCell(String(value));
}

/**
 * Flatten a tab or a line break inside one cell to a space.
 *
 * A cell entered with alt-enter really does contain a newline. Written out
 * as-is it would break the row into two lines and every column after it would
 * be read against the wrong heading, so the character is replaced rather than
 * the cell being dropped.
 */
function sanitizeCell(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ');
}

/**
 * Turn one exceljs `row.values` array into a tab separated line.
 *
 * Exported for its own tests. THE INDEX LOOP IS LOAD BEARING: `row.values` is
 * sparse and index 0 is unused, and any step that compacts the array shifts
 * every later column to the left. The loop writes a hole as an explicit empty
 * string so there is nothing left for a later edit to compact.
 */
export function rowValuesToLine(values: unknown): string {
  if (!Array.isArray(values)) return '';
  const cells: string[] = [];
  for (let i = 1; i < values.length; i += 1) {
    cells.push(cellToText(values[i]));
  }
  return cells.join('\t');
}

/**
 * Resolve a CommonJS module that may arrive under `.default` through ESM
 * interop. exceljs and mammoth both ship this way; lib/doc-review.ts resolves
 * exceljs the same way for the same reason.
 */
function interop<T>(mod: unknown, pick: (m: Record<string, unknown>) => unknown): T | null {
  const m = mod as Record<string, unknown>;
  const direct = pick(m);
  if (direct) return direct as T;
  const def = m?.default as Record<string, unknown> | undefined;
  if (def) {
    const viaDefault = pick(def);
    if (viaDefault) return viaDefault as T;
  }
  return null;
}

/**
 * Read every sheet of an .xlsx workbook as tab separated rows.
 *
 * Rows keep their spreadsheet row numbers, columns keep their positions, and
 * the read stops at EXTRACT_CHAR_BUDGET saying where it stopped.
 */
export async function extractWorkbookText(buffer: Buffer): Promise<ExtractedText> {
  let workbook: import('exceljs').Workbook;
  try {
    const mod = await import('exceljs');
    const Workbook = interop<typeof import('exceljs').Workbook>(
      mod,
      (m) => m.Workbook,
    );
    if (!Workbook) throw new Error('spreadsheet reader unavailable');
    workbook = new Workbook();
    // A copy, because exceljs reads the buffer's underlying ArrayBuffer and a
    // Buffer from a pool can be a view onto a larger block.
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
  } catch (err) {
    return {
      text: '',
      truncated: false,
      truncationNote: null,
      error: unreadableMessage(err, 'spreadsheet'),
    };
  }

  const blocks: string[] = [];
  let used = 0;
  let stoppedAt: { sheet: string; row: number } | null = null;
  const sheets = workbook.worksheets ?? [];

  for (const sheet of sheets) {
    if (stoppedAt) break;
    const lines: string[] = [];
    let rowsWritten = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (stoppedAt) return;
      if (rowsWritten >= EXTRACT_MAX_ROWS_PER_SHEET) {
        stoppedAt = { sheet: sheet.name, row: rowNumber };
        return;
      }
      const line = `${rowNumber}\t${rowValuesToLine(row.values)}`;
      if (used + line.length + 1 > EXTRACT_CHAR_BUDGET) {
        stoppedAt = { sheet: sheet.name, row: rowNumber };
        return;
      }
      lines.push(line);
      rowsWritten += 1;
      used += line.length + 1;
    });
    if (lines.length === 0) continue;
    blocks.push(
      `### Sheet: ${sheet.name}\n` +
        '(The first value on each line is that row\'s number in the spreadsheet. ' +
        'Columns are separated by tabs and an empty column is kept in place.)\n' +
        lines.join('\n'),
    );
  }

  const text = blocks.join('\n\n').trim();
  if (!text) {
    return {
      text: '',
      truncated: false,
      truncationNote: null,
      error: EMPTY_SPREADSHEET_MESSAGE,
    };
  }

  const stopped = stoppedAt as { sheet: string; row: number } | null;
  return {
    text,
    truncated: Boolean(stopped),
    truncationNote: stopped
      ? `Only part of this spreadsheet was read. Reading stopped at row ${stopped.row} of the sheet named "${stopped.sheet}". Rows after that point, and any later sheets, are not covered by anything below. Please open the file to check them.`
      : null,
  };
}

/** Read the text of a .docx Word document. */
export async function extractWordText(buffer: Buffer): Promise<ExtractedText> {
  let raw: string;
  try {
    const mod = await import('mammoth');
    const extractRawText = interop<
      (input: { buffer: Buffer }) => Promise<{ value?: string }>
    >(mod, (m) => m.extractRawText);
    if (!extractRawText) throw new Error('word reader unavailable');
    const out = await extractRawText({ buffer });
    raw = out?.value ?? '';
  } catch (err) {
    return {
      text: '',
      truncated: false,
      truncationNote: null,
      error: unreadableMessage(err, 'Word document'),
    };
  }

  if (!raw.trim()) {
    return {
      text: '',
      truncated: false,
      truncationNote: null,
      error: EMPTY_WORD_MESSAGE,
    };
  }

  if (raw.length > EXTRACT_CHAR_BUDGET) {
    return {
      text: raw.slice(0, EXTRACT_CHAR_BUDGET),
      truncated: true,
      truncationNote: `Only part of this Word document was read. Reading stopped after ${EXTRACT_CHAR_BUDGET.toLocaleString('en-US')} characters, so the rest of the document is not covered by anything below. Please open the file to check it.`,
    };
  }

  return { text: raw, truncated: false, truncationNote: null };
}

/** Read whichever format this exhibit is. */
export async function extractExhibitText(input: {
  buffer: Buffer;
  format: ExtractFormat;
}): Promise<ExtractedText> {
  return input.format === 'spreadsheet'
    ? extractWorkbookText(input.buffer)
    : extractWordText(input.buffer);
}

export const EMPTY_SPREADSHEET_MESSAGE =
  'This spreadsheet has no readable cells. It may be empty, or it may be password protected. Please open it, check that it has content, save it again without a password, and re-upload it.';

export const EMPTY_WORD_MESSAGE =
  'This Word document has no readable text. It may be empty, or its content may all be images. If it is a scan, save it as a PDF and re-upload it.';

function unreadableMessage(err: unknown, what: string): string {
  const detail = err instanceof Error ? err.message : '';
  if (/password|encrypt/i.test(detail)) {
    return `This ${what} is password protected, so its contents could not be read. Please save a copy without a password and re-upload it.`;
  }
  return `This ${what} could not be opened. It may be damaged or saved in an older format. Please open it, save it again as a current .xlsx or .docx file, and re-upload it.`;
}
