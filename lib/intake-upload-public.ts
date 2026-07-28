'use server';

import crypto from 'crypto';
import { createAdminSupabase } from './supabase/admin';
import { checkRateLimit } from './rate-limit';
import { safeStorageUpload } from './upload-safety';
import {
  BUCKET,
  INTAKE_COLS,
  firmBrand,
  insertIntakeMessage,
  notifyIntakeActivity,
  refFor,
  revalidateIntake,
  type IntakeRow,
} from './intake-notify';
import { MAX_CHAT_FILE_BYTES, type IntakeAttachment } from './intake-conversation-types';

/**
 * The public side of "ask for a document": a tokenized page where whoever
 * holds the link can send files straight into a legal request, with no
 * Advottic account.
 *
 * The token IS the credential (same model as the signing links), so it is
 * high-entropy, expiring, revocable, single-purpose, and rate-limited. The
 * page never reveals anything about the request beyond what the legal team
 * typed into the ask.
 */

type RequestRow = {
  id: string;
  intake_id: string;
  firm_id: string;
  label: string;
  note: string | null;
  expires_at: string;
  revoked_at: string | null;
  upload_count: number;
  max_files: number;
};

const REQ_COLS =
  'id, intake_id, firm_id, label, note, expires_at, revoked_at, upload_count, max_files';

function isValidToken(t: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(t);
}

/** What the public page may display. Deliberately minimal. */
export async function getUploadRequestAction(token: string): Promise<
  | {
      ok: true;
      label: string;
      note: string | null;
      firmName: string;
      logoUrl: string | null;
      remaining: number;
    }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'complete' }
> {
  if (!isValidToken(token)) return { ok: false, reason: 'invalid' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: 'invalid' };

  const { data } = await admin
    .from('firm_intake_upload_requests')
    .select(REQ_COLS)
    .eq('token', token)
    .maybeSingle();
  const req = (data as RequestRow | null) ?? null;
  if (!req) return { ok: false, reason: 'invalid' };
  if (req.revoked_at) return { ok: false, reason: 'revoked' };
  if (new Date(req.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (req.upload_count >= req.max_files) return { ok: false, reason: 'complete' };

  const brand = await firmBrand(admin, req.firm_id);
  return {
    ok: true,
    label: req.label,
    note: req.note,
    firmName: brand.name,
    logoUrl: brand.logoUrl,
    remaining: req.max_files - req.upload_count,
  };
}

/** Accept files against a live token and file them into the request. */
export async function submitUploadRequestAction(
  token: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  if (!isValidToken(token)) return { ok: false, error: 'That link is not valid.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Uploads are unavailable right now.' };

  // Fail closed: an unauthenticated endpoint must never be a free-for-all.
  const allowed = await checkRateLimit(`send-upload:${token}`, {
    limit: 20,
    windowSeconds: 3600,
    failClosed: true,
  });
  if (!allowed) return { ok: false, error: 'Too many uploads on this link. Try again later.' };

  const { data } = await admin
    .from('firm_intake_upload_requests')
    .select(REQ_COLS)
    .eq('token', token)
    .maybeSingle();
  const req = (data as RequestRow | null) ?? null;
  if (!req) return { ok: false, error: 'That link is not valid.' };
  if (req.revoked_at) return { ok: false, error: 'That link has been turned off.' };
  if (new Date(req.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'That link has expired. Ask for a new one.' };
  }

  const senderName = String(formData.get('senderName') ?? '').trim().slice(0, 120);
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: 'Choose a file to send.' };
  const room = req.max_files - req.upload_count;
  if (room <= 0) return { ok: false, error: 'This request has already been fulfilled.' };
  if (files.length > room) return { ok: false, error: `You can send ${room} more file(s) here.` };

  const { data: intakeData } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', req.intake_id)
    .maybeSingle();
  const intake = (intakeData as IntakeRow | null) ?? null;
  if (!intake) return { ok: false, error: 'That request no longer exists.' };

  const attachments: IntakeAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      return { ok: false, error: `${file.name} is larger than 25 MB.` };
    }
    const safeName = file.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
    const path = `intake-chat/${req.firm_id}/${req.intake_id}/${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const up = await safeStorageUpload({
      client: admin,
      bucket: BUCKET,
      path,
      buffer,
      declaredMime: file.type || null,
      maxBytes: MAX_CHAT_FILE_BYTES,
    });
    if (!up.ok) return { ok: false, error: up.error };

    const { data: doc } = await admin
      .from('firm_documents')
      .insert({
        firm_id: req.firm_id,
        intake_id: req.intake_id,
        name: file.name.slice(0, 200) || safeName,
        mime_type: file.type || null,
        file_path: path,
        file_size: file.size,
        status: 'received',
        tags: ['Requested'],
      })
      .select('id')
      .single();

    attachments.push({
      name: file.name.slice(0, 200) || safeName,
      path,
      size: file.size,
      type: file.type || 'application/octet-stream',
      documentId: (doc as { id: string } | null)?.id ?? null,
    });
  }

  const who = senderName || 'Someone';
  const message = await insertIntakeMessage({
    admin,
    intake,
    authorUserId: null,
    authorName: who,
    authorRole: 'employee',
    visibility: 'shared',
    body: `${who} sent ${attachments.length} file${attachments.length === 1 ? '' : 's'} for: ${req.label}`,
    attachments,
    kind: 'message',
  });

  await admin
    .from('firm_intake_upload_requests')
    .update({
      upload_count: req.upload_count + attachments.length,
      completed_at: new Date().toISOString(),
    })
    .eq('id', req.id);

  if (message) {
    await notifyIntakeActivity({
      admin,
      intake,
      message,
      actor: { userId: 'upload-link', name: who, avatarUrl: null, side: 'employee' },
      eyebrow: 'Document received',
      headline: () => `${who} sent the document you asked for on ${refFor(intake)}`,
      ctaLabel: 'Open the request',
    });
  }

  revalidateIntake(req.intake_id);
  return { ok: true, count: attachments.length };
}
