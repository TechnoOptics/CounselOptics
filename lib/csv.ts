/**
 * Tiny CSV parser. RFC 4180-ish:
 *   - Quoted fields ("...") preserve commas and newlines.
 *   - "" inside a quoted field is an escaped quote.
 *   - First non-empty row is the header.
 *
 * Imported CSVs come from Clio / PracticePanther / spreadsheet
 * exports, all of which follow this dialect well enough that the
 * 40-line parser below is sufficient. We deliberately don't pull a
 * dependency for a one-page import surface.
 */

export type CsvParsed = {
  /** Lowercased + trimmed column headers, in the order they appear. */
  headers: string[];
  /** Each row is a map: header -> raw cell string. */
  rows: Record<string, string>[];
};

export function parseCsv(input: string): CsvParsed {
  // Normalize line endings.
  const text = input.replace(/\r\n?/g, '\n');
  const records: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      field = '';
      records.push(cur);
      cur = [];
      continue;
    }
    field += ch;
  }
  // Final field / row (no trailing newline case).
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    records.push(cur);
  }

  // Drop fully-empty rows (a blank line at EOF is common).
  const cleaned = records.filter(
    (r) => r.length > 1 || (r.length === 1 && r[0]!.trim().length > 0),
  );
  if (cleaned.length === 0) return { headers: [], rows: [] };

  const headers = (cleaned[0] ?? []).map((h) => h.trim().toLowerCase());
  const rows = cleaned.slice(1).map((r) => {
    const o: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      o[headers[i]!] = (r[i] ?? '').trim();
    }
    return o;
  });
  return { headers, rows };
}
