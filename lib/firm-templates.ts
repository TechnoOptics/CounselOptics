'use server';

import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';
import {
  parseDeliveryMode,
  resolveDeliveryModeColumnFallback,
  DELIVERY_MODE_UNSAVED_ERROR,
  type DeliveryMode,
} from './submission-dispatch';
import { parseTemplateFieldParty } from './counterparty-fields';
import { extractFileText } from './doc-review';
import { checkRateLimit } from './rate-limit';
import { AiUnavailableError } from './ai-errors';
import type { TemplateProposal } from './template-proposal';

/**
 * Firm-owned form templates ("Forms"): the legal team configures reusable
 * documents (NDA, vendor form, …) with {{field}} placeholders; employees fill,
 * sign, and export them from the Hub portal: self-service for request types
 * that used to become tickets.
 *
 * firm_templates carries RLS with NO policies: every path below runs on the
 * service-role client behind an explicit gate: firm membership for authoring,
 * authorizeFirmActor (employee entitlement) for reading published templates.
 */

/**
 * Who fills this in.
 *
 * Absent means 'employee', which is what every field on every template that
 * exists today is, so nothing in the `fields` jsonb needs migrating and no
 * existing document changes by a character.
 *
 * Only the legal team sets this, in the template editor. Deliberately only
 * them: the employee filling a form must not be able to invent obligations
 * for the other side, and the counterparty must not be able to invent fields
 * for themselves. It is a property of the instrument, decided when the
 * instrument is drafted.
 */
export type TemplateFieldParty = 'employee' | 'counterparty';

export type TemplateField = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'textarea';
  required: boolean;
  party?: TemplateFieldParty;
};

export type FirmTemplate = {
  id: string;
  firmId: string;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
  fields: TemplateField[];
  status: 'draft' | 'published' | 'archived';
  /**
   * Output from this template needs legal sign-off before it can be sent to an
   * outside party. On by default: a document that leaves the building under
   * the firm's letterhead is reviewed unless the legal team says otherwise.
   */
  requiresApproval: boolean;
  /**
   * How output from this template reaches the recipient once legal approves
   * it: as a read-only encrypted share, or sent for signature. 'share' is what
   * every template did before this existed, and it is what an absent column
   * reads as, so nothing changes until a firm opts a template in.
   */
  deliveryMode: DeliveryMode;
  createdAt: string;
  updatedAt: string | null;
};

type Row = {
  id: string;
  firm_id: string;
  name: string;
  description: string | null;
  category: string | null;
  body: string;
  fields: TemplateField[] | null;
  status: 'draft' | 'published' | 'archived';
  requires_approval: boolean | null;
  /** Absent until the owner applies 20260807_flow_join.sql. */
  delivery_mode?: string | null;
  created_at: string;
  updated_at: string | null;
};

function toTemplate(r: Row): FirmTemplate {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    description: r.description,
    category: r.category,
    body: r.body,
    fields: Array.isArray(r.fields) ? r.fields : [],
    status: r.status,
    // Absent (or null) reads as "review it": the safe direction.
    requiresApproval: r.requires_approval !== false,
    // Absent (or anything unrecognised) reads as a read-only share, which is
    // the fail-safe direction and today's behaviour. See parseDeliveryMode.
    deliveryMode: parseDeliveryMode(r.delivery_mode),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const AUTHOR_ROLES = new Set(['owner', 'admin', 'attorney', 'paralegal']);

async function requireAuthor(firmId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Sign in first.' as const };
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Service unavailable.' as const };
  const { data } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role: string } | null)?.role;
  if (!role || !AUTHOR_ROLES.has(role)) return { error: 'No access to this firm.' as const };
  return { user, admin };
}

function sanitizeFields(fields: unknown): TemplateField[] {
  if (!Array.isArray(fields)) return [];
  const seen = new Set<string>();
  const out: TemplateField[] = [];
  for (const f of fields.slice(0, 40)) {
    const o = f as Partial<TemplateField>;
    const key = String(o.key ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(o.label ?? key).slice(0, 80),
      type: o.type === 'date' || o.type === 'textarea' ? o.type : 'text',
      required: Boolean(o.required),
      // Anything unrecognised coerces to 'employee', the same fail-safe
      // direction the type above uses. The safe direction here is the
      // employee: a field that should have been the counterparty's is a
      // question the employee gets asked, which is visible and recoverable.
      // The other way round is a blank nobody is asked to fill, in a
      // document that has already been approved and sent.
      //
      // Shared with the read side (parseTemplateFields), because a value
      // stored by one coercion and read back by another is how a field ends
      // up owned by one party going in and the other coming out.
      party: parseTemplateFieldParty(o.party),
    });
  }
  return out;
}

export async function createFirmTemplateAction(
  firmId: string,
  input: {
    name: string;
    description?: string;
    category?: string;
    body: string;
    fields: TemplateField[];
    status?: 'draft' | 'published';
    requiresApproval?: boolean;
    deliveryMode?: DeliveryMode;
  },
): Promise<{ ok: boolean; error?: string; template?: FirmTemplate }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const name = input.name.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 100000);
  if (!name || !body) return { ok: false, error: 'Give the template a name and a body.' };
  const deliveryMode = parseDeliveryMode(input.deliveryMode);
  const insert = {
    firm_id: firmId,
    name,
    description: input.description?.trim().slice(0, 500) || null,
    category: input.category?.trim().slice(0, 60) || null,
    body,
    fields: sanitizeFields(input.fields),
    status: input.status === 'draft' ? 'draft' : 'published',
    requires_approval: input.requiresApproval !== false,
    created_by: gate.user.id,
  };
  let { data, error } = await gate.admin
    .from('firm_templates')
    .insert({ ...insert, delivery_mode: deliveryMode })
    .select('*')
    .single();
  // The column arrives with a migration the owner applies, and there is a
  // further window after it runs while PostgREST holds a stale schema cache.
  // See resolveDeliveryModeColumnFallback for why the recovery is right in
  // one direction only.
  if (error) {
    const fallback = resolveDeliveryModeColumnFallback({ deliveryMode, error });
    if (fallback === 'abort-mode-unsaved') {
      return { ok: false, error: DELIVERY_MODE_UNSAVED_ERROR };
    }
    if (fallback === 'retry-without-column') {
      ({ data, error } = await gate.admin
        .from('firm_templates')
        .insert(insert)
        .select('*')
        .single());
    }
  }
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the template.' };
  return { ok: true, template: toTemplate(data as Row) };
}

export async function updateFirmTemplateAction(
  firmId: string,
  templateId: string,
  input: Partial<{
    name: string;
    description: string;
    category: string;
    body: string;
    fields: TemplateField[];
    status: 'draft' | 'published' | 'archived';
    requiresApproval: boolean;
    deliveryMode: DeliveryMode;
  }>,
): Promise<{ ok: boolean; error?: string; template?: FirmTemplate }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 120);
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500) || null;
  if (input.category !== undefined) patch.category = input.category.trim().slice(0, 60) || null;
  if (input.body !== undefined) patch.body = input.body.trim().slice(0, 100000);
  if (input.fields !== undefined) patch.fields = sanitizeFields(input.fields);
  if (input.status !== undefined) patch.status = input.status;
  if (input.requiresApproval !== undefined) patch.requires_approval = input.requiresApproval;
  const deliveryMode =
    input.deliveryMode === undefined ? null : parseDeliveryMode(input.deliveryMode);
  const write = (extra: Record<string, unknown>) =>
    gate.admin
      .from('firm_templates')
      .update({ ...patch, ...extra })
      .eq('id', templateId)
      .eq('firm_id', firmId)
      .select('*')
      .single();
  let { data, error } = await write(
    deliveryMode === null ? {} : { delivery_mode: deliveryMode },
  );
  // Same recovery as the insert above, and for the same reason.
  if (error && deliveryMode !== null) {
    const fallback = resolveDeliveryModeColumnFallback({ deliveryMode, error });
    if (fallback === 'abort-mode-unsaved') {
      return { ok: false, error: DELIVERY_MODE_UNSAVED_ERROR };
    }
    if (fallback === 'retry-without-column') ({ data, error } = await write({}));
  }
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not update the template.' };
  return { ok: true, template: toTemplate(data as Row) };
}

/** Uploads past this are refused before anything is read. Matches the policy
 *  checker's limit, which is the other place a firm uploads a document. */
const MAX_TEMPLATE_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Read an uploaded document and propose the template it would become.
 *
 * PROPOSES. It does not create or update anything. The legal team reviews
 * every field and every signature line in the editor and presses Save
 * themselves, because what comes back is a model's reading of their document
 * and it is going onto an instrument somebody signs.
 *
 * requireAuthor runs FIRST, before the file is even taken out of the form.
 * Every export of this module is a public HTTP endpoint callable by any
 * signed-in user with a firmId of their choosing, and this one spends the
 * firm's AI budget, so an ungated version would let a stranger bill a firm for
 * reading documents that are not theirs. It is the same gate the neighbouring
 * template actions use; a second membership query would be a third
 * authorization axis in a codebase that deliberately has one.
 */
export async function importTemplateDocumentAction(
  firmId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; proposal?: TemplateProposal }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const allowed = await checkRateLimit(`template-import:${gate.user.id}`, {
    limit: 20,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return { ok: false, error: 'That is a lot of imports this hour. Try again later.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose a document first.' };
  if (file.size > MAX_TEMPLATE_UPLOAD_BYTES) {
    return {
      ok: false,
      error: 'That file is over 10 MB. Try a smaller file, or paste the text into the body.',
    };
  }

  const extracted = await extractFileText(file);
  // extractFileText already writes calm, specific copy for the cases it knows
  // about, the legacy .doc branch above all. Surface it rather than replacing
  // it with something vaguer.
  if (extracted.error) return { ok: false, error: extracted.error };
  const text = extracted.text.trim();
  if (text.length < 40) {
    return {
      ok: false,
      error:
        'No readable text was found in that file. A scanned page has no text ' +
        'in it to read. Try a PDF or Word file with selectable text, or paste ' +
        'the text into the body below.',
    };
  }

  try {
    // Loaded here rather than at the top of the file so the Anthropic client
    // stays out of the module graph of the employee portal pages, which import
    // this file only to list published templates. Same reasoning as the
    // dynamic import in requireActiveFirm.
    const { proposeTemplateFromText } = await import('./template-intake');
    const proposal = await proposeTemplateFromText(text);
    if (!proposal) {
      return {
        ok: false,
        error:
          'Could not read a template out of that document. You can still write ' +
          'the body below and add the placeholders yourself.',
      };
    }
    return { ok: true, proposal };
  } catch (e) {
    // AiUnavailableError carries the calm, branded wording for a model that is
    // out of budget or unreachable. Anything else is described plainly. Raw
    // model output and raw Anthropic JSON never reach the browser.
    return {
      ok: false,
      error:
        e instanceof AiUnavailableError
          ? e.userMessage
          : 'Could not read that document. Try again shortly, or write the body below.',
    };
  }
}

/** Legal-side list (all statuses). */
export async function listFirmTemplatesAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string; templates?: FirmTemplate[] }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const { data, error } = await gate.admin
    .from('firm_templates')
    .select('*')
    .eq('firm_id', firmId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, templates: ((data ?? []) as Row[]).map(toTemplate) };
}

/** Employee-side list: published only, gated by the portal entitlement. */
export async function listPortalTemplatesAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string; templates?: FirmTemplate[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: 'No access.' };
  const { data, error } = await admin
    .from('firm_templates')
    .select('*')
    .eq('firm_id', firmId)
    .eq('status', 'published')
    .order('name', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, templates: ((data ?? []) as Row[]).map(toTemplate) };
}

/** Employee-side single fetch (published only). */
export async function getPortalTemplateAction(
  firmId: string,
  templateId: string,
): Promise<{ ok: boolean; error?: string; template?: FirmTemplate }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: 'No access.' };
  const { data } = await admin
    .from('firm_templates')
    .select('*')
    .eq('firm_id', firmId)
    .eq('id', templateId)
    .eq('status', 'published')
    .maybeSingle();
  if (!data) return { ok: false, error: 'Template not found.' };
  return { ok: true, template: toTemplate(data as Row) };
}
