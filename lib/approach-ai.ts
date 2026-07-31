import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { friendlyAiError } from './ai-errors';
import { cleanAiText } from './timeline-ai';
import type { EvidenceDigestItem } from './legal-review-ai';

/**
 * Approach-builder AI engine (firm "prove-the-case" layer).
 *
 * The lawyer writes their APPROACH: the theory they are trying to prove ("what
 * I'm trying to establish"). Given that theory plus the matter facts and the
 * evidence digest, the model assembles a structured argument that marshals the
 * relevant evidence into EXHIBITS (citing specific evidence items by their
 * exhibit number) and a supporting TIMELINE, and it names the gaps still to
 * close.
 *
 * Grounded and honest: it may ONLY cite exhibits and facts that appear in the
 * digest it was given, using the exact exhibit labels provided. AI-gated +
 * graceful: returns { error } via friendlyAiError when unavailable.
 */

const MODEL = 'claude-sonnet-4-6';

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function textFrom(res: Anthropic.Messages.Message): string {
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function parseJson<T>(raw: string): T | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  const body = raw.slice(start);
  // Fast path: a well-formed object from the first { to the last }.
  const greedy = body.match(/^[\s\S]*\}/);
  if (greedy) {
    try {
      return JSON.parse(greedy[0]) as T;
    } catch {
      /* fall through to the repair path */
    }
  }
  // Repair path (mirrors lib/timeline-ai.ts): a large legal argument frequently
  // contains unescaped double quotes inside string values (quoted testimony,
  // exhibit text) and can be cut off at the token cap. Escape the stray quotes
  // and control characters, then close any brackets left open, so the argument
  // parses instead of coming back "unreadable".
  const escaped = escapeLooseStringChars(body);
  const escGreedy = escaped.match(/^[\s\S]*\}/);
  if (escGreedy) {
    try {
      return JSON.parse(escGreedy[0]) as T;
    } catch {
      /* fall through to truncation close */
    }
  }
  const closed = closeTruncatedJson(escaped);
  if (!closed) return null;
  try {
    return JSON.parse(closed) as T;
  } catch {
    return null;
  }
}

/** Escape in-string double quotes (detected by the absence of a following
 *  structural token) and raw control chars that make an LLM's JSON invalid. */
function escapeLooseStringChars(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }
    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      const next = s[j];
      if (next === undefined || next === ',' || next === ':' || next === '}' || next === ']') {
        out += '"';
        inStr = false;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return out;
}

/** Best-effort recovery of a JSON object truncated mid-write: trim to the last
 *  complete value and append the closing brackets that were never emitted. */
function closeTruncatedJson(s: string): string | null {
  let inStr = false;
  let esc = false;
  let depth = 0;
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      lastSafe = i;
    } else if (ch === ',') lastSafe = i;
  }
  if (depth <= 0 || lastSafe === -1) return null;
  const cut = s.slice(0, lastSafe + 1).replace(/,\s*$/, '');
  const open: string[] = [];
  inStr = false;
  esc = false;
  for (let i = 0; i < cut.length; i++) {
    const ch = cut[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') open.push(ch);
    else if (ch === '}' || ch === ']') open.pop();
  }
  let tail = '';
  for (let i = open.length - 1; i >= 0; i--) tail += open[i] === '{' ? '}' : ']';
  return cut + tail;
}

export type ApproachExhibit = {
  /** The exhibit label from the digest ("EX-0003") or null when general. */
  exhibit: string | null;
  title: string;
  /** How this exhibit supports the approach. */
  why: string;
};

export type ApproachTimelineEntry = {
  when: string;
  title: string;
  /** Why this moment matters to the approach. */
  significance: string;
};

export type ApproachArgument = {
  /** A crisp restatement of what the approach sets out to prove. */
  thesis: string;
  /** The structured argument in prose (several short paragraphs). */
  argument: string;
  exhibits: ApproachExhibit[];
  timeline: ApproachTimelineEntry[];
  /** What is still missing to fully prove the approach. */
  gaps: string[];
};

export type ApproachFacts = {
  title: string;
  subjectName: string | null;
  caseType: string | null;
  posture: string | null;
  jurisdiction: string | null;
  description: string | null;
};

const SYSTEM = `You are a neutral litigation analyst assembling work product for a licensed attorney at a law firm. The attorney gives you an APPROACH: the theory they are trying to prove in this matter. Your job is to marshal the matter's own evidence into a structured argument for that approach.

Rules (mandatory):
- Use ONLY the matter facts and the evidence digest provided. Never invent evidence, exhibits, dates, parties, or facts.
- The digest is ordered by relevance. The most relevant items include their FULL extracted content under a "Content:" block (the actual text of the document, email, or message thread); read that content closely and ground specific factual claims and quotes in what those items actually say. Lower-relevance items appear as one-line summaries; you may still cite them, but do not attribute specific wording to an item whose full content you were not given.
- When you cite an exhibit, use the EXACT exhibit label shown in the digest (for example "EX-0003"). If an item in the digest has no label, refer to it by its title. Do not cite an exhibit that is not in the digest.
- Build a clear chronological TIMELINE from the dated items that support the approach.
- Be candid about GAPS: what is missing or weak for this approach.
- Neutral, professional English. Never use em dashes or en dashes; use commas, periods, colons, or parentheses. Do not refer to yourself, to any assistant, or to AI. This is work product, not legal advice.

Return ONLY a JSON object with this exact shape:
{
  "thesis": "one or two sentences restating precisely what this approach sets out to prove",
  "argument": "several short paragraphs building the argument, referencing exhibits by their labels",
  "exhibits": [ { "exhibit": "EX-0003 or null", "title": "the item title", "why": "one sentence on how it supports the approach" } ],
  "timeline": [ { "when": "date or period as shown", "title": "what happened", "significance": "why it matters to the approach" } ],
  "gaps": ["each thing still missing or that needs shoring up to prove this approach"]
}`;

function factsBlock(f: ApproachFacts): string {
  return [
    `Matter title: ${f.title}`,
    f.jurisdiction ? `Jurisdiction: ${f.jurisdiction}` : '',
    f.caseType ? `Matter type: ${f.caseType}` : '',
    f.posture ? `Our client's posture: ${f.posture}` : '',
    f.subjectName ? `Opposing party / subject: ${f.subjectName}` : '',
    f.description ? `Facts: ${f.description.slice(0, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// Cap generously: the digest is one line per item and arrives relevance-ordered,
// so this covers an entire matter (hundreds of items) while still bounding the
// prompt. Nothing is dropped for a normal case; only a pathological matter with
// 600+ items would trim, and then it keeps the most relevant.
const MAX_DIGEST_ITEMS = 600;

function evidenceBlock(items: EvidenceDigestItem[]): string {
  if (items.length === 0) return '(no evidence on file yet)';
  return items
    .slice(0, MAX_DIGEST_ITEMS)
    .map((e) => {
      const head = `- ${e.exhibit ? `[${e.exhibit}] ` : ''}${e.when ? `(${e.when}) ` : ''}${e.kind}: ${e.title}`;
      if (e.fullText) {
        // Deep item: the actual extracted content, indented under the header, so
        // the model reasons over what the document/email/thread really says.
        const body = e.fullText
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
        return `${head}${e.summary ? `\n  Summary: ${e.summary}` : ''}\n  Content:\n${body}`;
      }
      return `${head}${e.summary ? ` , ${e.summary}` : ''}`;
    })
    .join('\n\n');
}

/** Assemble the structured argument for an approach. Returns { error } gracefully. */
export async function generateApproachArgument(input: {
  facts: ApproachFacts;
  approach: string;
  /** Who is connected (parties, witnesses, roles) and how. Optional. */
  connections?: string;
  evidence: EvidenceDigestItem[];
}): Promise<ApproachArgument | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const approach = input.approach.trim();
  if (!approach) return { error: 'Write what you are trying to prove first.' };
  const connections = (input.connections ?? '').trim();
  const connectionsBlock = connections
    ? `\n\nCONNECTED PARTIES (who is involved and how; use these roles when weighing the evidence, but never invent facts beyond them):\n${connections}`
    : '';

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 12000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `MATTER FACTS:\n${factsBlock(input.facts)}\n\nEVIDENCE DIGEST:\n${evidenceBlock(input.evidence)}\n\nTHE APPROACH TO PROVE:\n${approach}${connectionsBlock}\n\nAssemble the argument. Produce the JSON.`,
        },
      ],
    });
    const parsed = parseJson<Record<string, unknown>>(textFrom(res));
    if (!parsed) return { error: 'The argument came back unreadable.' };
    return normalize(parsed);
  } catch (err) {
    return { error: friendlyAiError(err, 'generateApproachArgument') };
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanAiText(String(x))).filter(Boolean);
}

function normalize(r: Record<string, unknown>): ApproachArgument {
  const exhibits = Array.isArray(r.exhibits)
    ? (r.exhibits as Array<Record<string, unknown>>)
        .map((e) => ({
          exhibit: cleanAiText(String(e.exhibit ?? '')) || null,
          title: cleanAiText(String(e.title ?? '')),
          why: cleanAiText(String(e.why ?? '')),
        }))
        .filter((e) => e.title || e.exhibit)
    : [];
  const timeline = Array.isArray(r.timeline)
    ? (r.timeline as Array<Record<string, unknown>>)
        .map((t) => ({
          when: cleanAiText(String(t.when ?? '')),
          title: cleanAiText(String(t.title ?? '')),
          significance: cleanAiText(String(t.significance ?? '')),
        }))
        .filter((t) => t.title || t.when)
    : [];
  return {
    thesis: cleanAiText(String(r.thesis ?? '')),
    argument: cleanAiText(String(r.argument ?? '')),
    exhibits,
    timeline,
    gaps: asStringArray(r.gaps),
  };
}
