import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dates and amounts a scan asks for are capped.
 *
 * submit_scan is a metadata tool: a short summary, a category, and lists of
 * the parties, dates, amounts and citations on the document. Nothing in the
 * prompt or the schema bounded those lists, and the extracted-text path hands
 * the model up to five thousand spreadsheet rows with an instruction to report
 * amounts exactly as they appear. A payment tracker therefore produced a fill
 * that listed every row, ran past the 2,000 token output budget, and either
 * came back with no summary (before the stop_reason check) or fails outright
 * (after it). Neither is a reading of the document.
 *
 * The cap lives in one exported number and is stated in three places the
 * model actually sees: the system prompt rules, the tool schema (maxItems on
 * both arrays) and the extracted-text rules a spreadsheet read adds. When the
 * document holds more than the cap, the model is told to pick the entries
 * that identify the document and to say in the summary how many there are in
 * all, so a bounded list never reads as a complete one.
 *
 * Nothing is sliced after the fact. A list the model chose to send whole is
 * stored whole; the cap steers the fill, it does not quietly discard data.
 */

const seen = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        seen.last = body;
        return {
          model: 'test-model',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              name: 'submit_scan',
              input: {
                docType: 'receipt',
                identifiers: {},
                parties: ['Landlord'],
                dates: [{ label: 'First payment', value: '2026-03-01' }],
                amounts: ['1250.5'],
                summary: 'A month of rent payments.',
                suggestedCategory: 'Receipt',
              },
            },
          ],
        };
      },
    };
  },
}));

const { scanDocument, scanExtractedText, SCAN_LIST_CAP } = await import('../lib/ai');

type Schema = {
  properties: Record<string, { maxItems?: number; description?: string }>;
};

function systemText(): string {
  const system = (seen.last?.system ?? []) as Array<{ text?: string }>;
  return system.map((s) => s.text ?? '').join('\n');
}

function schema(): Schema {
  const tools = (seen.last?.tools ?? []) as Array<{ input_schema: Schema }>;
  return tools[0]!.input_schema;
}

function userText(): string {
  const messages = (seen.last?.messages ?? []) as Array<{
    content: Array<{ text?: string }>;
  }>;
  return messages[0]?.content?.map((c) => c.text ?? '').join('\n') ?? '';
}

const VISION = {
  fileBuffer: Buffer.from('%PDF-1.4 pretend'),
  mediaType: 'application/pdf',
  fileName: 'ledger.pdf',
};

const EXTRACTED = {
  text: '### Sheet: March\n1\tDate\tPayee\tAmount\n2\t2026-03-01\tLandlord\t1250.5',
  fileName: 'ledger.xlsx',
  sourceLabel: 'spreadsheet',
  truncated: false,
  truncationNote: null,
  readNote: 'Read from the text inside this spreadsheet rather than from a picture of the page.',
};

beforeEach(() => {
  seen.last = null;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('the cap itself', () => {
  it('is a small number: a scan lists what identifies a document, not every row', () => {
    expect(typeof SCAN_LIST_CAP).toBe('number');
    expect(SCAN_LIST_CAP).toBeGreaterThanOrEqual(10);
    expect(SCAN_LIST_CAP).toBeLessThanOrEqual(40);
  });

  it('fits inside the output budget the scan call asks for, with room for the rest', async () => {
    await scanDocument(VISION);
    // A date entry costs about twenty tokens and an amount about seven, so a
    // fill at the cap for both is under thirty tokens per pair. The rest of a
    // fill (summary, parties, identifiers, citations) measured well under
    // five hundred on a synthetic tracker.
    expect(seen.last?.max_tokens).toBeGreaterThanOrEqual(SCAN_LIST_CAP * 30 + 500);
  });
});

describe('the vision scan', () => {
  it('caps both arrays in the schema the model fills', async () => {
    await scanDocument(VISION);
    const { properties } = schema();
    expect(typeof properties.dates?.maxItems).toBe('number');
    expect(properties.dates?.maxItems).toBe(SCAN_LIST_CAP);
    expect(properties.amounts?.maxItems).toBe(SCAN_LIST_CAP);
  });

  it('states the cap in the dates and amounts rules', async () => {
    await scanDocument(VISION);
    const text = systemText();
    expect(text).toMatch(new RegExp(`^- Dates:.*at most ${SCAN_LIST_CAP}\\b`, 'm'));
    expect(text).toMatch(new RegExp(`^- Amounts:.*at most ${SCAN_LIST_CAP}\\b`, 'm'));
  });

  it('tells the model to say in the summary how many the document holds', async () => {
    await scanDocument(VISION);
    expect(systemText()).toMatch(/say in the summary how many .* in all/i);
  });
});

describe('the extracted-text scan', () => {
  it('uses the same capped schema', async () => {
    await scanExtractedText(EXTRACTED);
    const { properties } = schema();
    expect(typeof properties.dates?.maxItems).toBe('number');
    expect(properties.dates?.maxItems).toBe(SCAN_LIST_CAP);
    expect(properties.amounts?.maxItems).toBe(SCAN_LIST_CAP);
  });

  it('tells a spreadsheet read which rows to keep and to state the row count', async () => {
    await scanExtractedText(EXTRACTED);
    const prompt = userText();
    // The sentence, not the bare number: the fixture's own cell value 1250.5
    // contains "25", and a bare toContain let a mutant that dropped the cap
    // sentence pass on that.
    expect(prompt).toMatch(new RegExp(`capped at ${SCAN_LIST_CAP} each`));
    expect(prompt).toMatch(/first and last/i);
    expect(prompt).toMatch(/how many rows/i);
  });

  it('still forbids totalling or reformatting what it does report', async () => {
    await scanExtractedText(EXTRACTED);
    expect(userText()).toMatch(/do not total, round, convert or reformat/i);
  });
});
