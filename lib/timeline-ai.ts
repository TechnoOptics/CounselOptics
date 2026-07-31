import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { DOCUMENT_TYPES, EVIDENCE_FOLDERS, normalizeDocumentType, normalizeFolder, type AiExtracted, type OccurredPrecision, type TimelineKind } from './timeline-types';
import { friendlyAiError } from './ai-errors';
// Type-only import (erased at runtime, so no import cycle with case-evidence).
import type { CaseContext } from './case-evidence';

/**
 * Timeline AI engine (Bella). Uses the multimodal model to OCR an image,
 * extract the date it likely occurred, detect the people present, and, for a
 * chat / group-chat screenshot, parse who sent and received each message. It
 * also builds the chronological narrative + reasoned conclusion for the export.
 *
 * Honesty notes baked into the prompts: the model READS names/handles visible
 * in the content and DESCRIBES the people it sees; it never claims biometric
 * identity matching across photos. The user confirms/associates people, and a
 * real face-recognition provider can be layered on later via detectFacesHook().
 */

const MODEL = 'claude-sonnet-4-6';

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function textFrom(res: Anthropic.Messages.Message): string {
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Extract the first JSON object from a model reply (which may wrap it in prose). */
function parseJson<T>(raw: string): T | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  const body = raw.slice(start);
  // Fast path: a well-formed object spanning the first { to the last }.
  const greedy = body.match(/^[\s\S]*\}/);
  if (greedy) {
    try {
      return JSON.parse(greedy[0]) as T;
    } catch {
      /* fall through to the repair path */
    }
  }
  // Repair path. LLM replies break in two recurring ways when a field holds
  // verbatim OCR or message text: (1) unescaped double quotes inside a string
  // value (e.g. a good "tune up" and), which derail JSON.parse, and (2) the
  // reply is cut off at the output-token cap, leaving brackets open. Escape the
  // stray quotes and control characters, then close anything still open, so a
  // dense evidence screenshot yields a usable analysis instead of a hard fail.
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

/**
 * Escape stray characters that make an LLM's JSON invalid without changing its
 * structure: double quotes that appear inside a string value (detected by the
 * absence of a following structural character) and raw control characters that
 * are illegal inside JSON strings. Structurally-valid input passes through with
 * the same meaning; only in-string offenders are escaped.
 */
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
      // A closing quote is followed (past whitespace) by a structural token;
      // anything else is an unescaped quote sitting inside the string value.
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

/**
 * Best-effort recovery of a JSON object that was truncated mid-write. Walks the
 * text tracking string state and bracket depth, trims back to the last complete
 * value, then appends the closing brackets that were never emitted. Returns null
 * when the object is actually balanced (nothing to repair) or unrecoverable.
 */
function closeTruncatedJson(s: string): string | null {
  let inStr = false;
  let esc = false;
  let depth = 0;
  let lastSafe = -1; // index of the last comma/close that ends a complete value
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
  // Drop the half-written trailing value (and any comma that preceded it).
  const cut = s.slice(0, lastSafe + 1).replace(/,\s*$/, '');
  // Recompute the open brackets over the cut text and close them in reverse.
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

const IMAGE_MEDIA_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

const ANALYSIS_INSTRUCTIONS = `You are a neutral evidence analyst examining a single piece of a person's evidence for a legal timeline. Be precise, neutral, and factual. Never dramatize, never invent. If something is unreadable or absent, say so; do not guess identities.

Return ONLY a JSON object with this exact shape:
{
  "ocr_text": "all legible text, verbatim (empty string if none)",
  "detected_dates": ["EVERY distinct date visible in or implied by the content, ISO where possible, e.g. 2023-03-14 or 'March 2023'. Do not omit any"],
  "detected_people": ["each distinct person visible or named; use the name/handle if legible, otherwise a neutral descriptor like 'man in blue jacket'"],
  "locations": ["every place, street address, city, venue, or location named or visible. Full street addresses verbatim where present"],
  "organizations": ["every company, agency, court, bank, landlord, or other organization named"],
  "message_thread": {              // ONLY if this is a chat / SMS / group-chat screenshot, else null
    "platform": "WhatsApp | iMessage | SMS | Instagram | unknown",
    "participants": ["names/handles"],
    "messages": [ { "sender": "name/handle or null", "recipient": "name/handle or null", "timestamp": "as shown or null", "body": "message text" } ]
  },
  "objects": ["notable objects/scene details relevant as evidence"],
  "folder": "the single best-fit general folder for this item, chosen from EXACTLY this list: ${EVIDENCE_FOLDERS.join(' | ')}",
  "document_type": "the single best-fit content type of what this item DEPICTS (not the file format), chosen from EXACTLY this list, or null if none fit: ${DOCUMENT_TYPES.join(' | ')}. For example a photo of a paper receipt is 'receipt', a scan of a driver license is 'drivers_license', a signed contract is 'contract'",
  "suggested_title": "a short, neutral title for this timeline entry",
  "suggested_occurred_at": "the single most likely date this happened, ISO (YYYY-MM-DD) or null",
  "suggested_precision": "exact | day | month | year | unknown",
  "confidence": "high | medium | low",
  "relevance_score": "integer 0 to 100: how relevant this item is to the SPECIFIC case described under CASE CONTEXT, if one is provided; null when no case context is given",
  "relevance_reason": "one neutral sentence explaining the relevance score (empty string when no case context is given)",
  "summary": "2 to 4 neutral sentences describing the SCENE and what is happening: for a photo or video, say plainly what is depicted (who, where, what action, notable objects or damage); for a document or message, say what it is and what it states. Then note anything else that could matter to the case. Written factually for an attorney."
}
Rules: For a photo or video, always describe the scene concretely in the summary (setting, people present and what they are doing, visible objects, condition or damage, any text on signs or screens) so a reader who cannot see the image understands what it shows. Capture anything else that could be relevant to the case, even if it does not fit a named field, in the summary. Do NOT claim to recognize a person's identity by their face; only report names/handles that are actually written in the content, otherwise describe them. Always set "folder" to one of the seven listed values, never invent a new one. Keep everything court-appropriate and non-speculative. When CASE CONTEXT is given, judge relevance by how directly this item bears on that case's parties, facts, dates, and claims: a high score (67 to 100) means it clearly concerns the case; a low score (0 to 33) means it is unrelated or only incidentally connected. Never use em dashes or en dashes in any text you write; use commas, periods, colons, or parentheses instead. Do not refer to yourself, to any assistant, or to AI; write as a neutral case analyst.`;

/** A compact, factual block of the case's facts for relevance scoring. */
function caseContextBlock(cc: CaseContext | null | undefined): string {
  if (!cc) return '';
  const facts = [
    `Title: ${cc.title}`,
    cc.subject ? `Subject: ${cc.subject}` : '',
    cc.caseType ? `Case type: ${cc.caseType}` : '',
    cc.jurisdiction ? `Jurisdiction: ${cc.jurisdiction}` : '',
    cc.description ? `Description: ${cc.description.slice(0, 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `\n\nCASE CONTEXT (score this item's relevance to THIS case):\n${facts}\n`;
}

/**
 * Normalise the model's relevance fields into a clamped integer + cleaned
 * sentence (or drop them when unscored), so callers can trust the shape.
 */
function normalizeRelevance(extracted: AiExtracted): void {
  const raw = (extracted as { relevance_score?: unknown }).relevance_score;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(n)) {
    extracted.relevance_score = Math.max(0, Math.min(100, Math.round(n)));
    extracted.relevance_reason = cleanAiText(extracted.relevance_reason) || undefined;
  } else {
    delete extracted.relevance_score;
    delete extracted.relevance_reason;
  }
}

/**
 * Finalise the model's structured fields: clamp relevance and snap the chosen
 * folder onto the controlled taxonomy (dropping it when the reader returned
 * nothing usable, so folderForEvent's kind-based default takes over).
 */
function normalizeExtracted(extracted: AiExtracted): void {
  normalizeRelevance(extracted);
  const folder = normalizeFolder(extracted.folder);
  if (folder) extracted.folder = folder;
  else delete extracted.folder;
  const docType = normalizeDocumentType(extracted.document_type);
  if (docType) extracted.document_type = docType;
  else delete extracted.document_type;
}

/**
 * Strip AI "tells" from model output before it is stored or shown: em/en dashes
 * (a common giveaway) become plain punctuation, and any self-reference to an
 * assistant/AI is neutralised. Keeps output reading as a human case analyst's.
 */
export function cleanAiText(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/\s*[—―]\s*/g, ', ') // em dash / horizontal bar -> ", "
    .replace(/\s*–\s*/g, ' to ')        // en dash -> " to " (usually a range)
    .replace(/‒/g, '-')                  // figure dash -> hyphen
    .replace(/\b(as an? (?:AI|assistant|language model)[^.]*\.)/gi, '')
    .replace(/\bI'?m Bella\b/gi, '')
    .replace(/  +/g, ' ')
    .trim();
}

type RawAnalysis = AiExtracted & { summary?: string };

/** Analyse an image item (photo, receipt, chat screenshot) with vision + OCR. */
export async function analyzeImage(input: {
  buffer: Buffer;
  mime: string;
  userContext: string | null;
  kind: TimelineKind;
  caseContext?: CaseContext | null;
}): Promise<{ extracted: AiExtracted; summary: string } | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const mediaType = IMAGE_MEDIA_TYPES[input.mime.toLowerCase()];
  if (!mediaType) return { error: 'This image type cannot be analysed.' };

  const ctx = input.userContext?.trim()
    ? `The person who submitted this describes it as: "${input.userContext.trim()}". Use this as context but rely on what you actually observe.`
    : 'No description was provided; rely on what you observe.';

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: ANALYSIS_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: input.buffer.toString('base64') },
            },
            { type: 'text', text: `${ctx}\nThis item is categorised as a ${input.kind}. Analyse it. In the summary, describe the scene concretely: what is depicted, who is present and what they are doing, the setting, notable objects, any visible condition or damage, and any legible text.${caseContextBlock(input.caseContext)}` },
          ],
        },
      ],
    });
    const parsed = parseJson<RawAnalysis>(textFrom(res));
    if (!parsed) return { error: 'Analysis returned an unreadable result.' };
    const { summary = '', ...extracted } = parsed;
    normalizeExtracted(extracted);
    return { extracted, summary: cleanAiText(summary) };
  } catch (err) {
    return { error: friendlyAiError(err, 'analyzeImage') };
  }
}

/** Analyse a text item (a document's extracted text, or a pasted note). */
export async function analyzeText(input: {
  text: string;
  userContext: string | null;
  kind: TimelineKind;
  caseContext?: CaseContext | null;
}): Promise<{ extracted: AiExtracted; summary: string } | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const body = input.text.slice(0, 60_000);
  const ctx = input.userContext?.trim()
    ? `Submitter's description: "${input.userContext.trim()}".`
    : '';
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: ANALYSIS_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: `${ctx}\nThis item is a ${input.kind}. Analyse the following content:\n\n${body}${caseContextBlock(input.caseContext)}`,
        },
      ],
    });
    const parsed = parseJson<RawAnalysis>(textFrom(res));
    if (!parsed) return { error: 'Analysis returned an unreadable result.' };
    const { summary = '', ...extracted } = parsed;
    normalizeExtracted(extracted);
    return { extracted, summary: cleanAiText(summary) };
  } catch (err) {
    return { error: friendlyAiError(err, 'analyzeText') };
  }
}

/**
 * Transcribe a voice note / audio track. Env-gated on OPENAI_API_KEY (Whisper);
 * returns { configured:false } cleanly when no provider is wired, so the
 * feature degrades to "attach + describe" rather than breaking.
 */
export async function transcribeAudio(input: {
  buffer: Buffer;
  filename: string;
  mime: string;
}): Promise<{ configured: boolean; text: string | null; error?: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { configured: false, text: null };
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mime || 'audio/mpeg' }),
      input.filename || 'audio',
    );
    form.append('model', 'whisper-1');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        configured: true,
        text: null,
        error: friendlyAiError(
          { status: res.status, message: errText.slice(0, 400) },
          'transcribeAudio',
        ),
      };
    }
    const data = (await res.json()) as { text?: string };
    return { configured: true, text: (data.text ?? '').trim() || null };
  } catch (err) {
    return { configured: true, text: null, error: friendlyAiError(err, 'transcribeAudio') };
  }
}

/**
 * Hook into the SELF-HOSTED recurring-face engine. This is the single seam the
 * evidence pipeline uses to turn one image's bytes into face boxes + embeddings.
 * It runs entirely on Advottic infrastructure (no third-party face API) and is
 * recurrence-only: it never asserts who a person is. It fails closed to null
 * when the model is not provisioned, so callers can treat "no faces" uniformly.
 *
 * Callers MUST have already confirmed the firm's opt-in before calling this;
 * the gate lives in lib/face-settings.ts, not here. See docs/face-detection-spike.md.
 */
export async function detectFacesHook(
  buffer: Buffer,
  mime: string,
): Promise<import('./face-detect').DetectedFace[] | null> {
  const { detectFaces } = await import('./face-detect');
  const faces = await detectFaces(buffer, mime);
  return faces.length ? faces : null;
}

/** Build the chronological narrative + reasoned conclusion for the export. */
export async function buildNarrative(input: {
  caseTitle: string;
  entries: Array<{
    when: string;
    kind: string;
    title: string;
    context: string | null;
    summary: string | null;
    people: string[];
  }>;
  /** Authoritative, client-verified facts the narrative must respect (e.g. the
   *  subject's official employment dates), so it does not misread an entry. */
  context?: string;
}): Promise<{ summary: string; narrative: string; conclusion: string } | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const lines = input.entries
    .map(
      (e, i) =>
        `${i + 1}. [${e.when}] (${e.kind}) ${e.title}${e.people.length ? `, people: ${e.people.join(', ')}` : ''}\n   Context: ${e.context ?? '(none)'}\n   Findings: ${e.summary ?? '(none)'}`,
    )
    .join('\n');

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: `You are a neutral evidence analyst preparing a timeline document that may be attached to a court filing as an exhibit. Write in neutral, factual, professional English. Base every statement ONLY on the entries provided; never invent facts, dates, or identities. This is a factual chronology and reasoned summary. It is NOT legal advice, and you must not present it as such. Never use em dashes or en dashes; use commas, periods, colons, or parentheses. Do not refer to yourself, to any assistant, or to AI.

Return ONLY JSON:
{
  "summary": "a 3 to 5 sentence executive overview of what this evidence, taken together, establishes",
  "narrative": "a clear chronological account tying the entries together in order, referencing entry numbers and dates; several short paragraphs",
  "conclusion": "a measured conclusion of what the timeline tends to show, with appropriate caveats about gaps or undated items"
}`,
      messages: [
        {
          role: 'user',
          content: `Case: "${input.caseTitle}"${input.context ? `\n\nAUTHORITATIVE CONTEXT (client-verified; weave in and never contradict): ${input.context}` : ''}\nHere are the timeline entries in chronological order:\n\n${lines}\n\nProduce the JSON.`,
        },
      ],
    });
    const parsed = parseJson<{ summary?: string; narrative?: string; conclusion?: string }>(textFrom(res));
    if (!parsed) return { error: 'The narrative came back unreadable.' };
    return {
      summary: cleanAiText(parsed.summary),
      narrative: cleanAiText(parsed.narrative),
      conclusion: cleanAiText(parsed.conclusion),
    };
  } catch (err) {
    return { error: friendlyAiError(err, 'buildNarrative') };
  }
}

/** Reconcile Bella's suggested date/precision into concrete values for a row. */
export function resolveSuggestedDate(
  extracted: AiExtracted,
): { occurredAt: string | null; precision: OccurredPrecision } {
  const raw = extracted.suggested_occurred_at;
  if (!raw) return { occurredAt: null, precision: 'unknown' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { occurredAt: null, precision: 'unknown' };
  return { occurredAt: d.toISOString(), precision: extracted.suggested_precision ?? 'day' };
}
