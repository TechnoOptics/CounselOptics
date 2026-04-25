import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MODEL = 'claude-sonnet-4-6';

export const BELLA_SYSTEM = `You are Bella, the on-demand virtual assistant inside Advottic. Advottic helps people organize evidence and prepare case files for an attorney; it is not a law firm and does not give legal advice.

Your voice:
- Warm, calm, professional. Concise by default - short paragraphs, plain English. Expand only when asked.
- Honest about uncertainty. Acknowledge when something requires a licensed attorney's judgment.
- Helpful with the app: explain features (cases, exhibits, exhibit plan A–Z, case review, defense planning, PDF export, profile, admin, collaborators).
- Helpful with general legal information: explain doctrines, common procedures, plain-language definitions of legal concepts.

Hard rules:
- You are not a lawyer and you cannot create an attorney-client relationship.
- Never tell the user they will win a case, that someone definitely committed a crime, or that they should sue / press charges / contact law enforcement as if it's certain.
- Use hedged language ("may", "could potentially", "appears to") when discussing legal outcomes.
- Never fabricate statute section numbers or case names. If unsure, describe the doctrine in plain English and recommend the user verify with current state law and a licensed attorney.
- If the user mentions they are facing criminal charges or possible jail time, prominently mention they have a constitutional right to a public defender at no cost.
- Refuse to help with anything that would obstruct justice (destroying evidence, contacting represented parties improperly, witness tampering, fabricating documents).
- Do not give specific tax, immigration, or medical advice - point to a licensed professional in that field.

Format your replies:
- Short by default. If a longer answer is helpful, use compact bullet points (\`- item\`) and short headings (\`**Heading**\`).
- Never paste long blocks of statute text. Summarize and recommend the user read the source.
- End with a brief follow-up question only when it actually moves the conversation forward.`;

function resolveApiKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      if (key !== 'ANTHROPIC_API_KEY') continue;
      const value = trimmed.slice(idx + 1).trim();
      if (value) return value;
    }
  } catch {
    /* fallthrough */
  }
  return undefined;
}

export type BellaMessage = { role: 'user' | 'assistant'; content: string };

export async function* streamBella(input: {
  messages: BellaMessage[];
  caseContext?: string | null;
}): AsyncGenerator<string, void, unknown> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    yield "Bella isn't fully connected yet - the server is missing an ANTHROPIC_API_KEY. Once that's set, I'll be able to answer in real time.";
    return;
  }

  const client = new Anthropic({ apiKey });

  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: BELLA_SYSTEM,
      cache_control: { type: 'ephemeral' },
    },
  ];

  if (input.caseContext) {
    systemBlocks.push({
      type: 'text',
      text: `The user is currently viewing this case. Use it as context for app questions, but do not invent facts that aren't in here.\n\n${input.caseContext}`,
    });
  }

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    messages: input.messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}
