import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { AiExtracted, OccurredPrecision, TimelineKind } from './timeline-types';

/**
 * Timeline AI engine (Bella). Uses the multimodal model to OCR an image,
 * extract the date it likely occurred, detect the people present, and — for a
 * chat / group-chat screenshot — parse who sent and received each message. It
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
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

const IMAGE_MEDIA_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

const ANALYSIS_INSTRUCTIONS = `You are Bella, Advottic's evidence analyst. You examine a single piece of a person's evidence for a legal timeline. Be precise, neutral, and factual — never dramatize, never invent. If something is unreadable or absent, say so; do not guess identities.

Return ONLY a JSON object with this exact shape:
{
  "ocr_text": "all legible text, verbatim (empty string if none)",
  "detected_dates": ["EVERY distinct date visible in or implied by the content, ISO where possible, e.g. 2023-03-14 or 'March 2023' — do not omit any"],
  "detected_people": ["each distinct person visible or named; use the name/handle if legible, otherwise a neutral descriptor like 'man in blue jacket'"],
  "locations": ["every place, street address, city, venue, or location named or visible — full street addresses verbatim where present"],
  "organizations": ["every company, agency, court, bank, landlord, or other organization named"],
  "message_thread": {              // ONLY if this is a chat / SMS / group-chat screenshot, else null
    "platform": "WhatsApp | iMessage | SMS | Instagram | unknown",
    "participants": ["names/handles"],
    "messages": [ { "sender": "name/handle or null", "recipient": "name/handle or null", "timestamp": "as shown or null", "body": "message text" } ]
  },
  "objects": ["notable objects/scene details relevant as evidence"],
  "suggested_title": "a short, neutral title for this timeline entry",
  "suggested_occurred_at": "the single most likely date this happened, ISO (YYYY-MM-DD) or null",
  "suggested_precision": "exact | day | month | year | unknown",
  "confidence": "high | medium | low",
  "summary": "2-4 neutral sentences: what this item is and what it factually shows, suitable for an attorney."
}
Rules: Do NOT claim to recognize a person's identity by their face; only report names/handles that are actually written in the content, otherwise describe them. Keep everything court-appropriate and non-speculative.`;

type RawAnalysis = AiExtracted & { summary?: string };

/** Analyse an image item (photo, receipt, chat screenshot) with vision + OCR. */
export async function analyzeImage(input: {
  buffer: Buffer;
  mime: string;
  userContext: string | null;
  kind: TimelineKind;
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
      max_tokens: 2000,
      system: ANALYSIS_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: input.buffer.toString('base64') },
            },
            { type: 'text', text: `${ctx}\nThis item is categorised as a ${input.kind}. Analyse it.` },
          ],
        },
      ],
    });
    const parsed = parseJson<RawAnalysis>(textFrom(res));
    if (!parsed) return { error: 'Analysis returned an unreadable result.' };
    const { summary = '', ...extracted } = parsed;
    return { extracted, summary: String(summary).trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Analysis failed.' };
  }
}

/** Analyse a text item (a document's extracted text, or a pasted note). */
export async function analyzeText(input: {
  text: string;
  userContext: string | null;
  kind: TimelineKind;
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
      max_tokens: 2000,
      system: ANALYSIS_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: `${ctx}\nThis item is a ${input.kind}. Analyse the following content:\n\n${body}`,
        },
      ],
    });
    const parsed = parseJson<RawAnalysis>(textFrom(res));
    if (!parsed) return { error: 'Analysis returned an unreadable result.' };
    const { summary = '', ...extracted } = parsed;
    return { extracted, summary: String(summary).trim() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Analysis failed.' };
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
      return { configured: true, text: null, error: `Transcription failed (${res.status}).` };
    }
    const data = (await res.json()) as { text?: string };
    return { configured: true, text: (data.text ?? '').trim() || null };
  } catch (err) {
    return { configured: true, text: null, error: err instanceof Error ? err.message : 'Transcription error.' };
  }
}

/**
 * Placeholder hook for a dedicated biometric face-recognition provider (AWS
 * Rekognition / face-api). Not wired by default — Bella's detected_people +
 * user tagging cover people-association today. Returns null so callers can
 * treat "no provider" uniformly.
 */
export async function detectFacesHook(): Promise<null> {
  return null;
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
}): Promise<{ summary: string; narrative: string; conclusion: string } | { error: string }> {
  const c = client();
  if (!c) return { error: 'AI is not configured (missing API key).' };
  const lines = input.entries
    .map(
      (e, i) =>
        `${i + 1}. [${e.when}] (${e.kind}) ${e.title}${e.people.length ? ` — people: ${e.people.join(', ')}` : ''}\n   Context: ${e.context ?? '—'}\n   Analysis: ${e.summary ?? '—'}`,
    )
    .join('\n');

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: `You are Bella, Advottic's evidence analyst, preparing a timeline document that may be attached to a court filing as an exhibit. Write in neutral, factual, professional English. Base every statement ONLY on the entries provided; never invent facts, dates, or identities. This is a factual chronology and reasoned summary — it is NOT legal advice, and you must not present it as such.

Return ONLY JSON:
{
  "summary": "a 3-5 sentence executive overview of what this evidence, taken together, establishes",
  "narrative": "a clear chronological account tying the entries together in order, referencing entry numbers and dates; several short paragraphs",
  "conclusion": "a measured conclusion of what the timeline tends to show, with appropriate caveats about gaps or undated items"
}`,
      messages: [
        {
          role: 'user',
          content: `Case: "${input.caseTitle}"\nHere are the timeline entries in chronological order:\n\n${lines}\n\nProduce the JSON.`,
        },
      ],
    });
    const parsed = parseJson<{ summary?: string; narrative?: string; conclusion?: string }>(textFrom(res));
    if (!parsed) return { error: 'The narrative came back unreadable.' };
    return {
      summary: String(parsed.summary ?? '').trim(),
      narrative: String(parsed.narrative ?? '').trim(),
      conclusion: String(parsed.conclusion ?? '').trim(),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Narrative generation failed.' };
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
