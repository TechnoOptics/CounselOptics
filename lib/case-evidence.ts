import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractFileText } from './doc-review';
import { extractMediaMetadata } from './media-metadata';
import { mapsConfigured, geocodeAddress } from './maps';
import { parseEmail } from './email-parse';
import { perceptualHash } from './perceptual-hash';
import { friendlyAiError } from './ai-errors';
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

/** Hex SHA-256 of a file's bytes, used for duplicate detection at import. */
export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Carry the "sticky" ai_extracted fields, ones assigned once and never derived
 * by the reader, across a re-analysis that otherwise replaces ai_extracted with
 * a fresh object. Covers the stable exhibit number, the content hash, and a
 * hand-pinned folder. Every analysis write-path funnels its fresh extraction
 * through this so re-scoring never drops an exhibit number, a hash, or a
 * deliberately filed folder. `prior` is the row's ai_extracted before the run.
 */
export function mergeStickyExtracted(
  next: AiExtracted | undefined,
  prior: AiExtracted | null | undefined,
): AiExtracted {
  const out: AiExtracted = { ...(next ?? {}) };
  const p = prior ?? {};
  if (typeof p.exhibit_no === 'number' && out.exhibit_no === undefined) out.exhibit_no = p.exhibit_no;
  if (p.sha256 && !out.sha256) out.sha256 = p.sha256;
  if (p.phash && !out.phash) out.phash = p.phash;
  if (p.folder_locked && p.folder) {
    out.folder = p.folder;
    out.folder_locked = true;
  }
  // The firm's on/off-the-timeline choice is deliberate and must survive a
  // re-score (which otherwise replaces ai_extracted with a fresh object).
  if (typeof p.on_timeline === 'boolean' && out.on_timeline === undefined) {
    out.on_timeline = p.on_timeline;
  }
  return out;
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
    // Any failure downloading/parsing the file or calling the model.
    // friendlyAiError keeps provider JSON (and internal detail) out of
    // the ai_error we persist and later show in the UI.
    result = { error: friendlyAiError(err, 'computeEventAnalysis') };
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
    // Perceptual hash for images (near-duplicate detection). Computed here, on
    // the buffer already downloaded for analysis, so it stays OFF the upload hot
    // path (where it slowed bulk intake and caused batch timeouts).
    if (/^image\//i.test(metaSource.mime)) {
      try {
        const ph = await perceptualHash(metaSource.buf);
        if (ph) result.extracted.phash = ph;
      } catch {
        /* phash is best-effort */
      }
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
  /** Stable per-matter exhibit number to stamp on this item at import. */
  exhibitNo?: number;
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

  // Seed the sticky fields at insert: the content hash (for duplicate detection)
  // and the stable exhibit number. Both survive later re-analysis via
  // mergeStickyExtracted, so they are assigned exactly once. New evidence starts
  // OFF the timeline (on_timeline: false); the firm adds items to the chronology
  // explicitly, so a bulk intake never floods the timeline.
  // Seed only the cheap sticky fields at upload (content hash + exhibit number).
  // The perceptual hash (a sharp decode) is computed later during analysis, not
  // here, so a bulk intake isn't slowed file-by-file and doesn't time out.
  const seededExtracted: AiExtracted = { sha256: sha256Hex(input.buffer), on_timeline: false };
  if (typeof input.exhibitNo === 'number') seededExtracted.exhibit_no = input.exhibitNo;

  const { error: insErr } = await admin.from('case_timeline_events').insert({
    id: eventId,
    case_id: caseId,
    created_by: userId,
    kind,
    title: '',
    description: input.description ?? null,
    media,
    source_label: input.sourceLabel ?? null,
    ai_extracted: seededExtracted,
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
    // Re-analysis returns a fresh ai_extracted; carry the seeded sticky fields.
    if (outcome.ok && outcome.patch.ai_extracted) {
      outcome.patch.ai_extracted = mergeStickyExtracted(
        outcome.patch.ai_extracted as AiExtracted,
        seededExtracted,
      );
    }
    await admin.from('case_timeline_events').update(outcome.patch).eq('id', eventId);
  }

  return { ok: true, eventId };
}

/** A pending row the background worker will score, in engine-native shape. */
type PendingRow = {
  id: string;
  case_id: string;
  kind: TimelineKind;
  title: string | null;
  description: string | null;
  media: TimelineMedia[] | null;
  occurred_at: string | null;
  ai_extracted: AiExtracted | null;
};

/**
 * Background sweep that scores the evidence rows a deferred bulk import left
 * with ai_status 'skipped', plus rows stuck in 'running' past a stale cutoff (a
 * client that closed its tab mid-queue). It is deliberately firm-scoped: only
 * rows whose case belongs to a firm are picked up, since the consumer timeline
 * leaves rows 'skipped' when the viewer has no firm plan and those must stay
 * unscored. Runs with limited concurrency and never throws; each failure is
 * recorded on its own row via computeEventAnalysis' error patch. This is what
 * makes auto-analysis reliable at 1000+ scale even if the browser goes away:
 * the CRON_SECRET-gated route keeps calling it until nothing is pending.
 */
export async function analyzePendingEvidence(
  admin: SupabaseClient,
  opts?: { limit?: number; concurrency?: number; staleRunningMs?: number },
): Promise<{ picked: number; analyzed: number; failed: number; remaining: boolean }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 25, 100));
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 8));
  const staleMs = opts?.staleRunningMs ?? 15 * 60_000;
  const staleCutoff = new Date(Date.now() - staleMs).toISOString();

  // Pull one extra row than the limit so we can report whether more remain.
  const { data } = await admin
    .from('case_timeline_events')
    .select('id, case_id, kind, title, description, media, occurred_at, ai_extracted')
    .or(`ai_status.eq.skipped,and(ai_status.eq.running,updated_at.lt.${staleCutoff})`)
    .order('created_at', { ascending: true })
    .limit(limit + 1);
  const all = (data ?? []) as PendingRow[];
  if (all.length === 0) return { picked: 0, analyzed: 0, failed: 0, remaining: false };
  const remaining = all.length > limit;
  const rows = all.slice(0, limit);

  // Keep the sweep firm-scoped: only score rows whose case belongs to a firm.
  const caseIds = [...new Set(rows.map((r) => r.case_id))];
  const { data: caseRows } = await admin
    .from('cases')
    .select('id, firm_id')
    .in('id', caseIds);
  const firmCaseIds = new Set(
    ((caseRows ?? []) as { id: string; firm_id: string | null }[])
      .filter((c) => c.firm_id)
      .map((c) => c.id),
  );
  const work = rows.filter((r) => firmCaseIds.has(r.case_id));
  if (work.length === 0) return { picked: 0, analyzed: 0, failed: 0, remaining };

  // Case context is reused across every row of the same case.
  const contextCache = new Map<string, CaseContext | null>();
  const contextFor = async (caseId: string): Promise<CaseContext | null> => {
    if (!contextCache.has(caseId)) contextCache.set(caseId, await loadCaseContext(admin, caseId));
    return contextCache.get(caseId) ?? null;
  };

  let analyzed = 0;
  let failed = 0;
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= work.length) return;
      const r = work[i];
      const prior = r.ai_extracted ?? {};
      // Never let the background sweep overwrite a hand correction (a race where
      // someone edited a row that was still queued): mark it done and move on.
      if (prior.edited_at) {
        try {
          await admin.from('case_timeline_events').update({ ai_status: 'done' }).eq('id', r.id);
        } catch {
          /* best-effort */
        }
        continue;
      }
      try {
        await admin.from('case_timeline_events').update({ ai_status: 'running' }).eq('id', r.id);
        const outcome = await computeEventAnalysis({
          ev: {
            id: r.id,
            media: Array.isArray(r.media) ? r.media : [],
            description: r.description,
            kind: r.kind,
            occurredAt: r.occurred_at,
            title: r.title ?? '',
          },
          admin,
          caseContext: await contextFor(r.case_id),
        });
        // Carry the exhibit number, hash, and any hand-pinned folder across the
        // re-score, so the sweep never drops a stable identifier.
        if (outcome.ok && outcome.patch.ai_extracted) {
          outcome.patch.ai_extracted = mergeStickyExtracted(
            outcome.patch.ai_extracted as AiExtracted,
            prior,
          );
        }
        await admin.from('case_timeline_events').update(outcome.patch).eq('id', r.id);
        if (outcome.ok) analyzed++;
        else failed++;
      } catch (err) {
        failed++;
        try {
          await admin
            .from('case_timeline_events')
            .update({ ai_status: 'error', ai_error: err instanceof Error ? err.message : 'Analysis failed.' })
            .eq('id', r.id);
        } catch {
          /* best-effort error stamp */
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { picked: work.length, analyzed, failed, remaining };
}
