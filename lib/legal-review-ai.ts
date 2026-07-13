import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { friendlyAiError } from './ai-errors';
import { cleanAiText } from './timeline-ai';

/**
 * Legal-review AI engine (firm "prove-the-case" layer).
 *
 * Given the matter facts + a compact evidence digest, the model proposes the
 * laws / claims implicated in the matter's STATE, each with a legal basis,
 * elements, recommended actions, statute references, and CANDIDATE case
 * citations. The candidate cases are NOT trusted here: the caller runs every
 * one through lib/courtlistener.ts and drops any it cannot verify. This module
 * only drafts; it never decides that a citation is real.
 *
 * AI-gated + graceful: when the key is missing or out of credits, callers get a
 * calm { error } via friendlyAiError and the surface degrades to an
 * "add credits to run" state rather than throwing raw provider JSON.
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
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

export type LegalReviewFacts = {
  title: string;
  subjectName: string | null;
  caseType: string | null;
  posture: string | null;
  jurisdictionState: string | null;
  jurisdictionCountry: string | null;
  description: string | null;
};

export type EvidenceDigestItem = {
  exhibit: string | null; // "EX-0003" or null
  when: string | null;
  kind: string;
  title: string;
  summary: string | null;
  /** The item's full extracted text (OCR / email body / message thread, plus
   *  the AI's relevance reasoning), attached for the most-relevant items so the
   *  analysis reasons over the actual content, not just the summary. Bounded. */
  fullText?: string | null;
};

/** A candidate case the model proposes; UNVERIFIED until CourtListener says so. */
export type DraftCase = {
  caseName: string;
  citation: string | null;
  court: string | null;
  year: string | null;
  relevance: string;
};

export type DraftStatute = {
  label: string;
  citation: string;
  note: string | null;
};

export type DraftClaim = {
  title: string;
  legalBasis: string;
  elements: string[];
  recommendedActions: string[];
  statutes: DraftStatute[];
  cases: DraftCase[];
};

export type LegalReviewDraft = {
  overview: string;
  claims: DraftClaim[];
};

const SYSTEM = `You are a neutral legal-issue analyst preparing work product for a licensed attorney at a law firm. You are NOT the attorney and you do not give final legal advice. Your job: read the matter facts and the evidence digest, and surface the laws and legal claims most plausibly implicated in the SPECIFIED STATE, each with the legal basis, the elements to prove, concrete recommended actions, statute references, and candidate court decisions.

Honesty and safety rules (mandatory):
- Ground everything in the facts provided. Never invent facts, dates, parties, or evidence.
- The evidence digest is ordered by relevance. The most relevant items include their FULL extracted content under a "Content:" block (the actual text of the document, email, or message thread); read that content closely when deciding which claims the evidence supports. Lower-relevance items appear as one-line summaries.
- For "cases", propose REAL, well-known decisions you are confident exist, and give the best citation you know (reporter citation like "410 U.S. 113" when you can). Do NOT fabricate citations. A separate verification step checks every case against CourtListener and DROPS any that cannot be confirmed, so a guessed or wrong citation will simply be discarded, never shown. Prefer landmark or controlling authority in the state or its federal circuit over obscure cases.
- Statutes: cite by code section from public sources; add a short note that the attorney should confirm the current text and version.
- Neutral, professional English. Never use em dashes or en dashes; use commas, periods, colons, or parentheses. Do not refer to yourself, to any assistant, or to AI. Do not name any product.

Return ONLY a JSON object with this exact shape:
{
  "overview": "3 to 5 sentence neutral overview of the legal landscape for this matter in the given state",
  "claims": [
    {
      "title": "the claim or law, e.g. Breach of the implied warranty of habitability",
      "legal_basis": "2 to 4 sentences on the legal basis and why the facts implicate it",
      "elements": ["each element the claim requires"],
      "recommended_actions": ["concrete next actions / approaches for the firm to pursue this claim"],
      "statutes": [ { "label": "statute name", "citation": "code section", "note": "confirm current text" } ],
      "cases": [ { "case_name": "Party v. Party", "citation": "reporter cite or null", "court": "court name or null", "year": "YYYY or null", "relevance": "one sentence: why this decision matters here" } ]
    }
  ]
}
Provide between 2 and 6 claims, ordered by how central they are to the matter.`;

function factsBlock(f: LegalReviewFacts): string {
  const jurisdiction =
    [f.jurisdictionState, f.jurisdictionCountry].map((s) => (s ?? '').trim()).filter(Boolean).join(', ') ||
    '(not specified)';
  return [
    `Matter title: ${f.title}`,
    `State / jurisdiction: ${jurisdiction}`,
    f.caseType ? `Matter type: ${f.caseType}` : '',
    f.posture ? `Our client's posture: ${f.posture}` : '',
    f.subjectName ? `Opposing party / subject: ${f.subjectName}` : '',
    f.description ? `Facts: ${f.description.slice(0, 4000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const MAX_DIGEST_ITEMS = 600;

function evidenceBlock(items: EvidenceDigestItem[]): string {
  if (items.length === 0) return '(no evidence on file yet)';
  return items
    .slice(0, MAX_DIGEST_ITEMS)
    .map((e) => {
      const head = `- ${e.exhibit ? `[${e.exhibit}] ` : ''}${e.when ? `(${e.when}) ` : ''}${e.kind}: ${e.title}`;
      if (e.fullText) {
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

/** Draft the legal review (UNVERIFIED citations). Returns { error } gracefully. */
export async function generateLegalReviewDraft(input: {
  facts: LegalReviewFacts;
  evidence: EvidenceDigestItem[];
}): Promise<LegalReviewDraft | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const state =
    (input.facts.jurisdictionState ?? '').trim() ||
    (input.facts.jurisdictionCountry ?? '').trim() ||
    'the relevant jurisdiction';

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `MATTER FACTS:\n${factsBlock(input.facts)}\n\nEVIDENCE DIGEST:\n${evidenceBlock(input.evidence)}\n\nSurface the laws and claims implicated in ${state}. Produce the JSON.`,
        },
      ],
    });
    const parsed = parseJson<{
      overview?: string;
      claims?: Array<Record<string, unknown>>;
    }>(textFrom(res));
    if (!parsed) return { error: 'The analysis came back unreadable.' };
    return {
      overview: cleanAiText(parsed.overview),
      claims: normalizeClaims(parsed.claims),
    };
  } catch (err) {
    return { error: friendlyAiError(err, 'generateLegalReviewDraft') };
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => cleanAiText(String(x))).filter(Boolean);
}

function normalizeClaims(raw: Array<Record<string, unknown>> | undefined): DraftClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): DraftClaim => {
      const statutes = Array.isArray(r.statutes)
        ? (r.statutes as Array<Record<string, unknown>>)
            .map((s) => ({
              label: cleanAiText(String(s.label ?? '')),
              citation: cleanAiText(String(s.citation ?? '')),
              note: cleanAiText(String(s.note ?? '')) || null,
            }))
            .filter((s) => s.label || s.citation)
        : [];
      const cases = Array.isArray(r.cases)
        ? (r.cases as Array<Record<string, unknown>>)
            .map((cs) => ({
              caseName: cleanAiText(String(cs.case_name ?? cs.caseName ?? '')),
              citation: cleanAiText(String(cs.citation ?? '')) || null,
              court: cleanAiText(String(cs.court ?? '')) || null,
              year: cleanAiText(String(cs.year ?? '')) || null,
              relevance: cleanAiText(String(cs.relevance ?? '')),
            }))
            .filter((cs) => cs.caseName)
        : [];
      return {
        title: cleanAiText(String(r.title ?? '')),
        legalBasis: cleanAiText(String(r.legal_basis ?? r.legalBasis ?? '')),
        elements: asStringArray(r.elements),
        recommendedActions: asStringArray(r.recommended_actions ?? r.recommendedActions),
        statutes,
        cases,
      };
    })
    .filter((c) => c.title);
}
