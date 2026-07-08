import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractFileText } from './doc-review';
import { extractMediaMetadata } from './media-metadata';
import { mapsConfigured, geocodeAddress } from './maps';
import { parseEmail } from './email-parse';
import { safeStorageUpload } from './upload-safety';
import {
  analyzeImage,
  analyzeText,
  transcribeAudio,
  resolveSuggestedDate,
} from './timeline-ai';
import {
  isVisionAnalyzable,
  isEmailFile,
  kindFromMime,
  type AiExtracted,
  type TimelineMedia,
  type TimelineKind,
} from './timeline-types';

/** 50 MB / item, matching the timeline + firm document upload limits. */
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;

function safeName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120) || 'file';
}

/**
 * The shared evidence-analysis engine behind both the consumer timeline
 * (RLS-scoped, in timeline-actions.ts) and the firm evidence intake
 * (admin-scoped, in case-evidence-actions.ts). It is deliberately
 * persistence-agnostic: it downloads media with the admin storage client,
 * runs the reader over image / audio / document / EMAIL / free-text content,
 * folds in file metadata, geocodes places, and returns a ready-to-persist
 * column patch. Each caller writes that patch through whichever client its
 * access model requires.
 */

export const EXHIBITS_BUCKET = 'exhibits';

/**
 * The case facts the reader scores an item's relevance against. Kept small and
 * factual (no privileged strategy) so it is safe to send with each item.
 */
export type CaseContext = {
  title: string;
  subject: string | null;
  caseType: string | null;
  jurisdiction: string | null;
  description: string | null;
};

/** Minimal event shape the engine needs; both callers can build it. */
export type EventForAnalysis = {
  id: string;
  media: TimelineMedia[];
  description: string | null;
  kind: TimelineKind;
  occurredAt: string | null;
  title: string;
};

/** Load the case facts used for relevance scoring (admin read, firm-safe). */
export async function loadCaseContext(
  admin: SupabaseClient,
  caseId: string,
): Promise<CaseContext | null> {
  const { data } = await admin
    .from('cases')
    .select('title, subject_name, case_type, jurisdiction_state, jurisdiction_country, description')
    .eq('id', caseId)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    title: string;
    subject_name: string | null;
    case_type: string | null;
    jurisdiction_state: string | null;
    jurisdiction_country: string | null;
    description: string | null;
  };
  const jurisdiction = [r.jurisdiction_state, r.jurisdiction_country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ') || null;
  return {
    title: r.title,
    subject: r.subject_name,
    caseType: r.case_type,
    jurisdiction,
    description: r.description,
  };
}

type CoreResult = { extracted: AiExtracted; summary: string } | { error: string };

/** Merge parsed-email header facts over an AI text analysis (headers win). */
function mergeEmail(base: AiExtracted, email: Partial<AiExtracted>): AiExtracted {
  return {
    ...base,
    ...email,
    // Union the people/dates/orgs the reader found in the body with the header facts.
    detected_people: dedupe([...(email.detected_people ?? []), ...(base.detected_people ?? [])]),
    detected_dates: dedupe([...(email.detected_dates ?? []), ...(base.detected_dates ?? [])]),
    organizations: dedupe([...(email.organizations ?? []), ...(base.organizations ?? [])]),
    // Prefer the reader's relevance/summary-derived fields (already on base).
    relevance_score: base.relevance_score,
    relevance_reason: base.relevance_reason,
    ocr_text: email.ocr_text || base.ocr_text,
  };
}

function dedupe(list: (string | null | undefined)[]): string[] {
  return [...new Set(list.map((s) => (s ?? '').trim()).filter(Boolean))];
}

/**
 * Analyse one event's content and return a column patch ready to persist. Never
 * throws; on failure returns a patch that records the error status so the row
 * doesn't stick in 'running'. `admin` is used only for storage downloads and
 * (optionally) forensic metadata, never for the write.
 */
export async function computeEventAnalysis(input: {
  ev: EventForAnalysis;
  admin: SupabaseClient | null;
  caseContext: CaseContext | null;
}): Promise<{ ok: boolean; patch: Record<string, unknown>; error?: string }> {
  const { ev, admin, caseContext } = input;

  let result: CoreResult;
  let metaSource: { buf: Buffer; mime: string; name: string } | null = null;
  let emailError: string | undefined;

  const email = ev.media.find((m) => isEmailFile(m.mime, m.name));
  const img = ev.media.find((m) => isVisionAnalyzable(m.mime));
  const doc = ev.media.find((m) => /pdf|word|officedocument|text\//.test(m.mime));
  const audio = ev.media.find((m) => /^audio\//.test(m.mime));

  try {
    if (email && admin) {
      const dl = await admin.storage.from(EXHIBITS_BUCKET).download(email.path);
      const buf = Buffer.from(await (dl.data as Blob).arrayBuffer());
      const parsed = await parseEmail(buf, email.name, email.mime);
      emailError = parsed.error;
      const base = parsed.text
        ? `${parsed.text}${ev.description ? `\n\nSubmitter note: ${ev.description}` : ''}`
        : ev.description ?? '';
      const ai = base
        ? await analyzeText({ text: base, userContext: ev.description, kind: 'message', caseContext })
        : { error: parsed.error ?? 'This email had no readable content.' };
      if ('extracted' in ai) {
        result = { extracted: mergeEmail(ai.extracted, parsed.extracted), summary: ai.summary };
      } else {
        // Even if the reader is unavailable, keep the header facts we parsed.
        result = parsed.text || parsed.extracted.email
          ? { extracted: parsed.extracted as AiExtracted, summary: '' }
          : ai;
      }
    } else if (img && admin) {
      const dl = await admin.storage.from(EXHIBITS_BUCKET).download(img.path);
      const buf = Buffer.from(await (dl.data as Blob).arrayBuffer());
      metaSource = { buf, mime: img.mime, name: img.name };
      result = await analyzeImage({ buffer: buf, mime: img.mime, userContext: ev.description, kind: ev.kind, caseContext });
    } else if (audio && admin) {
      const dl = await admin.storage.from(EXHIBITS_BUCKET).download(audio.path);
      const buf = Buffer.from(await (dl.data as Blob).arrayBuffer());
      const tr = await transcribeAudio({ buffer: buf, filename: audio.name, mime: audio.mime });
      const body = tr.text
        ? `Transcript of the voice note:\n${tr.text}`
        : `${ev.description ?? ''}`.trim();
      result = body
        ? await analyzeText({ text: body, userContext: ev.description, kind: ev.kind, caseContext })
        : { error: tr.configured ? 'No speech could be transcribed.' : 'Voice transcription is not configured; add a description so it can be analysed.' };
      if ('extracted' in result && tr.text) result.extracted.ocr_text = tr.text;
    } else if (doc && admin) {
      const dl = await admin.storage.from(EXHIBITS_BUCKET).download(doc.path);
      const buf = Buffer.from(await (dl.data as Blob).arrayBuffer());
      metaSource = { buf, mime: doc.mime, name: doc.name };
      const file = new File([new Uint8Array(buf)], doc.name, { type: doc.mime });
      const ext = await extractFileText(file);
      result = ext.text.trim()
        ? await analyzeText({ text: ext.text, userContext: ev.description, kind: ev.kind, caseContext })
        : { error: ext.error ?? 'Could not read text from this document.' };
    } else if (ev.description) {
      result = await analyzeText({ text: ev.description, userContext: null, kind: ev.kind, caseContext });
    } else {
      result = { error: 'Nothing to analyse - add a file or a description.' };
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : 'Analysis failed.' };
  }

  // Forensic core details straight from the file (EXIF/GPS/device for images,
  // authoring metadata for PDFs). Best-effort; merged into the analysis.
  if (!('error' in result) && metaSource) {
    try {
      const meta = await extractMediaMetadata(metaSource.buf, metaSource.mime, metaSource.name);
      if (meta.fields.length) result.extracted.metadata = meta.fields;
      if (meta.gps) result.extracted.metadata_gps = meta.gps;
    } catch {
      /* metadata is best-effort */
    }
  }

  // Map pins: the file's own GPS plus any named places we can geocode. A no-op
  // until the Maps key is present, and never fails the analysis.
  if (!('error' in result) && mapsConfigured()) {
    try {
      const points: NonNullable<AiExtracted['geo_points']> = [];
      const gps = result.extracted.metadata_gps;
      if (gps) points.push({ lat: gps.lat, lng: gps.lng, label: 'File GPS', source: 'gps' });
      const places = (result.extracted.locations ?? []).slice(0, 4);
      for (const place of places) {
        const at = await geocodeAddress(place);
        if (at) points.push({ lat: at.lat, lng: at.lng, label: place.slice(0, 80), source: 'place' });
      }
      if (points.length) result.extracted.geo_points = points;
    } catch {
      /* geocoding is best-effort */
    }
  }

  if ('error' in result) {
    return { ok: false, error: result.error, patch: { ai_status: 'error', ai_error: result.error } };
  }

  const patch: Record<string, unknown> = {
    ai_status: 'done',
    ai_error: emailError ?? null,
    ai_summary: result.summary,
    ai_extracted: result.extracted,
    updated_at: new Date().toISOString(),
  };
  if (!ev.occurredAt) {
    const s = resolveSuggestedDate(result.extracted);
    if (s.occurredAt) {
      patch.occurred_at = s.occurredAt;
      patch.occurred_precision = s.precision;
    }
  }
  if (!ev.title && result.extracted.suggested_title) {
    patch.title = result.extracted.suggested_title.slice(0, 200);
  }
  return { ok: true, patch };
}

/**
 * Upload one buffer into the exhibits bucket and create a case_timeline_events
 * row for it (optionally analysing it inline), all through the admin client.
 * This is the firm-scoped counterpart of createTimelineEvent: callers gate on
 * firm membership + case ownership BEFORE calling this, since it bypasses RLS.
 * Used by both the bulk uploader and the projects "pull files into case" path.
 */
export async function importFileAsCaseEvidence(input: {
  admin: SupabaseClient;
  caseId: string;
  userId: string;
  buffer: Buffer;
  name: string;
  mime: string;
  sourceLabel?: string | null;
  description?: string | null;
  /** Run analysis inline (firm plan + AI configured). */
  analyze: boolean;
  caseContext?: CaseContext | null;
}): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  const { admin, caseId, userId } = input;
  if (input.buffer.length > MAX_EVIDENCE_BYTES) {
    return { ok: false, error: `"${input.name}" is over the 50 MB limit.` };
  }
  const eventId = crypto.randomUUID();
  const mime = input.mime || 'application/octet-stream';
  const path = `${userId}/${caseId}/timeline/${eventId}/${safeName(input.name)}`;

  const uploaded = await safeStorageUpload({
    client: admin,
    bucket: EXHIBITS_BUCKET,
    path,
    buffer: input.buffer,
    declaredMime: mime,
    maxBytes: MAX_EVIDENCE_BYTES,
  });
  if (!uploaded.ok) return { ok: false, error: `Upload failed: ${uploaded.error}` };

  const media: TimelineMedia[] = [{ path, mime, name: input.name, size: input.buffer.length }];
  const kind = kindFromMime(mime, input.name);

  const { error: insErr } = await admin.from('case_timeline_events').insert({
    id: eventId,
    case_id: caseId,
    created_by: userId,
    kind,
    title: '',
    description: input.description ?? null,
    media,
    source_label: input.sourceLabel ?? null,
    ai_status: input.analyze ? 'pending' : 'skipped',
  });
  if (insErr) {
    await admin.storage.from(EXHIBITS_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: insErr.message };
  }

  if (input.analyze) {
    await admin.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', eventId);
    const outcome = await computeEventAnalysis({
      ev: { id: eventId, media, description: input.description ?? null, kind, occurredAt: null, title: '' },
      admin,
      caseContext: input.caseContext ?? null,
    });
    await admin.from('case_timeline_events').update(outcome.patch).eq('id', eventId);
  }

  return { ok: true, eventId };
}
