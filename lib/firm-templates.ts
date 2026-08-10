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
import { FIRM_TEMPLATE_AUTHOR_ROLES } from './firm-authz';
import {
  TEMPLATE_BODY_MAX,
  unmergedPlaceholderMessage,
  unmergedPlaceholders,
} from './firm-template-placeholders';
import { sanitizeDocumentLayoutOverride } from './document-layout';
import {
  DOCUMENT_LAYOUT_UNSAVED_ERROR,
  resolveDocumentLayoutColumnFallback,
} from './template-document-layout';
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
  /**
   * This template's PARTIAL override of the firm's page layout, or null when
   * it does not override anything.
   *
   * Partial is the whole point: a template that names only the watermark
   * inherits the firm's margins, letterhead and footer, and keeps inheriting
   * them when the firm changes its mind. resolveDocumentLayout
   * (lib/document-layout.ts) is what merges the two, and it is the only thing
   * that turns this into a layout.
   */
  documentLayout: Record<string, unknown> | null;
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
  /** Absent until the owner applies 20260809_template_document_layout.sql. */
  document_layout?: unknown;
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
    // Absent (or unusable) reads as "no override", which resolves to exactly
    // the firm's own layout. Sanitized rather than trusted: this column is
    // read back by a client component that will show the author what it says.
    documentLayout: sanitizeDocumentLayoutOverride(r.document_layout),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * The role list itself now lives in lib/firm-authz.ts, the one authorization
 * axis, because the PDF preview of an unsaved draft has to refuse exactly who
 * this refuses. Read into a Set here only because that is what the lookup
 * below wants.
 */
const AUTHOR_ROLES = new Set<string>(FIRM_TEMPLATE_AUTHOR_ROLES);

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

/**
 * The save-time gate on a placeholder nothing will fill in.
 *
 * WHY THE SAVE AND NOT THE MERGE. The merge runs when a colleague has already
 * filled the form in and is sending it; by then the only people who can see
 * the stray token are the ones who cannot fix it, and stripping it there would
 * quietly delete words from an instrument nobody asked to have edited. The
 * author is the person who can correct it and the save is the first moment
 * they can be asked, so it costs one correction here and a document later.
 *
 * WHAT IT CHECKS is the body and the fields AS THEY WILL BE STORED: truncated
 * and sanitized, not as they were typed. A key the store narrows from
 * `Client_Name` to `client_name` is a key the merge will look for as
 * `client_name`, and checking the unsanitized version would clear a template
 * whose stored form is broken.
 *
 * It returns a REASON rather than throwing, and the acknowledgement is a
 * separate explicit argument rather than a default, so a caller that has never
 * heard of this check refuses closed. Every export of this module is a public
 * HTTP endpoint; the flag is only ever true because somebody read the list and
 * said so.
 */
function unmergedPlaceholderRefusal(input: {
  body: string;
  fields: readonly TemplateField[];
  acknowledged: boolean | undefined;
}): { error: string; unmergedPlaceholders: string[] } | null {
  if (input.acknowledged === true) return null;
  const tokens = unmergedPlaceholders({ body: input.body, fields: input.fields });
  if (tokens.length === 0) return null;
  return { error: unmergedPlaceholderMessage(tokens), unmergedPlaceholders: tokens };
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
    /** A partial page-layout override. Sanitized here, never trusted as sent. */
    documentLayout?: unknown;
    /**
     * The author has read the list of placeholders nothing will fill in and
     * wants them saved as they are. Absent means they have not, which is the
     * only safe reading: a caller that does not know about this check must not
     * be able to pass it by saying nothing.
     */
    acknowledgeUnmergedPlaceholders?: boolean;
  },
): Promise<{
  ok: boolean;
  error?: string;
  template?: FirmTemplate;
  /** The exact tokens, when that is what the refusal was about. */
  unmergedPlaceholders?: string[];
}> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const name = input.name.trim().slice(0, 120);
  const body = input.body.trim().slice(0, TEMPLATE_BODY_MAX);
  if (!name || !body) return { ok: false, error: 'Give the template a name and a body.' };
  const fields = sanitizeFields(input.fields);
  const refusal = unmergedPlaceholderRefusal({
    body,
    fields,
    acknowledged: input.acknowledgeUnmergedPlaceholders,
  });
  if (refusal) return { ok: false, ...refusal };
  const deliveryMode = parseDeliveryMode(input.deliveryMode);
  const documentLayout = sanitizeDocumentLayoutOverride(input.documentLayout);
  const insert = {
    firm_id: firmId,
    name,
    description: input.description?.trim().slice(0, 500) || null,
    category: input.category?.trim().slice(0, 60) || null,
    body,
    fields,
    status: input.status === 'draft' ? 'draft' : 'published',
    requires_approval: input.requiresApproval !== false,
    created_by: gate.user.id,
  };
  // The layout column is named only when there is something to put in it, so a
  // template that overrides nothing never touches a column that may not exist.
  const withLayout = documentLayout ? { ...insert, document_layout: documentLayout } : insert;
  let { data, error } = await gate.admin
    .from('firm_templates')
    .insert({ ...withLayout, delivery_mode: deliveryMode })
    .select('*')
    .single();
  // Both columns arrive with migrations the owner applies, and there is a
  // further window after each runs while PostgREST holds a stale schema cache.
  // See resolveDeliveryModeColumnFallback and
  // resolveDocumentLayoutColumnFallback for why each recovery is right in one
  // direction only.
  if (error) {
    if (
      resolveDocumentLayoutColumnFallback({
        hasOverride: documentLayout !== null,
        error,
      }) === 'abort-layout-unsaved'
    ) {
      return { ok: false, error: DOCUMENT_LAYOUT_UNSAVED_ERROR };
    }
    const fallback = resolveDeliveryModeColumnFallback({ deliveryMode, error });
    if (fallback === 'abort-mode-unsaved') {
      return { ok: false, error: DELIVERY_MODE_UNSAVED_ERROR };
    }
    if (fallback === 'retry-without-column') {
      ({ data, error } = await gate.admin
        .from('firm_templates')
        .insert(withLayout)
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
    /**
     * A partial page-layout override, or null to go back to the firm's own
     * layout. Undefined leaves whatever is stored alone, the same way every
     * other field on this patch does.
     */
    documentLayout: unknown;
    /** See createFirmTemplateAction. Absent means not acknowledged. */
    acknowledgeUnmergedPlaceholders: boolean;
  }>,
): Promise<{
  ok: boolean;
  error?: string;
  template?: FirmTemplate;
  unmergedPlaceholders?: string[];
}> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 120);
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500) || null;
  if (input.category !== undefined) patch.category = input.category.trim().slice(0, 60) || null;
  if (input.body !== undefined) patch.body = input.body.trim().slice(0, TEMPLATE_BODY_MAX);
  if (input.fields !== undefined) patch.fields = sanitizeFields(input.fields);
  if (input.status !== undefined) patch.status = input.status;
  if (input.requiresApproval !== undefined) patch.requires_approval = input.requiresApproval;

  // THE CHECK NEEDS BOTH HALVES, and a patch may carry either one alone. A
  // body arriving without fields, or a field rename arriving without a body,
  // both orphan a token, so whichever half is not being written is read back
  // off the stored row and the pair is checked together. A patch touching
  // NEITHER is left alone entirely: Archive sends only a status, and a save
  // gate that fired on it would leave a firm unable to put away the very
  // template it was complaining about.
  if (input.body !== undefined || input.fields !== undefined) {
    let checkBody = patch.body as string | undefined;
    let checkFields = patch.fields as TemplateField[] | undefined;
    if (checkBody === undefined || checkFields === undefined) {
      const { data: stored } = await gate.admin
        .from('firm_templates')
        .select('body, fields')
        .eq('id', templateId)
        .eq('firm_id', firmId)
        .maybeSingle();
      // No row means this id is not this firm's. The update below would match
      // nothing and PostgREST would report no error for it, so the honest
      // answer is here rather than a cheerful success later.
      if (!stored) return { ok: false, error: 'That template is no longer available.' };
      const row = stored as { body: string | null; fields: TemplateField[] | null };
      if (checkBody === undefined) checkBody = String(row.body ?? '');
      if (checkFields === undefined) {
        checkFields = Array.isArray(row.fields) ? row.fields : [];
      }
    }
    const refusal = unmergedPlaceholderRefusal({
      body: checkBody,
      fields: checkFields,
      acknowledged: input.acknowledgeUnmergedPlaceholders,
    });
    if (refusal) return { ok: false, ...refusal };
  }

  const deliveryMode =
    input.deliveryMode === undefined ? null : parseDeliveryMode(input.deliveryMode);
  // Undefined means "leave it alone" and null means "go back to the firm's
  // layout", which are different writes, so the two are kept apart here rather
  // than collapsed into a falsy check.
  const layoutTouched = input.documentLayout !== undefined;
  const documentLayout = layoutTouched
    ? sanitizeDocumentLayoutOverride(input.documentLayout)
    : null;
  if (layoutTouched) patch.document_layout = documentLayout;
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
  // Same recovery as the insert above, and for the same reason. Setting a
  // layout the column cannot hold aborts; CLEARING one is survivable, because
  // a column that does not exist holds no override to clear, so the retry
  // lands on exactly the behaviour the author asked for.
  if (error && layoutTouched) {
    const fallback = resolveDocumentLayoutColumnFallback({
      hasOverride: documentLayout !== null,
      error,
    });
    if (fallback === 'abort-layout-unsaved') {
      return { ok: false, error: DOCUMENT_LAYOUT_UNSAVED_ERROR };
    }
    if (fallback === 'retry-without-column') {
      delete patch.document_layout;
      ({ data, error } = await write(
        deliveryMode === null ? {} : { delivery_mode: deliveryMode },
      ));
    }
  }
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
 * signed-in user with a firmId of their choosing, and this one spends real
 * money: per lib/ai-errors.ts the model call is paid for by the app's own
 * ANTHROPIC_API_KEY, not out of a firm's token pool, so an ungated version
 * bills US for a stranger reading documents that are not theirs. It is the
 * same gate the neighbouring template actions use; a second membership query
 * would be a third authorization axis in a codebase that deliberately has one.
 *
 * NOT gated on subscription. The comparable endpoint checks
 * isFirmSubscriptionActive and requireActiveFirm covers the access-ended state,
 * so a lapsed or export-only firm can still spend here. Left open on purpose
 * and recorded rather than added unattended: a false denial locks a paying firm
 * out of a feature with nobody watching.
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
    // Authorization stops a stranger. This stops one author looping the
    // endpoint, which matters because each call is a long generation billed to
    // the app's own key.
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
