import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CASE_TYPES, type CaseType } from './types';
import type { AIReview, Case, Exhibit, ScanData } from './types';
import { AiUnavailableError, friendlyAiError } from './ai-errors';

const MODEL = 'claude-sonnet-4-6';
const FAST_MODEL = 'claude-haiku-4-5-20251001';

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
      r.summary =
        'Your Pro token balance is empty. Top up from /billing to run a fresh review on this case. Showing the example template below in the meantime.\n\n' +
        r.summary;
      return r;
    }
  } catch {
    // never block a review because the gate read failed
  }

  const exhibitsBlock =
    exhibits.length === 0
      ? '(none uploaded yet)'
      : exhibits
          .map(
            (e) =>
              `- ${e.label}: ${e.fileName}${e.description ? ` - ${e.description}` : ''} (${e.fileType})`,
          )
          .join('\n');

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
      max_tokens: 4000,
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

const SCAN_SYSTEM = `You are Advottic's document scanner. The user uploads a piece of evidence (commonly a ticket, citation, court summons, complaint, motion, eviction notice, demand letter, contract, or receipt) as an image or PDF, and you extract structured metadata so the case file is searchable.

Rules:
- Be terse and accurate. If a field is not visible in the document, omit it - never guess.
- Identifiers: only include the case/ticket/citation/file numbers actually printed on the document. Use snake_case keys: case_number, ticket_number, citation_number, court_file_number, license_plate, badge_number, etc.
- Parties: list named persons or organizations on the document (officer issuing, defendant, court, court clerk, plaintiff, landlord, tenant, etc.). One string per party.
- Dates: each date with a short human label and ISO date when possible (e.g., {label:"Issue date", value:"2026-04-15"}). If only month/year is shown, use YYYY-MM.
- Statute references: only verbatim citations from the document (e.g., "MN Stat. § 169.14"). Don't expand acronyms.
- Amounts: monetary values printed on the document, including the symbol or "USD" suffix when known.
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
        items: { type: 'string' },
        description: 'Named persons or organizations on the document.',
      },
      dates: {
        type: 'array',
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
        items: { type: 'string' },
        description: 'Monetary amounts printed on the document.',
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
      max_tokens: 2000,
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

  const toolUse = result.content.find(
    (b): b is Extract<(typeof result.content)[number], { type: 'tool_use' }> =>
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
 * Whisper transcription. Accepts audio (mp3, m4a, wav, webm, ogg) AND video
 * (mp4, mov, mpeg) - Whisper will read the audio track from video. Returns
 * a ScanData record where transcript is populated and docType is set to
 * voice_note or video accordingly. Falls back to a demo placeholder if
 * OPENAI_API_KEY is not configured.
 */
export async function transcribeMedia(input: {
  fileBuffer: Buffer;
  mediaType: string;
  fileName: string;
}): Promise<ScanData> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const isVideo = input.mediaType.startsWith('video/');
  const docType = isVideo ? 'video' : 'voice_note';

  if (!apiKey) {
    return {
      docType,
      identifiers: {},
      parties: [],
      dates: [],
      summary:
        'Transcription requires OPENAI_API_KEY in the server environment. Once it is set, click Transcribe to extract the spoken content.',
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
