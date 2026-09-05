import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CASE_TYPES, isRealScan, type CaseType } from './types';
import type { AIReview, Case, Exhibit, ScanData } from './types';
import { AiUnavailableError, friendlyAiError } from './ai-errors';
import {
  TRANSCRIPTION_GATE_LOG,
  TRANSCRIPTION_UNAVAILABLE,
  openaiTranscriptionAllowed,
} from './subprocessor-gate';

const MODEL = 'claude-sonnet-4-6';
const FAST_MODEL = 'claude-haiku-4-5-20251001';
/** Output budget for a full case review. See the note at the call site. */
export const REVIEW_MAX_TOKENS = 16000;

function resolveApiKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  // Next.js's dotenv loader won't overwrite an already-set env var, even if
  // it's empty. Fall back to reading .env.local directly so a shell-set
  // `ANTHROPIC_API_KEY=` doesn't mask the real key.
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
    // .env.local missing or unreadable - fall through
  }
  return undefined;
}

const SYSTEM_PROMPT = `You are Advottic, a legal information assistant. You do not provide final legal advice and you are not a lawyer. Your job is to:
1. Organize the facts of the case.
2. Identify possible legal issues grounded in the selected jurisdiction.
3. Recommend concrete evidence the user should gather to strengthen the matter.
4. Identify specific third-party record custodians whose records could be subject to subpoena or discovery, and describe what each one would show.
5. Produce informational issue-spotting that a licensed attorney can verify.

When the jurisdiction is known, reference the common legal doctrines that would likely apply in that state or country (e.g., conversion, replevin, trespass to chattels, civil theft, burglary, trespass, unjust enrichment, breach of bailment, etc.) in plain terms. Do not cite specific statute section numbers unless you are confident they are accurate for that jurisdiction; if you are uncertain, describe the doctrine in plain English and note that the user's attorney should confirm the current statute and case law.

ALWAYS use cautious, hedged language: "may constitute", "could potentially", "appears to involve". NEVER state that a person committed a crime, NEVER tell the user they "have a case", NEVER recommend specific legal action as if it were certain (filing, calling police, suing). Frame outputs as informational issue-spotting.

For evidenceToStrengthen: be specific and actionable. Examples: "Date-stamped photos of the pet in the claimant's home (pre-incident)", "Veterinary records showing ownership and microchip registration", "Text messages or social media posts between the parties referencing the animal". Avoid vague items like "more evidence" or "additional documents".

For subpoenaTargets: list specific types of third parties or record custodians, each paired with what their records would likely show. Examples: "Abel Muchai's cell carrier - call/text metadata around the date the cat was last seen", "Microchip registries (AAHA, HomeAgain, 24PetWatch) - registration history and re-registration attempts", "Local veterinary clinics in Shakopee / Scott County - intake or ownership-transfer records for a cat matching the description", "Animal shelters and rescues in Scott County - surrender logs and adoption records", "Ring / Nest / home security systems of the claimant and consenting neighbors - video footage of the animal in the claimant's custody or leaving with the respondent". Only include a target if the records plausibly exist and would be relevant; do not include fabricated or speculative custodians.

If facts are missing or unclear, say so explicitly in the missingInformation field rather than guessing.`;

const DISCLAIMER = `This analysis is for informational purposes only and does not constitute legal advice. Advottic is not a law firm and does not create an attorney-client relationship. You should consult a licensed attorney in your jurisdiction before taking legal action.`;

type ReviewPayload = {
  summary: string;
  timeline: string[];
  keyFacts: string[];
  possibleIssues: string[];
  classification: string;
  applicableLegalReferences: string[];
  evidenceMapping: string[];
  evidenceToStrengthen: string[];
  subpoenaTargets: string[];
  missingInformation: string[];
  suggestedNextSteps: string[];
  questionsForAttorney: string[];
};

const TOOL_SCHEMA = {
  name: 'submit_review',
  description: 'Submit the structured legal review of the case for the user.',
  input_schema: {
    type: 'object' as const,
    required: [
      'summary',
      'timeline',
      'keyFacts',
      'possibleIssues',
      'classification',
      'applicableLegalReferences',
      'evidenceMapping',
      'evidenceToStrengthen',
      'subpoenaTargets',
      'missingInformation',
      'suggestedNextSteps',
      'questionsForAttorney',
    ],
    properties: {
      summary: { type: 'string', description: 'Plain-English case summary, 2-4 sentences.' },
      timeline: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered timeline events, each one short.',
      },
      keyFacts: { type: 'array', items: { type: 'string' } },
      possibleIssues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible legal issues, each phrased with hedged language.',
      },
      classification: {
        type: 'string',
        description:
          'Possible classification phrased cautiously, e.g., "may involve a misdemeanor under {jurisdiction} law because ...". Use one of: crime, gross misdemeanor, misdemeanor, petty misdemeanor, civil issue, regulatory violation, contract breach, or "unclear".',
      },
      applicableLegalReferences: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Legal doctrines or concepts likely applicable in the stated jurisdiction, described in plain terms (e.g., "civil conversion - unauthorized exercise of control over another\'s personal property"). Do not include statute section numbers unless you are confident they are accurate; default to describing the doctrine and noting that the attorney should confirm the current statute.',
      },
      evidenceMapping: {
        type: 'array',
        items: { type: 'string' },
        description: 'Map each issue to supporting exhibits, e.g., "Issue X - supported by Exhibit B".',
      },
      evidenceToStrengthen: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Concrete, specific evidence the user should gather to strengthen the matter. Be actionable, not generic.',
      },
      subpoenaTargets: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific third-party record custodians whose records could be relevant, each paired with what the records would likely show. Only include targets whose records plausibly exist and would be relevant.',
      },
      missingInformation: { type: 'array', items: { type: 'string' } },
      suggestedNextSteps: { type: 'array', items: { type: 'string' } },
      questionsForAttorney: { type: 'array', items: { type: 'string' } },
    },
  },
};

/**
 * Cheap, fast classifier that picks the closest CASE_TYPES bucket
 * for a free-form case description. Returns null when the
 * description is too short or the model can't make a confident
 * pick. Used by the smart-assist wizard to pre-select the
 * case-type dropdown so the user doesn't have to scan the menu.
 */
export async function classifyCaseType(description: string): Promise<CaseType | null> {
  const text = description?.trim() ?? '';
  if (text.length < 30) return null;

  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  const allowed = CASE_TYPES.join(', ');
  const client = new Anthropic({ apiKey });
  try {
    const result = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 80,
      system:
        'You classify a one-paragraph legal-matter description into exactly one bucket from a fixed list. Respond with the bucket name only - no explanation, no quotes, no punctuation. If the description does not clearly fit any bucket, respond with "Other".',
      messages: [
        {
          role: 'user',
          content: `Buckets (pick exactly one): ${allowed}\n\nDescription:\n${text.slice(0, 1500)}`,
        },
      ],
    });
    const block = result.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return null;
    const guess = block.text.trim().replace(/[."\s]+$/g, '');
    const match = (CASE_TYPES as readonly string[]).find(
      (t) => t.toLowerCase() === guess.toLowerCase(),
    );
    return (match as CaseType | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function runReview(caseRecord: Case, exhibits: Exhibit[]): Promise<AIReview> {
  const jurisdiction = [
    caseRecord.jurisdiction.city,
    caseRecord.jurisdiction.state,
    caseRecord.jurisdiction.country,
  ]
    .filter(Boolean)
    .join(', ');

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return demoReview(caseRecord, exhibits, jurisdiction);
  }

  // Pro tier gate. If the user has burned through their tokens, fall
  // back to the demo template instead of failing - that way they still
  // see SOMETHING on the case page and the UI nudges them to top up.
  try {
    const { getProTokenGate } = await import('./storage');
    const gate = await getProTokenGate();
    if (gate && gate.balance <= 0) {
      const r = demoReview(caseRecord, exhibits, jurisdiction);
      // Plain-limit copy. This string, and the nine like it in lib/bella.ts,
      // lib/actions.ts, lib/item-limits.ts and
      // app/review-my-document/review-client.tsx, used to end with a steering
      // sentence naming where to buy ("Top up from /billing"). They are
      // produced on the server as plain text and reach every platform,
      // including the iOS app, where the CSS platform gate (globals.css
      // data-hide-on-ios) cannot reach inside a string. Advottic on iOS sells
      // nothing and names no place to buy, so the steering sentence is gone
      // for everyone: the limit is stated plainly and the sentence stops
      // there. The web loses nothing it needs, because the Billing page is
      // in its navigation. tests/plain-limit-copy.test.ts pins each string.
      r.summary =
        'Your token balance for this period is used up, so a fresh review cannot run on this case right now. Showing the example template below in the meantime.\n\n' +
        r.summary;
      return r;
    }
  } catch {
    // never block a review because the gate read failed
  }

  const exhibitsBlock = describeExhibitsForPrompt(exhibits);

  const userContent = `Jurisdiction: ${jurisdiction || '(not specified)'}
Case type: ${caseRecord.caseType}
Subject (${caseRecord.subjectType}): ${caseRecord.subjectName}
Title: ${caseRecord.title}

Case description:
${caseRecord.description || '(no description provided)'}

Evidence summaries:
${exhibitsBlock}

Use the submit_review tool to return your structured analysis.`;

  const client = new Anthropic({ apiKey });

  let result;
  try {
    result = await client.messages.create({
      model: MODEL,
      // A case with twenty read exhibits produces a review of well over 4,000
      // tokens, and the model fills the tool in schema order, so a budget that
      // ran out part-way silently emptied every section after the cut. The
      // last six sections of two stored reviews on a real matter were empty
      // for that reason, evidence mapping among them.
      max_tokens: REVIEW_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'submit_review' },
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    // Never let raw Anthropic JSON (credit/quota 400, 429, auth) reach
    // the UI. AiUnavailableError.message is already the calm, branded
    // copy, so a client boundary can render err.message safely.
    throw new AiUnavailableError(err, 'runReview');
  }

  // Pro tier: deduct input + output tokens from the user's quota.
  // No-op for Basic/Standard/anonymous (handled inside the helper).
  try {
    const totalTokens =
      (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
    if (totalTokens > 0) {
      const { consumeTokensForCurrentUser } = await import('./storage');
      await consumeTokensForCurrentUser({
        amount: totalTokens,
        reason: 'legal_eye',
        metadata: { caseId: caseRecord.id },
      });
    }
  } catch {
    // never break a successful review on a metering failure
  }

  // The API returns whatever fields the model finished before the budget ran
  // out, and nothing for the rest. That is not a review of the case, it is
  // the first half of one, and stored it reads as whole. Fail in the open.
  if (result.stop_reason === 'max_tokens') {
    throw new AiUnavailableError(
      new Error(`review output exceeded ${REVIEW_MAX_TOKENS} tokens`),
      'runReview truncated',
    );
  }

  const toolUse = result.content.find(
    (b): b is Extract<(typeof result.content)[number], { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_review',
  );

  const data = (toolUse?.input ?? {}) as Partial<ReviewPayload>;

  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    summary: stringField(data.summary),
    timeline: arrayField(data.timeline),
    keyFacts: arrayField(data.keyFacts),
    possibleIssues: arrayField(data.possibleIssues),
    classification: stringField(data.classification) || 'No clear classification identified.',
    applicableLegalReferences: arrayField(data.applicableLegalReferences),
    evidenceMapping: arrayField(data.evidenceMapping),
    evidenceToStrengthen: arrayField(data.evidenceToStrengthen),
    subpoenaTargets: arrayField(data.subpoenaTargets),
    missingInformation: arrayField(data.missingInformation),
    suggestedNextSteps: arrayField(data.suggestedNextSteps),
    questionsForAttorney: arrayField(data.questionsForAttorney),
    disclaimer: DISCLAIMER,
    modelUsed: MODEL,
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
}

function stringField(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function arrayField(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function demoReview(caseRecord: Case, exhibits: Exhibit[], jurisdiction: string): AIReview {
  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    summary: `Demo review for "${caseRecord.title}" - a ${caseRecord.caseType.toLowerCase()} matter involving ${caseRecord.subjectName} in ${jurisdiction || 'an unspecified jurisdiction'}. ${exhibits.length} exhibit(s) attached. Set ANTHROPIC_API_KEY to enable real Claude-backed analysis.`,
    timeline: [
      'Demo timeline event 1 - date and event would appear here.',
      'Demo timeline event 2 - connect ANTHROPIC_API_KEY for a real reconstructed timeline.',
    ],
    keyFacts: [
      `Subject: ${caseRecord.subjectName} (${caseRecord.subjectType})`,
      `Case type: ${caseRecord.caseType}`,
      `Jurisdiction: ${jurisdiction || 'not specified'}`,
      `Exhibits attached: ${exhibits.length}`,
    ],
    possibleIssues: [
      'Demo issue - set ANTHROPIC_API_KEY to enable real legal issue spotting.',
    ],
    classification:
      'No analysis run yet. This is a demo response. Set ANTHROPIC_API_KEY in .env.local to enable Claude-backed classification.',
    evidenceMapping: exhibits.length
      ? exhibits.map((e) => `${e.label} (${e.fileName}) - relevance to be determined`)
      : ['No exhibits uploaded yet.'],
    missingInformation: [
      'Set ANTHROPIC_API_KEY environment variable to enable a real review.',
      'Upload supporting evidence to ground the analysis.',
    ],
    suggestedNextSteps: [
      'Configure ANTHROPIC_API_KEY in .env.local and re-run this review.',
      'Add exhibits and a more detailed case description.',
    ],
    questionsForAttorney: [
      'Given the facts above, what are my realistic options?',
      'What documents or evidence should I gather before filing or responding?',
    ],
    disclaimer: DISCLAIMER,
    modelUsed: 'demo',
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
}

// ===========================================================================
// Document auto-scan (Claude vision) + audio/video transcription (Whisper)
// ===========================================================================

/**
 * Output budget for one submit_scan fill.
 *
 * The tool asks for metadata, not a transcript: a one-to-two sentence
 * summary, a category, and short lists of parties, dates, amounts and
 * citations. A ticket, notice or contract fills that in a few hundred
 * tokens, and a hundred-row payment tracker in around 1,700 (measured at four
 * characters per token on a synthetic fill), so 2,000 covers what the schema
 * describes with room to spare. A fill that needs more than this is listing
 * every row of a spreadsheet, which is a transcript wearing a scan's shape,
 * and the review prompt would then carry every one of those rows. The budget
 * is deliberately not raised for that case; overflow fails in the open below
 * instead of being stored as a scan with no summary.
 * SCAN_LIST_CAP below bounds the lists, so a fill at the cap fits here
 * with room to spare.
 */
export const SCAN_MAX_TOKENS = 2000;

/**
 * How many parties, how many dates, and how many amounts, one scan may list.
 *
 * submit_scan is a metadata tool. Its lists exist so a case file is
 * searchable, not so a spreadsheet can be reproduced row by row, and the
 * extracted-text path hands the model up to five thousand rows. Unbounded,
 * a payment tracker filled the tool with every row, overran the output
 * budget, and lost its summary. At twenty-five each, a fill at the cap for
 * all three lists costs about a thousand tokens, and the review prompt,
 * which pastes every stored party, date and amount under the exhibit, stays
 * readable. The number is stated wherever the model sees the lists: the
 * rules, the schema, and the spreadsheet rules.
 */
export const SCAN_LIST_CAP = 25;

const SCAN_SYSTEM = `You are Advottic's document scanner. The user uploads a piece of evidence (commonly a ticket, citation, court summons, complaint, motion, eviction notice, demand letter, contract, or receipt) as an image or PDF, and you extract structured metadata so the case file is searchable.

Rules:
- Be terse and accurate. If a field is not visible in the document, omit it - never guess.
- Identifiers: only include the case/ticket/citation/file numbers actually printed on the document. Use snake_case keys: case_number, ticket_number, citation_number, court_file_number, license_plate, badge_number, etc.
- Parties: list named persons or organizations on the document (officer issuing, defendant, court, court clerk, plaintiff, landlord, tenant, etc.). One string per party. List at most ${SCAN_LIST_CAP}: when the document names more, keep the ones it is between or about (the parties to the matter, the issuer, the signers, the court) and say in the summary how many it names in all.
- Dates: each date with a short human label and ISO date when possible (e.g., {label:"Issue date", value:"2026-04-15"}). If only month/year is shown, use YYYY-MM. List at most ${SCAN_LIST_CAP}: when the document holds more, keep the ones that identify it (issue, due, hearing and signing dates, and the first and last entries) and say in the summary how many dates it holds in all.
- Statute references: only verbatim citations from the document (e.g., "MN Stat. § 169.14"). Don't expand acronyms.
- Amounts: monetary values printed on the document, including the symbol or "USD" suffix when known. List at most ${SCAN_LIST_CAP}: when the document holds more, keep totals, balances, the largest entries and the first and last entries, and say in the summary how many amounts it holds in all.
- Summary: one to two sentences in plain English. No legal advice.
- suggestedCategory must be one of: Photo, Document, Communication, Audio, Video, Receipt, Contract, Report, Medical record, Screenshot, Witness statement, Other.

Use the submit_scan tool to return the result.`;

const SCAN_TOOL = {
  name: 'submit_scan',
  description: 'Submit the structured scan of a single uploaded document.',
  input_schema: {
    type: 'object' as const,
    required: ['docType', 'identifiers', 'parties', 'dates', 'summary', 'suggestedCategory'],
    properties: {
      docType: {
        type: 'string',
        description:
          'Snake-case classification, e.g. parking_ticket, traffic_citation, court_summons, complaint, motion, eviction_notice, demand_letter, contract, receipt, photo, screenshot, voice_note, video, other.',
      },
      identifiers: {
        type: 'object',
        description:
          'Map of snake_case identifier keys to their string values (case_number, ticket_number, etc.). Empty object if none visible.',
        additionalProperties: { type: 'string' },
      },
      parties: {
        type: 'array',
        maxItems: SCAN_LIST_CAP,
        items: { type: 'string' },
        description: `Named persons or organizations on the document, at most ${SCAN_LIST_CAP}. Say in the summary how many the document names when there are more.`,
      },
      dates: {
        type: 'array',
        maxItems: SCAN_LIST_CAP,
        description: `The dates that identify the document, at most ${SCAN_LIST_CAP}. Say in the summary how many the document holds when there are more.`,
        items: {
          type: 'object',
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: { type: 'string', description: 'ISO date or YYYY-MM if exact day unknown.' },
          },
        },
      },
      jurisdiction: {
        type: 'string',
        description: 'Court / jurisdiction printed on the document, e.g. "Scott County, MN".',
      },
      amounts: {
        type: 'array',
        maxItems: SCAN_LIST_CAP,
        items: { type: 'string' },
        description: `Monetary amounts printed on the document, at most ${SCAN_LIST_CAP}. Say in the summary how many the document holds when there are more.`,
      },
      statuteRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Verbatim statute / code citations printed on the document.',
      },
      summary: {
        type: 'string',
        description: '1-2 plain-English sentences describing what this document is about.',
      },
      suggestedCategory: {
        type: 'string',
        enum: [
          'Photo',
          'Document',
          'Communication',
          'Audio',
          'Video',
          'Receipt',
          'Contract',
          'Report',
          'Medical record',
          'Screenshot',
          'Witness statement',
          'Other',
        ],
      },
    },
  },
};

/** Per-exhibit budget for extracted text in a review prompt. Enough for a
 *  voicemail or a one-page notice; short enough that one long recording cannot
 *  crowd the case description out of the model's attention. */
const PROMPT_TRANSCRIPT_CHARS = 1500;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)} [...]`;
}

/**
 * Describe the exhibits for the review prompt.
 *
 * Includes what the app has already read out of each file. Scans and
 * transcripts were being written to exhibits.scan_data and then never shown to
 * the model, so a transcribed voicemail was invisible to the analysis of the
 * case it belonged to.
 *
 * A demo scan is deliberately excluded: it is a placeholder produced when no
 * API key was configured, and feeding it back in would let the model treat
 * "document was not actually scanned" as a finding about the evidence.
 */
export function describeExhibitsForPrompt(exhibits: Exhibit[]): string {
  if (exhibits.length === 0) return '(none uploaded yet)';
  return exhibits
    .map((e) => {
      const head = `- ${e.label}: ${e.fileName}${e.description ? ` - ${e.description}` : ''} (${e.fileType})`;
      const scan = e.scanData;
      if (!isRealScan(scan) || !scan) return head;
      const detail: string[] = [];
      if (scan.summary) detail.push(`  Scanned: ${clip(scan.summary, 400)}`);
      // How it was read travels with what was read. A summary built from a
      // spreadsheet's cell values is a different kind of claim from one built
      // by looking at a page, and when only part of a file was read the model
      // must not treat the part as the whole.
      if (scan.readNote) detail.push(`  How it was read: ${clip(scan.readNote, 400)}`);
      if (scan.parties?.length) detail.push(`  Parties named: ${scan.parties.join('; ')}`);
      if (scan.dates?.length) {
        detail.push(
          `  Dates: ${scan.dates.map((d) => [d.label, d.value].filter(Boolean).join(' ')).join('; ')}`,
        );
      }
      if (scan.amounts?.length) detail.push(`  Amounts: ${scan.amounts.join('; ')}`);
      if (scan.transcript) {
        detail.push(`  Transcript: ${clip(scan.transcript, PROMPT_TRANSCRIPT_CHARS)}`);
      }
      return [head, ...detail].join('\n');
    })
    .join('\n');
}

/**
 * Send an image or PDF to Claude vision and extract structured metadata.
 * Returns a complete ScanData record (with model + scannedAt populated).
 */
export async function scanDocument(input: {
  fileBuffer: Buffer;
  mediaType: string; // e.g. "image/png", "application/pdf"
  fileName: string;
}): Promise<ScanData> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      docType: 'other',
      identifiers: {},
      parties: [],
      dates: [],
      summary: 'Demo response - ANTHROPIC_API_KEY not set; document was not actually scanned.',
      scannedAt: new Date().toISOString(),
      modelUsed: 'demo',
      isDemo: true,
    };
  }

  const isImage = input.mediaType.startsWith('image/');
  const isPdf = input.mediaType === 'application/pdf';
  if (!isImage && !isPdf) {
    return {
      docType: 'other',
      identifiers: {},
      parties: [],
      dates: [],
      summary: `File type ${input.mediaType} cannot be auto-scanned. Only images and PDFs are supported.`,
      scannedAt: new Date().toISOString(),
      modelUsed: 'unsupported',
    };
  }

  const client = new Anthropic({ apiKey });
  const dataB64 = input.fileBuffer.toString('base64');

  // Build the file content block. SDK types narrow image vs PDF separately,
  // so we construct each path explicitly.
  const filePart: Anthropic.Messages.ContentBlockParam = isImage
    ? {
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.mediaType as
            | 'image/png'
            | 'image/jpeg'
            | 'image/webp'
            | 'image/gif',
          data: dataB64,
        },
      }
    : {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: dataB64 },
      };

  let result;
  try {
    result = await client.messages.create({
      model: MODEL,
      max_tokens: SCAN_MAX_TOKENS,
      system: [{ type: 'text', text: SCAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [SCAN_TOOL],
      tool_choice: { type: 'tool', name: 'submit_scan' },
      messages: [
        {
          role: 'user',
          content: [
            filePart,
            {
              type: 'text',
              text: `File name: ${input.fileName}\n\nUse the submit_scan tool to return structured metadata about this document.`,
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new AiUnavailableError(err, 'scanDocument');
  }

  return { ...scanDataFromSubmitScan(result, 'scanDocument'), readMethod: 'vision' };
}

/**
 * Turn a submit_scan tool call into a ScanData record.
 *
 * Shared by the vision path and the extracted-text path so the two cannot
 * drift. Everything that differs between them (how the file was read, and
 * whether it was read whole) is applied by the caller afterwards.
 *
 * Takes the whole message, not just its content, because the content alone
 * cannot say whether the model finished. When the output budget runs out the
 * API returns the fields the model completed and nothing for the rest, with
 * stop_reason set to max_tokens. The model fills the tool in schema order and
 * the summary sits near the end, so a cut-off fill used to be stored as a
 * scan with a dates list that simply stopped and "(no summary returned)" in
 * the one field that exports, packets and the review prompt all read. That
 * is not a reading of the document. Fail in the open, the way runReview does.
 */
function scanDataFromSubmitScan(
  message: Pick<Anthropic.Messages.Message, 'content' | 'stop_reason'>,
  context: string,
): ScanData {
  if (message.stop_reason === 'max_tokens') {
    throw new AiUnavailableError(
      new Error(`scan output exceeded ${SCAN_MAX_TOKENS} tokens`),
      `${context} truncated`,
    );
  }
  const content = message.content;
  const toolUse = content.find(
    (b): b is Extract<(typeof content)[number], { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_scan',
  );
  const data = (toolUse?.input ?? {}) as Record<string, unknown>;

  return {
    docType: stringField(data.docType) || 'other',
    identifiers: (data.identifiers && typeof data.identifiers === 'object'
      ? (data.identifiers as Record<string, string>)
      : {}) as Record<string, string>,
    parties: arrayField(data.parties),
    dates: Array.isArray(data.dates)
      ? (data.dates as { label?: string; value?: string }[])
          .map((d) => ({ label: stringField(d?.label), value: stringField(d?.value) }))
          .filter((d) => d.label || d.value)
      : [],
    jurisdiction: stringField(data.jurisdiction) || null,
    amounts: arrayField(data.amounts),
    statuteRefs: arrayField(data.statuteRefs),
    summary: stringField(data.summary) || '(no summary returned)',
    suggestedCategory: stringField(data.suggestedCategory) as ScanData['suggestedCategory'],
    scannedAt: new Date().toISOString(),
    modelUsed: MODEL,
  };
}

/**
 * Analyse text that was EXTRACTED from a file, rather than bytes a model can
 * look at.
 *
 * A spreadsheet and a Word document are not pictures, so the vision path
 * refuses them outright. lib/exhibit-text.ts pulls their text out first and
 * this reads that text into the same ScanData shape, through the same
 * submit_scan tool, so a workbook exhibit ends up as searchable as a photo of
 * a citation.
 *
 * THREE THINGS THIS FUNCTION IS RESPONSIBLE FOR, all of them about honesty:
 *
 *   1. The stored scan says it came from extracted text. `readMethod` and
 *      `readNote` both carry it, and `readNote` is shown on the exhibit row.
 *   2. A truncated read says so in the SUMMARY as well, because the summary
 *      is the field that travels into exports, packets and the review prompt.
 *      Silent truncation of evidence is the failure this guards against.
 *   3. With no API key it returns the same demo placeholder scanDocument
 *      returns, marked isDemo, so `isRealScan` refuses to store it.
 *
 * SCAN_SYSTEM is left untouched and still carries its cache_control breakpoint;
 * everything specific to reading extracted text goes in the user turn, so the
 * cached prefix is the same one the vision path warms.
 */
export async function scanExtractedText(input: {
  /** The extracted text. Must be non-empty; an empty file is a refusal. */
  text: string;
  fileName: string;
  /** How to name the source to the model and the reader, e.g. "spreadsheet". */
  sourceLabel: string;
  truncated: boolean;
  /** Present whenever `truncated` is true. Names what was left out. */
  truncationNote: string | null;
  /** The sentence stored on the scan about how it was read. */
  readNote: string;
}): Promise<ScanData> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      docType: 'other',
      identifiers: {},
      parties: [],
      dates: [],
      summary:
        'Demo response - ANTHROPIC_API_KEY not set; document was not actually scanned.',
      scannedAt: new Date().toISOString(),
      modelUsed: 'demo',
      isDemo: true,
    };
  }

  const text = input.text.trim();
  if (!text) {
    return {
      docType: 'other',
      identifiers: {},
      parties: [],
      dates: [],
      summary: `Nothing could be read out of this ${input.sourceLabel}.`,
      scannedAt: new Date().toISOString(),
      modelUsed: 'unsupported',
    };
  }

  const rules = [
    `The text below was extracted from a ${input.sourceLabel}. You are reading extracted text. You are not looking at the page.`,
    'Columns are separated by tab characters and rows by newlines. An empty column appears as nothing between two tabs and is still a column; never move a value into a neighbouring column.',
    "On a spreadsheet the first value on each line is that row's number in the file, and a gap in those numbers means a blank row, not a missing row.",
    'Dates already appear as YYYY-MM-DD. Repeat them exactly and do not restate them in another format.',
    'Report amounts exactly as they appear. Do not total, round, convert or reformat anything.',
    `Parties, dates and amounts are capped at ${SCAN_LIST_CAP} each. On a sheet with more rows than that, keep the first and last rows, any totals or balances, and the largest entries, name the payees or counterparties that appear most often, and say in the summary how many rows the sheet holds.`,
  ];
  if (input.truncated) {
    rules.push(
      `ONLY PART OF THIS FILE IS BELOW. ${input.truncationNote ?? ''} Do not describe the file as complete, and do not draw any conclusion about rows you cannot see.`.trim(),
    );
  }

  const userText = [
    `File name: ${input.fileName}`,
    '',
    rules.map((r) => `- ${r}`).join('\n'),
    '',
    '--- begin extracted text ---',
    text,
    '--- end extracted text ---',
    '',
    'Use the submit_scan tool to return structured metadata about this document.',
  ].join('\n');

  let result;
  try {
    result = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: SCAN_MAX_TOKENS,
      system: [{ type: 'text', text: SCAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [SCAN_TOOL],
      tool_choice: { type: 'tool', name: 'submit_scan' },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    });
  } catch (err) {
    throw new AiUnavailableError(err, 'scanExtractedText');
  }

  const scan = scanDataFromSubmitScan(result, 'scanExtractedText');
  return {
    ...scan,
    // The truncation warning leads the summary. The summary is what an export,
    // a packet and the review prompt all read, and a partial read presented as
    // a whole one is how a wrong number reaches a hearing.
    summary: input.truncated && input.truncationNote
      ? `${input.truncationNote} ${scan.summary}`
      : scan.summary,
    readMethod: 'extracted-text',
    readNote: input.readNote,
  };
}

/**
 * Whisper transcription. Accepts audio (mp3, m4a, wav, webm, ogg) AND video
 * (mp4, mov, mpeg) - Whisper will read the audio track from video. Returns
 * a ScanData record where transcript is populated and docType is set to
 * voice_note or video accordingly.
 *
 * Falls back to a demo placeholder unless openaiTranscriptionAllowed() says
 * yes, which needs BOTH a key and the sub-processor agreements flag. A key on
 * its own is deliberately not enough: see lib/subprocessor-gate.ts.
 */
export async function transcribeMedia(input: {
  fileBuffer: Buffer;
  mediaType: string;
  fileName: string;
}): Promise<ScanData> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const isVideo = input.mediaType.startsWith('video/');
  const docType = isVideo ? 'video' : 'voice_note';

  // The key alone is not permission. See lib/subprocessor-gate.ts: this call
  // sends the WHOLE recording to OpenAI and Advottic holds no DPA or BAA with
  // them, so setting a credential must not be the same act as agreeing to
  // send client evidence to a third party.
  //
  // The refusal copy no longer names an environment variable either. It was
  // shown to the person who uploaded the recording, and telling somebody
  // filing evidence in a legal matter to go and configure a server key is an
  // instruction they cannot act on and should not have been given.
  if (!openaiTranscriptionAllowed()) {
    if (apiKey) console.error(TRANSCRIPTION_GATE_LOG);
    return {
      docType,
      identifiers: {},
      parties: [],
      dates: [],
      summary: TRANSCRIPTION_UNAVAILABLE,
      transcript: '',
      scannedAt: new Date().toISOString(),
      modelUsed: 'unsupported',
      isDemo: true,
    };
  }

  // Whisper has a 25 MB limit. We don't slice or chunk - if larger, surface a
  // friendly error in the summary field so the UI can show it.
  const MAX = 25 * 1024 * 1024;
  if (input.fileBuffer.byteLength > MAX) {
    return {
      docType,
      identifiers: {},
      parties: [],
      dates: [],
      summary: `File is ${(input.fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB. Whisper's API caps at 25 MB - export a smaller / shorter clip and re-upload.`,
      transcript: '',
      scannedAt: new Date().toISOString(),
      modelUsed: 'whisper-1',
    };
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(input.fileBuffer)], { type: input.mediaType });
  form.append('file', blob, input.fileName);
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    // Network-level failure reaching OpenAI (timeout, DNS, socket).
    throw new AiUnavailableError(err, 'transcribeMedia');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // Log the raw provider text server-side, but surface only the calm,
    // branded copy. Pass the status + text so it's classified correctly
    // (e.g. 429 insufficient_quota -> "busy"/"unavailable").
    throw new AiUnavailableError(
      { status: res.status, message: errText.slice(0, 400) },
      'transcribeMedia',
    );
  }
  const json = (await res.json()) as { text?: string };
  const transcript = json.text ?? '';

  return {
    docType,
    identifiers: {},
    parties: [],
    dates: [],
    summary: transcript
      ? transcript.length <= 240
        ? transcript
        : transcript.slice(0, 240).trimEnd() + '…'
      : '(no speech detected)',
    transcript,
    suggestedCategory: isVideo ? 'Video' : 'Audio',
    scannedAt: new Date().toISOString(),
    modelUsed: 'whisper-1',
  };
}
