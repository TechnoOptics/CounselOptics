import ExcelJS from 'exceljs';
import type { ExhibitSheet } from './pdf';

/**
 * Parse a spreadsheet exhibit (.xlsx / .xlsm) into a compact, court-legible
 * preview of its first populated worksheet, so the export can render the data
 * itself as an inline table rather than a bare reference. Bounded on every axis
 * (rows, cols, cell length, file size) and fail-safe: any parse problem returns
 * null and the exhibit falls back to its authenticated card.
 */

const MAX_ROWS = 24;
const MAX_COLS = 8;
const MAX_CELL = 60;
const MAX_PARSE_BYTES = 12 * 1024 * 1024;

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => (r as { text?: string }).text ?? '').join('');
    if ('result' in o && o.result != null) return String(o.result);
    if ('formula' in o) return o.result != null ? String(o.result) : `=${String(o.formula)}`;
    if (typeof o.hyperlink === 'string') return String(o.text ?? o.hyperlink);
    try { return JSON.stringify(o); } catch { return ''; }
  }
  return String(v);
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
    const ws = wb.worksheets.find((w) => (w.actualRowCount ?? 0) > 0) ?? wb.worksheets[0];
    if (!ws) return null;
    const totalRows = ws.actualRowCount || ws.rowCount || 0;
    const totalCols = ws.actualColumnCount || ws.columnCount || 0;
    const cols = Math.max(1, Math.min(totalCols || MAX_COLS, MAX_COLS));
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_ROWS) return;
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) {
        cells.push(cellText(row.getCell(c).value).replace(/\s+/g, ' ').trim().slice(0, MAX_CELL));
      }
      if (cells.some((x) => x)) rows.push(cells);
    });
    if (!rows.length) return null;
    return { name: ws.name || 'Sheet 1', rows, totalRows, totalCols };
  } catch {
    return null;
  }
}
