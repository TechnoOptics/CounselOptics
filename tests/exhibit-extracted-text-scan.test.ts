import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRealScan } from '../lib/types';

/**
 * What `scanExtractedText` stores about a file it did not look at.
 *
 * The model call is faked so the prompt it was handed can be read back. Three
 * things are asserted, all of them about not misleading somebody preparing
 * for a hearing:
 *
 *   1. The stored scan says the content came from extracted text.
 *   2. A read that hit the size budget says so in the SUMMARY, which is the
 *      field exports, packets and the review prompt all read, and in the
 *      prompt the model itself is given.
 *   3. With no API key it returns the same placeholder scanDocument returns,
 *      marked so `isRealScan` refuses it.
 */

const seen = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        seen.last = body;
        return {
          model: 'test-model',
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

const { scanExtractedText } = await import('../lib/ai');

/** The text of the single user turn the model was given. */
function promptText(): string {
  const messages = (seen.last?.messages ?? []) as Array<{
    content: Array<{ text?: string }>;
  }>;
  return messages[0]?.content?.map((c) => c.text ?? '').join('\n') ?? '';
}

const BASE = {
  text: '### Sheet: March\n1\tDate\tPayee\tAmount\n2\t2026-03-01\tLandlord\t1250.5',
  fileName: 'Monthly Expense.xlsx',
  sourceLabel: 'spreadsheet',
  readNote: 'Read from the text inside this spreadsheet rather than from a picture of the page.',
};

beforeEach(() => {
  seen.last = null;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('the stored scan says how the file was read', () => {
  it('marks the read as extracted text and keeps the note', async () => {
    const scan = await scanExtractedText({
      ...BASE,
      truncated: false,
      truncationNote: null,
    });

    expect(scan.readMethod).toBe('extracted-text');
    expect(scan.readNote).toMatch(/read from the text/i);
    expect(isRealScan(scan)).toBe(true);
  });

  it('tells the model it is reading extracted text and hands it the real cells', async () => {
    await scanExtractedText({ ...BASE, truncated: false, truncationNote: null });

    const prompt = promptText();
    expect(prompt).toMatch(/extracted from a spreadsheet/i);
    expect(prompt).toMatch(/not looking at the page/i);
    expect(prompt).toContain('Landlord\t1250.5');
    expect(prompt).toMatch(/never move a value into a neighbouring column/i);
    expect(prompt).toMatch(/do not total, round, convert or reformat/i);
  });
});

describe('truncation is stated, not swallowed', () => {
  const NOTE =
    'Only part of this spreadsheet was read. Reading stopped at row 4102 of the sheet named "Ledger".';

  it('puts the truncation sentence at the front of the stored summary', async () => {
    const scan = await scanExtractedText({
      ...BASE,
      truncated: true,
      truncationNote: NOTE,
    });

    expect(scan.summary.startsWith(NOTE)).toBe(true);
    // The model's own summary is still there, after the warning.
    expect(scan.summary).toContain('A month of rent payments.');
  });

  it('tells the model only part of the file is present', async () => {
    await scanExtractedText({ ...BASE, truncated: true, truncationNote: NOTE });

    const prompt = promptText();
    expect(prompt).toContain('ONLY PART OF THIS FILE IS BELOW');
    expect(prompt).toContain('row 4102');
    expect(prompt).toMatch(/do not describe the file as complete/i);
  });

  it('leaves the summary alone when nothing was left out', async () => {
    const scan = await scanExtractedText({
      ...BASE,
      truncated: false,
      truncationNote: null,
    });

    expect(scan.summary).toBe('A month of rent payments.');
    expect(promptText()).not.toContain('ONLY PART OF THIS FILE IS BELOW');
  });
});

describe('a placeholder is never dressed up as a real reading', () => {
  it('returns a demo scan that isRealScan refuses when there is no API key', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const scan = await scanExtractedText({
        ...BASE,
        truncated: false,
        truncationNote: null,
      });

      expect(scan.isDemo).toBe(true);
      expect(isRealScan(scan)).toBe(false);
      expect(seen.last).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('refuses empty text rather than reporting a successful reading of nothing', async () => {
    const scan = await scanExtractedText({
      ...BASE,
      text: '   \n  ',
      truncated: false,
      truncationNote: null,
    });

    expect(isRealScan(scan)).toBe(false);
    expect(scan.summary).toMatch(/nothing could be read/i);
    expect(seen.last).toBeNull();
  });
});
