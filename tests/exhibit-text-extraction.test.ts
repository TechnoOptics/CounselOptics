import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  EMPTY_SPREADSHEET_MESSAGE,
  EXTRACT_CHAR_BUDGET,
  cellToText,
  extractWorkbookText,
  rowValuesToLine,
} from '../lib/exhibit-text';

/**
 * Reading a spreadsheet exhibit.
 *
 * Two exhibits on a live matter are a monthly expense sheet and a payment and
 * debt tracker, and both were refused outright because a vision model cannot
 * look at a workbook. Everything below is about the two ways extracting the
 * text could put a WRONG NUMBER or a WRONG DAY in front of a judge:
 *
 *   - a row whose empty column is dropped, sliding every later value one
 *     column to the left and under the wrong heading;
 *   - a date-only cell formatted in the local zone, which prints the day
 *     before anywhere behind UTC.
 *
 * The workbooks here are REAL: written with exceljs, serialised to .xlsx
 * bytes, and read back through the extractor under test. Nothing is mocked,
 * because a mock of the extractor would prove nothing about either failure.
 */

async function workbookBytes(
  build: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The data cells of one emitted line, without its leading row number. */
function cellsOf(line: string): string[] {
  return line.split('\t').slice(1);
}

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => /^\d+\t/.test(l));
}

describe('column position survives extraction', () => {
  it('keeps an empty middle column in place instead of shifting money left', async () => {
    // Column B is empty on the payment row. If it is dropped, "1250.5" lands
    // under "Payee" and "Rent" lands under "Date".
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Payments');
      ws.addRow(['Date', 'Payee', 'Amount', 'Note']);
      const row = ws.addRow([]);
      row.getCell(1).value = '2026-03-01';
      row.getCell(3).value = 1250.5;
      row.getCell(4).value = 'Rent';
    });

    const out = await extractWorkbookText(bytes);

    expect(out.error).toBeUndefined();
    const lines = linesOf(out.text);
    const payment = cellsOf(lines[1]);
    expect(payment).toEqual(['2026-03-01', '', '1250.5', 'Rent']);
    // Said another way, so the assertion cannot pass on a coincidence: the
    // amount is the THIRD column, not the second.
    expect(payment[2]).toBe('1250.5');
    expect(payment[1]).toBe('');
  });

  it('keeps a leading empty column, so a sub-total does not become a date', async () => {
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Debts');
      ws.addRow(['Date', 'Creditor', 'Balance']);
      const row = ws.addRow([]);
      row.getCell(2).value = 'Subtotal';
      row.getCell(3).value = 4820;
    });

    const out = await extractWorkbookText(bytes);
    const cells = cellsOf(linesOf(out.text)[1]);

    expect(cells[0]).toBe('');
    expect(cells).toEqual(['', 'Subtotal', '4820']);
  });

  it('does not let a line break inside one cell split the row', async () => {
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Notes');
      ws.addRow(['Item', 'Detail', 'Amount']);
      ws.addRow(['Repair', 'Front door\nand the frame', 300]);
    });

    const out = await extractWorkbookText(bytes);
    const lines = linesOf(out.text);

    expect(lines).toHaveLength(2);
    expect(cellsOf(lines[1])).toEqual(['Repair', 'Front door and the frame', '300']);
  });
});

describe('rowValuesToLine works on the sparse array exceljs actually returns', () => {
  it('writes a hole as an empty column rather than skipping it', () => {
    // This is the shape row.values has: index 0 unused, holes where cells are
    // absent. Array.prototype.map skips holes, which is the whole bug.
    const sparse: unknown[] = [];
    sparse[1] = 'A';
    sparse[4] = 'D';

    expect(rowValuesToLine(sparse)).toBe('A\t\t\tD');
    expect(rowValuesToLine(sparse).split('\t')).toHaveLength(4);
  });
});

describe('dates render as the day they say, in any time zone', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    // Six hours behind UTC. A date-only cell arrives as midnight UTC, so any
    // local getter here reports the PREVIOUS day.
    process.env.TZ = 'America/Chicago';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('proves the zone is really shifted, so the test below is not vacuous', () => {
    const midnightUtc = new Date(Date.UTC(2026, 2, 1));
    expect(midnightUtc.getDate()).toBe(28);
    expect(midnightUtc.getMonth()).toBe(1);
  });

  it('renders a date cell as its own day and not the day before', async () => {
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Expenses');
      ws.addRow(['Date', 'Amount']);
      const row = ws.addRow([new Date(Date.UTC(2026, 2, 1)), 900]);
      row.getCell(1).numFmt = 'mm/dd/yyyy';
    });

    const out = await extractWorkbookText(bytes);
    const cells = cellsOf(linesOf(out.text)[1]);

    expect(cells[0]).toBe('2026-03-01');
    expect(out.text).not.toContain('2026-02-28');
  });

  it('renders a date with a time as its own day and time', () => {
    expect(cellToText(new Date(Date.UTC(2026, 0, 5, 14, 30)))).toBe(
      '2026-01-05 14:30:00',
    );
    expect(cellToText(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
  });

  it('renders the first instant of a day as that day, not the one before', () => {
    // 2026-01-01T00:00:00Z is 2025-12-31 in Chicago. A local getter here
    // rolls the year back as well as the day.
    expect(cellToText(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
  });
});

describe('numbers are not reformatted', () => {
  it('leaves an amount exactly as the sheet holds it', () => {
    expect(cellToText(1250.5)).toBe('1250.5');
    expect(cellToText(4820)).toBe('4820');
    expect(cellToText(0)).toBe('0');
  });

  it('reads a formula cell as its cached result, which is what the sheet shows', () => {
    expect(cellToText({ formula: 'SUM(C2:C9)', result: 6070.25 })).toBe('6070.25');
  });

  it('reads an error cell as the error the sheet shows', () => {
    expect(cellToText({ error: '#REF!' })).toBe('#REF!');
  });
});

describe('row order and row identity survive extraction', () => {
  it('numbers every line with its own spreadsheet row, so a skipped blank row shows as a gap', async () => {
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Ledger');
      ws.getRow(1).values = ['Date', 'Amount'];
      ws.getRow(2).values = ['2026-01-02', 10];
      // Row 3 left blank on purpose.
      ws.getRow(4).values = ['2026-01-04', 20];
    });

    const out = await extractWorkbookText(bytes);
    const numbers = linesOf(out.text).map((l) => Number(l.split('\t')[0]));

    expect(numbers).toEqual([1, 2, 4]);
  });

  it('keeps every sheet, in workbook order, under its own name', async () => {
    const bytes = await workbookBytes((wb) => {
      wb.addWorksheet('Expenses').addRow(['a']);
      wb.addWorksheet('Debt Tracker').addRow(['b']);
    });

    const out = await extractWorkbookText(bytes);

    expect(out.text).toContain('### Sheet: Expenses');
    expect(out.text).toContain('### Sheet: Debt Tracker');
    expect(out.text.indexOf('### Sheet: Expenses')).toBeLessThan(
      out.text.indexOf('### Sheet: Debt Tracker'),
    );
  });
});

describe('truncation is never silent', () => {
  it('says it stopped, and where, when a workbook runs past the budget', async () => {
    const filler = 'x'.repeat(400);
    const bytes = await workbookBytes((wb) => {
      const ws = wb.addWorksheet('Huge');
      for (let i = 0; i < 900; i += 1) ws.addRow([filler, filler]);
    });

    const out = await extractWorkbookText(bytes);

    expect(out.truncated).toBe(true);
    expect(out.truncationNote).toBeTruthy();
    expect(out.truncationNote).toContain('Huge');
    expect(out.truncationNote).toMatch(/row \d+/);
    expect(out.text.length).toBeLessThanOrEqual(EXTRACT_CHAR_BUDGET);
  });

  it('says nothing was left out when nothing was', async () => {
    const bytes = await workbookBytes((wb) => {
      wb.addWorksheet('Small').addRow(['a', 'b']);
    });

    const out = await extractWorkbookText(bytes);

    expect(out.truncated).toBe(false);
    expect(out.truncationNote).toBeNull();
  });
});

describe('nothing readable is a refusal with a reason, never an empty success', () => {
  it('refuses an empty workbook and says what to do', async () => {
    const bytes = await workbookBytes((wb) => {
      wb.addWorksheet('Sheet1');
    });

    const out = await extractWorkbookText(bytes);

    expect(out.text).toBe('');
    expect(out.error).toBe(EMPTY_SPREADSHEET_MESSAGE);
    expect(out.error).toMatch(/password protected/i);
  });

  it('refuses bytes that are not a workbook at all, without throwing', async () => {
    const out = await extractWorkbookText(Buffer.from('this is not a workbook'));

    expect(out.text).toBe('');
    expect(out.error).toBeTruthy();
    expect(out.error).toMatch(/could not be opened|password/i);
  });
});
