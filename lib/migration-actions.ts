'use server';

/**
 * Universal migration ingest. Takes a normalized bundle (from any source
 * adapter) and writes it into the active firm workspace: cases, their
 * attachments (as exhibits in the 'exhibits' bucket), and their history +
 * notes — preserving the ORIGINAL timestamps so a migrated workspace looks
 * lived-in, not freshly created. Firm-scoped + best-effort per record so
 * one bad row never sinks the whole import.
 */
import { randomUUID } from 'node:crypto';
import { getCurrentUser } from './supabase/server';
import { getActiveFirmContext } from './firm-storage';
import { createAdminSupabase } from './supabase/admin';
import { logCaseEvent } from './activity';
import { normalizeToBundle } from './migration/normalize';
import type {
  MigrationAttachment,
  MigrationBundle,
  MigrationSourceInput,
} from './migration/types';

const EXHIBITS_BUCKET = 'exhibits';
const SUBJECT_TYPES = ['person', 'business', 'matter', 'state', 'entity'];

export type MigrationResult = {
  ok: boolean;
  source?: string;
  casesCreated?: number;
  attachmentsCreated?: number;
  failures?: { case: string; reason: string }[];
  error?: string;
};

export async function importMigrationBundleAction(
  input: MigrationSourceInput,
): Promise<MigrationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const ctx = await getActiveFirmContext();
  if (!ctx) return { ok: false, error: 'No active firm workspace.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service role not configured on this deployment.' };
  const firmId = ctx.firm.id;

  let bundle: MigrationBundle;
  try {
    bundle = await normalizeToBundle(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read the import.' };
  }
  if (!bundle.cases.length) return { ok: false, error: 'No records found to import.' };

  let casesCreated = 0;
  let attachmentsCreated = 0;
  const failures: { case: string; reason: string }[] = [];

  for (const c of bundle.cases) {
    try {
      const caseId = randomUUID();
      const subjectType = SUBJECT_TYPES.includes(c.subjectType ?? '')
        ? (c.subjectType as string)
        : 'matter';

      // Fold history + notes into the description so the migrated context
      // is visible even though they aren't first-class timeline rows yet.
      const parts: string[] = [];
      if (c.description?.trim()) parts.push(c.description.trim());
      if (c.history?.length) {
        parts.push(
          `History (migrated from ${bundle.source}):\n` +
            c.history
              .map(
                (h) =>
                  `- ${h.at || ''}${h.actor ? ` ${h.actor}` : ''}: ${h.event}` +
                  (h.detail ? ` — ${h.detail}` : ''),
              )
              .join('\n'),
        );
      }
      if (c.notes?.length) {
        parts.push(
          'Notes:\n' +
            c.notes.map((n) => `- ${n.author ? `${n.author}: ` : ''}${n.body}`).join('\n'),
        );
      }
      const description = parts.join('\n\n').slice(0, 8000) || null;
      const createdAt = safeIso(c.openedAt);

      const { error: caseErr } = await admin.from('cases').insert({
        id: caseId,
        firm_id: firmId,
        user_id: user.id,
        title: c.title.slice(0, 200),
        subject_name: (c.subjectName || c.title).slice(0, 200),
        subject_type: subjectType,
        case_type: (c.caseType || 'other').slice(0, 80),
        jurisdiction_country: 'US',
        jurisdiction_state: c.jurisdictionState || null,
        jurisdiction_city: c.jurisdictionCity || null,
        status: mapStatus(c.status),
        posture: 'pre_filing',
        description,
        subject_profile: {},
        sandbox: false,
        ...(createdAt ? { created_at: createdAt } : {}),
      });
      if (caseErr) {
        failures.push({ case: c.title, reason: caseErr.message });
        continue;
      }
      casesCreated++;

      let n = 0;
      for (const att of c.attachments ?? []) {
        try {
          const bytes = await attachmentBytes(att);
          if (!bytes) continue;
          const id = randomUUID();
          const ext = extFromName(att.name) || extFromMime(att.mimeType);
          const storagePath = `${user.id}/${caseId}/${id}${ext ? `.${ext}` : ''}`;
          const up = await admin.storage
            .from(EXHIBITS_BUCKET)
            .upload(storagePath, bytes, {
              contentType: att.mimeType || 'application/octet-stream',
              upsert: false,
            });
          if (up.error) continue;
          n++;
          const captured = safeIso(att.capturedAt);
          await admin.from('exhibits').insert({
            id,
            case_id: caseId,
            user_id: user.id,
            label: `Exhibit ${String.fromCharCode(64 + Math.min(n, 26))}`,
            file_name: (att.name || 'attachment').slice(0, 200),
            storage_path: storagePath,
            file_type: att.mimeType || 'application/octet-stream',
            file_size: bytes.byteLength,
            description: att.description || null,
            source: `Imported from ${bundle.source}`,
            category: 'migrated',
            ...(captured
              ? { uploaded_at: captured, incident_date: captured.slice(0, 10) }
              : {}),
          });
          attachmentsCreated++;
        } catch {
          /* skip a single attachment, keep importing the rest */
        }
      }

      await logCaseEvent({ caseId, eventType: 'case_created' }).catch(() => {});
    } catch (e) {
      failures.push({ case: c.title, reason: e instanceof Error ? e.message : 'failed' });
    }
  }

  return { ok: true, source: bundle.source, casesCreated, attachmentsCreated, failures };
}

function mapStatus(s?: string): string {
  const v = (s || '').toLowerCase();
  if (/clos|resolv|complete|done/.test(v)) return 'closed';
  if (/archiv/.test(v)) return 'archived';
  return 'open';
}

function safeIso(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extFromName(name?: string): string {
  const m = (name || '').match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : '';
}

function extFromMime(m?: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'text/plain': 'txt',
  };
  return map[m || ''] || '';
}

async function attachmentBytes(att: MigrationAttachment): Promise<Buffer | null> {
  if (att.dataBase64) {
    try {
      return Buffer.from(att.dataBase64, 'base64');
    } catch {
      return null;
    }
  }
  if (att.url) {
    try {
      const r = await fetch(att.url);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    } catch {
      return null;
    }
  }
  return null;
}
