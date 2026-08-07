'use server';

import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import { getActiveFirmContext } from './firm-storage';
import { requireActiveFirm } from './firm-authz';
import { createServerSupabase } from './supabase/server';
import { generateLetterDocx } from './docx-export';
import { firmLetterheadDesign } from './letterhead-design';
import {
  buildClosingLines,
  sanitizeLetterOptions,
  type LetterOptions,
} from './letter-compose';
import type { FirmRole } from './firm-types';

const WRITE_ROLES: FirmRole[] = ['owner', 'admin', 'attorney', 'paralegal'];

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type SaveLetterInput = {
  title: string;
  body: string;
  options: LetterOptions;
  signerName?: string | null;
  signerTitle?: string | null;
  dateText?: string | null;
  caseId?: string | null;
};

/**
 * Render a generated letter to Word (.docx) and file it as a firm
 * document (#13), optionally attached to a case. Word is the saved
 * format because it's editable and "ready for export or pdf" per the
 * request; the studio also offers one-off PDF/Word downloads without
 * saving. Role-gated to the same writers who can upload documents.
 */
export async function saveLetterToCaseAction(
  input: SaveLetterInput,
): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  const ctx = await getActiveFirmContext();
  if (!ctx) return { ok: false, error: 'Sign in first.' };
  if (!WRITE_ROLES.includes(ctx.membership.role)) {
    return { ok: false, error: 'Your role cannot save documents.' };
  }
  // The other way a document is filed: uploadFirmDocumentAction takes bytes
  // from the caller, this one renders them here first. Both end at the same
  // firm-documents upload and the same firm_documents row.
  await requireActiveFirm(ctx.firm.id);
  const body = String(input.body ?? '').trim();
  if (body.length < 40) {
    return { ok: false, error: 'Generate or write the letter first.' };
  }
  const title = String(input.title ?? '').trim().slice(0, 120) || 'Letter';
  const options = sanitizeLetterOptions(input.options);

  const contactLine = ctx.firm.jurisdictions.length
    ? ctx.firm.jurisdictions.join(' · ')
    : null;

  let buffer: Buffer;
  try {
    buffer = await generateLetterDocx({
      firmName: ctx.firm.name,
      // The firm's own designed letterhead, so the Word export and the PDF
      // describe the same stationery. Read off the active firm, never the
      // request body.
      letterheadDesign: firmLetterheadDesign(ctx.firm.metadata),
      contactLine,
      accentHex: ctx.firm.accentColor,
      title,
      body,
      closing: buildClosingLines(options, {
        signerName: input.signerName ?? null,
        signerTitle: input.signerTitle ?? null,
        dateText: input.dateText ?? null,
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not render the letter.',
    };
  }

  const supabase = createServerSupabase();
  const caseId = String(input.caseId ?? '').trim() || null;
  // If a case was chosen, confirm it belongs to this firm (RLS also
  // guards this, but fail friendly).
  if (caseId) {
    const { data: kase } = await supabase
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .eq('firm_id', ctx.firm.id)
      .maybeSingle();
    if (!kase) return { ok: false, error: 'That case was not found for your firm.' };
  }

  const id = crypto.randomUUID();
  const safeName =
    (title.replace(/[^a-zA-Z0-9.\-_ ]/g, '').slice(0, 90) || 'letter') + '.docx';
  const filePath = `${ctx.firm.id}/${id}/${safeName}`;
  const { error: uploadErr } = await supabase.storage
    .from('firm-documents')
    .upload(filePath, buffer, { contentType: DOCX_MIME, upsert: false });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { data: doc, error: insertErr } = await supabase
    .from('firm_documents')
    .insert({
      id,
      firm_id: ctx.firm.id,
      name: title,
      mime_type: DOCX_MIME,
      file_path: filePath,
      file_size: buffer.byteLength,
      version: 1,
      uploaded_by: ctx.membership.userId,
      tags: ['letter'],
      case_id: caseId,
      status: 'ready',
      description: 'Generated with Advottic letter drafting.',
    })
    .select('id')
    .single();
  if (insertErr || !doc) {
    return { ok: false, error: insertErr?.message ?? 'Could not save the letter.' };
  }

  revalidatePath('/counsel/documents');
  if (caseId) revalidatePath(`/counsel/cases/${caseId}`);
  return { ok: true, documentId: (doc as { id: string }).id };
}
