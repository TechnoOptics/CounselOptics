import ExcelJS from 'exceljs';
import type { ExhibitSheet, ExhibitTab } from './pdf';

/**
 * Parse a spreadsheet exhibit (.xlsx / .xlsm) into court-legible tables — one
 * per POPULATED worksheet, because a workbook routinely keeps the actual
 * figures on a later tab (e.g. an "Income Statement" or "Operating Expenses"
 * sheet) while the first tab is a blank input template. Bounded on every axis
 * (rows, cols, cell length, sheet count, total rows, file size) and fail-safe:
 * any parse problem returns null and the exhibit falls back to its card.
 */

// Tables span pages in the exhibit, so we can reproduce whole sheets. Bounded
// so a runaway workbook can't balloon the packet.
const MAX_ROWS = 500;      // per worksheet
const MAX_COLS = 8;
const MAX_CELL = 60;
const MAX_TABS = 8;        // worksheets rendered per workbook
const MAX_TOTAL_ROWS = 700; // across all worksheets combined
const MAX_PARSE_BYTES = 12 * 1024 * 1024;

/** Format a scalar cell value the way a reader expects to see it. Numbers get
 *  thousands separators (but 4-digit year-like integers are left bare so a year
 *  or a numeric code isn't mangled into "2,014"). */
function scalarText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (Number.isInteger(v) && Math.abs(v) < 10000) return String(v); // year / small code
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** True when a formatted cell string is a real numeric figure — a number,
 *  optionally with a sign, thousands separators, or decimals — but NOT an
 *  account code ("4000-00-…", excluded by the dashes) or a bare 4-digit year. */
function isFigure(s: string): boolean {
  const t = s.trim();
  if (!/^-?[\d,]+(\.\d+)?$/.test(t)) return false;
  if (/^\d{4}$/.test(t)) { const y = Number(t); if (y >= 1900 && y <= 2100) return false; }
  return true;
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    // Formula cell: show ONLY the cached computed result, never the raw formula
    // (a bare "=SUM(...)" reads as corruption). Blank when no result is stored.
    if ('formula' in o || 'sharedFormula' in o) {
      const r = o.result;
      if (r == null || (typeof r === 'object' && 'error' in (r as object))) return '';
      return scalarText(r);
    }
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => (r as { text?: string }).text ?? '').join('');
    if ('result' in o && o.result != null) return scalarText(o.result);
    if (typeof o.hyperlink === 'string') return String(o.text ?? o.hyperlink);
    try { return JSON.stringify(o); } catch { return ''; }
  }
  return scalarText(v);
}

export async function parseExhibitSheet(
  buf: Buffer,
  name: string,
  mime: string,
): Promise<ExhibitSheet | null> {
  const n = (name || '').toLowerCase();
  const looksXlsx = /\.(xlsx|xlsm)$/.test(n) || (mime || '').includes('spreadsheetml');
  if (!looksXlsx) return null;
  if (buf.length > MAX_PARSE_BYTES) return null;
  // Office Open XML is a ZIP container — magic bytes "PK".
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const tabs: ExhibitTab[] = [];
    let totalRowsAcross = 0;
    for (const ws of wb.worksheets) {
      if (tabs.length >= MAX_TABS || totalRowsAcross >= MAX_TOTAL_ROWS) break;
      if ((ws.actualRowCount ?? 0) === 0) continue; // skip blank worksheets
      const totalRows = ws.actualRowCount || ws.rowCount || 0;
      const totalCols = ws.actualColumnCount || ws.columnCount || 0;
      const cols = Math.max(1, Math.min(totalCols || MAX_COLS, MAX_COLS));
      const rowBudget = Math.min(MAX_ROWS, MAX_TOTAL_ROWS - totalRowsAcross);
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        if (rows.length >= rowBudget) return;
        const cells: string[] = [];
        for (let c = 1; c <= cols; c++) {
          cells.push(cellText(row.getCell(c).value).replace(/\s+/g, ' ').trim().slice(0, MAX_CELL));
        }
        if (cells.some((x) => x)) rows.push(cells);
      });
      if (!rows.length) continue;
      // Drop columns that are empty across EVERY shown row (a blank template's
      // value column, or a leading spacer) so the table reads as real data.
      const width = Math.max(...rows.map((r) => r.length));
      const keep: number[] = [];
      for (let c = 0; c < width; c++) {
        if (rows.some((r) => (r[c] ?? '').trim() !== '')) keep.push(c);
      }
      const trimmed = keep.length ? rows.map((r) => keep.map((c) => r[c] ?? '')) : rows;
      // Skip worksheets whose data columns are all empty — a blank input
      // template or a labels-only account list carries no figures, so it just
      // clutters the exhibit. A tab is kept only if it holds at least one real
      // numeric value (a figure, not a code like "4000-00-…" or a bare year).
      if (!trimmed.some((r) => r.some(isFigure))) continue;
      tabs.push({ name: ws.name || `Sheet ${tabs.length + 1}`, rows: trimmed, totalRows, totalCols });
      totalRowsAcross += trimmed.length;
    }
    if (!tabs.length) return null;
    return { tabs };
  } catch {
    return null;
  }
}
