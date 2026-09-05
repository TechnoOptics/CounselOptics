import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A scan cut off by max_tokens must not be stored as if it were whole.
 *
 * The model fills the submit_scan tool in schema order: docType, identifiers,
 * parties, dates, jurisdiction, amounts, statuteRefs, summary, category. When
 * the output budget runs out part-way, the API hands back the fields it
 * managed to finish and nothing for the rest, and stop_reason says max_tokens.
 * Both scan paths (vision over an image or PDF, and the extracted-text path a
 * spreadsheet or Word document takes) accepted that partial input silently.
 * The summary is the last text field in the schema, and it is the one field
 * that travels into exports, packets and the review prompt, so a long payment
 * tracker came back as "(no summary returned)" with no amounts and a dates
 * list that simply stopped, and nothing said why.
 *
 * runReview learned to fail in the open for the same defect. This file holds
 * the two scan calls to the same rule, and proves that the failure reaches
 * the person as a refusal rather than being written to the exhibit row.
 */

const seen = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
  calls: [] as Record<string, unknown>[],
  reply: null as Record<string, unknown> | null,
  saved: [] as unknown[],
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        seen.last = body;
        seen.calls.push(body);
        return seen.reply;
      },
    };
  },
}));

// Only what rescanExhibitAction touches on its way to the model. The scan
// functions themselves run for real against the faked SDK above.
vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usingSupabase: () => true,
    getExhibitById: async () => ({
      id: 'ex-1',
      caseId: 'case-1',
      fileName: 'ledger.pdf',
      fileType: 'application/pdf',
    }),
    getExhibitFileBuffer: async () => Buffer.from('%PDF-1.4 pretend'),
    saveExhibitScan: async (_id: string, scan: unknown) => {
      seen.saved.push(scan);
    },
    getProTokenGate: async () => null,
    consumeTokensForCurrentUser: async () => undefined,
  };
});
vi.mock('../lib/activity', () => ({ logCaseEvent: async () => undefined }));
vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
  isCurrentUserAdmin: async () => false,
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'owner-1', email: 'owner@example.test' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));

const { scanDocument, scanExtractedText, SCAN_MAX_TOKENS } = await import('../lib/ai');
const { rescanExhibitAction } = await import('../lib/actions');

const fullInput = {
  docType: 'payment_tracker',
  identifiers: { account_number: '4471-22' },
  parties: ['Jordan Rains', 'Riverside Property Management LLC'],
  dates: [{ label: 'First payment', value: '2026-03-01' }],
  jurisdiction: 'Hennepin County, MN',
  amounts: ['$1,250.50'],
  statuteRefs: [],
  summary: 'A month by month record of rent payments made to the landlord.',
  suggestedCategory: 'Document',
};

/** What the API returns when the budget ran out inside the dates list. */
const { jurisdiction, amounts, statuteRefs, summary, suggestedCategory, ...cutOff } = fullInput;
void jurisdiction; void amounts; void statuteRefs; void summary; void suggestedCategory;

function reply(stopReason: string, input: Record<string, unknown>) {
  return {
    model: 'test-model',
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: 'tool_use', name: 'submit_scan', input }],
  };
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
  seen.calls.length = 0;
  seen.reply = null;
  seen.saved.length = 0;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('the scan budget', () => {
  it('is one named number that both scan calls ask for', async () => {
    seen.reply = reply('tool_use', fullInput);
    await scanDocument(VISION);
    await scanExtractedText(EXTRACTED);

    expect(typeof SCAN_MAX_TOKENS).toBe('number');
    expect(seen.calls).toHaveLength(2);
    expect(seen.calls[0]?.max_tokens).toBe(SCAN_MAX_TOKENS);
    expect(seen.calls[1]?.max_tokens).toBe(SCAN_MAX_TOKENS);
  });
});

describe('a vision scan that ran out of output budget', () => {
  it('is returned whole when the model finished', async () => {
    seen.reply = reply('tool_use', fullInput);
    const scan = await scanDocument(VISION);
    expect(scan.summary).toBe(fullInput.summary);
    expect(scan.amounts).toEqual(['$1,250.50']);
    expect(scan.readMethod).toBe('vision');
  });

  it('fails in the open instead of returning the finished fields', async () => {
    seen.reply = reply('max_tokens', cutOff);
    await expect(scanDocument(VISION)).rejects.toMatchObject({
      name: 'AiUnavailableError',
    });
  });
});

describe('an extracted-text scan that ran out of output budget', () => {
  it('is returned whole when the model finished', async () => {
    seen.reply = reply('tool_use', fullInput);
    const scan = await scanExtractedText(EXTRACTED);
    expect(scan.summary).toBe(fullInput.summary);
    expect(scan.readMethod).toBe('extracted-text');
  });

  it('fails in the open instead of returning the finished fields', async () => {
    seen.reply = reply('max_tokens', cutOff);
    await expect(scanExtractedText(EXTRACTED)).rejects.toMatchObject({
      name: 'AiUnavailableError',
    });
  });
});

describe('what the person who pressed Scan is told', () => {
  it('records the truncated scan as a failure and writes nothing to the exhibit', async () => {
    seen.reply = reply('max_tokens', cutOff);

    const res = await rescanExhibitAction('ex-1');

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/temporarily unavailable/i);
    expect(res.error).not.toMatch(/max_tokens|token/i);
    expect(seen.saved).toHaveLength(0);
  });

  it('still stores a scan the model finished', async () => {
    seen.reply = reply('tool_use', fullInput);

    const res = await rescanExhibitAction('ex-1');

    expect(res.ok).toBe(true);
    expect(seen.saved).toHaveLength(1);
  });
});
