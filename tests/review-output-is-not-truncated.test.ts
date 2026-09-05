import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A review cut off by max_tokens must not be stored as if it were whole.
 *
 * The model fills the submit_review tool in schema order: summary, timeline,
 * key facts, issues, classification, legal references, evidence mapping,
 * evidence to strengthen, subpoena targets, missing information, next steps,
 * questions. When the output budget runs out part-way, the API hands back the
 * fields it managed to finish and nothing for the rest, and stop_reason says
 * max_tokens. runReview accepted that partial input silently, so a case with
 * twenty exhibits got a review whose first six sections were full and whose
 * last six were empty. On a real court case the stored review carried zero
 * evidence mapping and zero next steps, and nothing on the page said why.
 *
 * Two things have to hold. The budget the call asks for has to be large
 * enough that a twenty-exhibit case fits, and when the budget still runs
 * out, the run has to fail in the open instead of returning a hollow review.
 */

const seen = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
  reply: null as Record<string, unknown> | null,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        seen.last = body;
        return seen.reply;
      },
    };
  },
}));

vi.mock('../lib/storage', () => ({
  getProTokenGate: async () => null,
  consumeTokensForCurrentUser: async () => undefined,
}));

const { runReview } = await import('../lib/ai');

const caseRecord = {
  id: 'case-1',
  title: 'A matter',
  caseType: 'Other',
  subjectType: 'person',
  subjectName: 'Someone',
  description: 'What happened.',
  jurisdiction: { city: '', state: 'MN', country: 'US' },
} as unknown as Parameters<typeof runReview>[0];

const fullInput = {
  summary: 'A summary.',
  timeline: ['Day one.'],
  keyFacts: ['A fact.'],
  possibleIssues: ['An issue.'],
  classification: 'civil issue',
  applicableLegalReferences: ['A doctrine.'],
  evidenceMapping: ['An issue - supported by Exhibit A.'],
  evidenceToStrengthen: ['A record.'],
  subpoenaTargets: ['A custodian - what it would show.'],
  missingInformation: ['A gap.'],
  suggestedNextSteps: ['A step.'],
  questionsForAttorney: ['A question.'],
};

function reply(stopReason: string, input: Record<string, unknown>) {
  return {
    model: 'test-model',
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: 'tool_use', name: 'submit_review', input }],
  };
}

beforeEach(() => {
  seen.last = null;
  seen.reply = null;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('a review that ran out of output budget', () => {
  it('asks for enough output for a case with many exhibits', async () => {
    seen.reply = reply('tool_use', fullInput);
    await runReview(caseRecord, []);
    expect(seen.last?.max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it('is returned whole when the model finished', async () => {
    seen.reply = reply('tool_use', fullInput);
    const review = await runReview(caseRecord, []);
    expect(review.evidenceMapping).toEqual(['An issue - supported by Exhibit A.']);
    expect(review.questionsForAttorney).toEqual(['A question.']);
  });

  it('fails in the open instead of returning the finished half', async () => {
    const { evidenceMapping, evidenceToStrengthen, subpoenaTargets, missingInformation,
      suggestedNextSteps, questionsForAttorney, ...firstHalf } = fullInput;
    void evidenceMapping; void evidenceToStrengthen; void subpoenaTargets;
    void missingInformation; void suggestedNextSteps; void questionsForAttorney;
    seen.reply = reply('max_tokens', firstHalf);

    await expect(runReview(caseRecord, [])).rejects.toMatchObject({
      name: 'AiUnavailableError',
    });
  });
});
