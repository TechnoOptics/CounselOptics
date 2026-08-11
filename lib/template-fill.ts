import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirmTemplate, TemplateField } from './firm-templates';
import { parseDeliveryMode } from './submission-dispatch';
import { employeeFieldsOf } from './counterparty-fields';
import { sanitizeDocumentLayoutOverride } from './document-layout';
import { parseAllowedSignatureMethods } from './signature-methods';
import { checkTemplateFieldValue } from './template-field-formats';

/**
 * Reading a published firm template on the server, for the two places that
 * turn one into a finished document: the submission path in
 * lib/template-submissions.ts and the PDF renderer at
 * app/api/counsel/draft-template/pdf.
 *
 * It lives in its own module because the renderer is a route handler and
 * lib/template-submissions.ts is a `'use server'` module, every export of
 * which is a public HTTP endpoint. Importing one from the other to reach a
 * helper would publish the helper. This module is `server-only` and exports
 * nothing that acts, so both can read from it.
 *
 * `requires_approval` is absent from the row until the migration runs, and an
 * absent value reads as gated. That is the safe direction: an unmigrated
 * database refuses to hand out finished documents rather than handing them out
 * ungated.
 *
 * `delivery_mode` is absent until 20260807_flow_join.sql runs and reads as
 * 'share', which is the same direction and is exactly what every template did
 * before that column existed.
 *
 * `document_layout` is absent until 20260809_template_document_layout.sql runs
 * and reads as no override, so the document is laid out on the firm's own
 * layout. Same direction again: the page the firm was already getting.
 *
 * `signature_methods` is absent until 20260814_signature_methods.sql runs and
 * reads as null, which means no restriction and so all four methods. That is
 * the same direction once more: an unmigrated database offers exactly what the
 * product offers today rather than refusing every way of signing.
 */
export async function loadPublishedTemplate(
  admin: SupabaseClient,
  firmId: string,
  templateId: string,
): Promise<FirmTemplate | null> {
  if (!firmId || !templateId) return null;
  const { data } = await admin
    .from('firm_templates')
    .select('*')
    .eq('firm_id', firmId)
    .eq('id', templateId)
    .eq('status', 'published')
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    firmId: String(r.firm_id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    body: String(r.body ?? ''),
    fields: Array.isArray(r.fields) ? (r.fields as TemplateField[]) : [],
    status: r.status as FirmTemplate['status'],
    requiresApproval: r.requires_approval !== false,
    deliveryMode: parseDeliveryMode(r.delivery_mode),
    documentLayout: sanitizeDocumentLayoutOverride(r.document_layout),
    signatureMethods: parseAllowedSignatureMethods(r.signature_methods),
    createdAt: String(r.created_at),
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/**
 * Keep only the fields the firm declared on the template, trimmed. A caller
 * cannot introduce a placeholder the firm never wrote, and cannot push an
 * unbounded string into a document.
 */
export function sanitizeTemplateValues(
  fields: readonly TemplateField[],
  values: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Counterparty fields are dropped here, not merely ignored downstream.
  // mergeTemplateDocument never merges one whatever this map holds, so a
  // value under a counterparty key could only sit in field_values looking
  // like an answer the employee gave for the other side. The other side's
  // answers live on their own signature row and arrive later.
  for (const f of employeeFieldsOf(fields)) {
    const v = String((values ?? {})[f.key] ?? '').trim().slice(0, 5000);
    if (!v) continue;
    // NORMALISED, so what is stored is what the document prints and one
    // instrument carries one shape of a phone number however it was typed.
    // An answer that does NOT fit its format is kept exactly as it was typed:
    // dropping it would turn a mistyped answer into a missing one, and the
    // employee would be told to fill in a field they can see they filled in.
    // The refusal is fieldFormatRefusal's, in lib/template-submissions.ts, and
    // it names the field.
    const checked = checkTemplateFieldValue(f.type, v);
    out[f.key] = checked.ok ? checked.value : v;
  }
  return out;
}
