'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerHasFirmRole, FIRM_MANAGE_ROLES } from './firm-authz';
import { getActiveFirmContext } from './firm-storage';
import { validateFormPayload, type FormError } from './form-schema';
import {
  getNextVersion,
  getRequestTypeById,
  type Admin,
  type RequestType,
  type RequestTypeMode,
} from './form-queries';

/**
 * Writes for the intake form builder: save a draft, publish it as a version,
 * discard it, and manage the request types forms hang off.
 *
 * EVERY export of this module is a public HTTP endpoint, callable by any
 * signed-in user with arguments of their own choosing, and every write below
 * goes through the service-role client, which bypasses RLS. So the gate in
 * this file is the only authorization on these paths.
 *
 * Two rules follow, and neither is negotiable:
 *
 * 1. The firm is DERIVED from the request type row, never taken from an
 *    argument. A caller-supplied firm id that reaches the admin client
 *    unchecked is a cross-firm write; the sweep in 237ea16e closed nine holes
 *    of exactly that shape. The one action that has no row to derive from,
 *    creating a request type, takes the firm from the caller's own active
 *    workspace instead, which is server-side session state.
 * 2. The caller's role in that firm is re-checked here with the shared
 *    `callerHasFirmRole`, which reads `firm_members` through the USER-scoped
 *    client. Publishing changes what every employee sees, so it is gated to
 *    owner, admin and attorney: the same set the RLS policies use.
 *
 * A version is immutable once written. Nothing in this file updates a row in
 * `firm_intake_form_versions`; publishing again inserts a new one.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export type PublishResult =
  | { ok: true; version: number }
  | { ok: false; error: string }
  | { ok: false; errors: FormError[] };

export type RequestTypeInput = {
  /** Omit to create. Present to rename or reorder an existing type. */
  id?: string;
  label: string;
  mode: RequestTypeMode;
  sortOrder?: number;
};

/**
 * One message for "no such type" and for "not your firm". Distinguishing them
 * would let a caller probe which type ids exist across other firms.
 */
const NO_ACCESS = 'That request type is not available.';
const SIGN_IN = 'Sign in first.';
const NO_SERVICE = 'Server not configured.';

/**
 * A draft is stored as raw jsonb without validation, so this cap is the only
 * thing standing between an endpoint and an arbitrarily large row. Generous
 * next to the validator's ceiling of 60 questions, which is roughly 40 KB.
 */
const MAX_DRAFT_BYTES = 512 * 1024;

const MAX_LABEL = 120;

type Gate =
  | { ok: true; admin: Admin; userId: string; type: RequestType }
  | { ok: false; error: string };

/**
 * Resolve the request type, derive its firm, then check the caller against
 * that firm. Order matters: the firm comes out of the row, so the caller
 * cannot assert the thing being checked.
 */
async function gateOnType(typeId: unknown): Promise<Gate> {
  if (typeof typeId !== 'string' || !typeId.trim()) {
    return { ok: false, error: NO_ACCESS };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: SIGN_IN };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: NO_SERVICE };

  const type = await getRequestTypeById(admin, typeId.trim());
  if (!type) return { ok: false, error: NO_ACCESS };

  if (!(await callerHasFirmRole(type.firmId, FIRM_MANAGE_ROLES))) {
    return { ok: false, error: NO_ACCESS };
  }
  return { ok: true, admin, userId: user.id, type };
}

/**
 * Publishing changes what every employee and every partner app sees next, so
 * bust the builder, the counsel-side create form, and the portal form.
 */
function revalidateFormSurfaces(): void {
  revalidatePath('/counsel/settings/forms');
  revalidatePath('/counsel/intake');
  revalidatePath('/portal/new');
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

/**
 * Save the builder's scratch work. Deliberately does NOT validate: a draft is
 * allowed to be half-finished, with a question that has no label yet or a rule
 * that points nowhere, and that is the whole reason a draft exists separately
 * from a version. The gate is publish.
 *
 * The payload is stored verbatim rather than coerced, because coercing would
 * silently drop the question the author is in the middle of writing.
 */
export async function saveDraftAction(typeId: string, payload: unknown): Promise<ActionResult> {
  const gate = await gateOnType(typeId);
  if (!gate.ok) return gate;

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'That draft could not be read.' };
  }
  let size = 0;
  try {
    size = JSON.stringify(payload).length;
  } catch {
    return { ok: false, error: 'That draft could not be read.' };
  }
  if (size > MAX_DRAFT_BYTES) {
    return { ok: false, error: 'This form is too large to save. Remove some questions.' };
  }

  const { error } = await gate.admin.from('firm_intake_forms').upsert(
    {
      firm_id: gate.type.firmId,
      request_type_id: gate.type.id,
      draft_payload: payload,
      updated_at: new Date().toISOString(),
      updated_by: gate.userId,
    },
    { onConflict: 'firm_id,request_type_id' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/counsel/settings/forms');
  return { ok: true };
}

/** Revert to the published version. The versions themselves are untouched. */
export async function discardDraftAction(typeId: string): Promise<ActionResult> {
  const gate = await gateOnType(typeId);
  if (!gate.ok) return gate;

  const { error } = await gate.admin
    .from('firm_intake_forms')
    .update({
      draft_payload: null,
      updated_at: new Date().toISOString(),
      updated_by: gate.userId,
    })
    .eq('firm_id', gate.type.firmId)
    .eq('request_type_id', gate.type.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/counsel/settings/forms');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Validate the draft, then write it as a new immutable version.
 *
 * The validator is `validateFormPayload`, the same one the builder runs, so a
 * form the builder shows as clean is a form that publishes. On failure the
 * errors are returned UNCHANGED, because the publish dialog renders each one
 * as a link that scrolls to and focuses the question that caused it; rewording
 * or collapsing them here would break that.
 */
export async function publishFormAction(typeId: string): Promise<PublishResult> {
  const gate = await gateOnType(typeId);
  if (!gate.ok) return gate;
  const { admin, userId, type } = gate;

  const { data: formRow } = await admin
    .from('firm_intake_forms')
    .select('id, draft_payload')
    .eq('firm_id', type.firmId)
    .eq('request_type_id', type.id)
    .maybeSingle();
  const form = (formRow ?? null) as { id: string; draft_payload: unknown } | null;
  if (!form || form.draft_payload == null) {
    return { ok: false, error: 'There are no unpublished changes to publish.' };
  }

  const result = validateFormPayload(form.draft_payload);
  if (!result.ok) return { ok: false, errors: result.errors };

  // Two attempts, because `version` is computed from a read and a second
  // publish could land in between. The unique (form_id, version) index is what
  // actually prevents a reused number; this just re-reads and tries once more
  // rather than showing the author a constraint error.
  let versionId: string | null = null;
  let version = 0;
  for (let attempt = 0; attempt < 2 && !versionId; attempt += 1) {
    version = await getNextVersion(admin, form.id);
    const { data, error } = await admin
      .from('firm_intake_form_versions')
      .insert({
        form_id: form.id,
        version,
        payload: result.payload,
        published_by: userId,
      })
      .select('id')
      .single();
    if (!error && data) {
      versionId = (data as { id: string }).id;
      break;
    }
    if (error && (error as { code?: string }).code !== '23505') {
      return { ok: false, error: error.message };
    }
  }
  if (!versionId) {
    return { ok: false, error: 'Someone else published this form. Try again.' };
  }

  // Point the form at the new version and clear the draft in one statement, so
  // the form can never be left published-and-still-dirty.
  const { error: pointError } = await admin
    .from('firm_intake_forms')
    .update({
      published_version_id: versionId,
      draft_payload: null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', form.id);
  if (pointError) return { ok: false, error: pointError.message };

  revalidateFormSurfaces();
  return { ok: true, version };
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

/**
 * `key` is what intakes and answers are stored against, so it is derived from
 * the label once, at creation, and never touched again. Underscores match the
 * keys the migration backfills for the hardcoded types ('NDA review' becomes
 * 'nda_review'); partner-sourced types keep the partner's own hyphenated slug.
 */
function slugKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** A key not already taken in this firm. Suffixes rather than merges. */
async function uniqueKey(admin: Admin, firmId: string, base: string): Promise<string> {
  const root = base || `type_${Date.now().toString(36)}`;
  const { data } = await admin
    .from('firm_request_types')
    .select('key')
    .eq('firm_id', firmId);
  const taken = new Set(((data ?? []) as { key: string }[]).map((r) => r.key));
  if (!taken.has(root)) return root;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${root.slice(0, 36)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 30)}_${Date.now().toString(36)}`;
}

/**
 * Create a request type, or rename and reorder an existing one.
 *
 * Update derives the firm from the row being edited. Create has no row to
 * derive from, so it uses the caller's ACTIVE workspace, which is read from
 * their own profile server-side, and still runs the same role check. A firm
 * id is never accepted as an argument on either path.
 */
export async function upsertRequestTypeAction(
  input: RequestTypeInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const label = String(input?.label ?? '').trim().slice(0, MAX_LABEL);
  if (!label) return { ok: false, error: 'Give this request type a name.' };

  const mode: RequestTypeMode = input?.mode === 'client' ? 'client' : 'inhouse';
  const sortOrder =
    typeof input?.sortOrder === 'number' && Number.isFinite(input.sortOrder)
      ? Math.max(0, Math.floor(input.sortOrder))
      : null;

  if (input?.id) {
    const gate = await gateOnType(input.id);
    if (!gate.ok) return { ok: false, error: gate.error };

    // `key` is absent on purpose. Renaming it would detach every intake
    // already filed under this type.
    const patch: Record<string, unknown> = { label, mode };
    if (sortOrder !== null) patch.sort_order = sortOrder;

    const { error } = await gate.admin
      .from('firm_request_types')
      .update(patch)
      .eq('id', gate.type.id)
      .eq('firm_id', gate.type.firmId);
    if (error) return { ok: false, error: error.message };

    revalidateFormSurfaces();
    return { ok: true, id: gate.type.id };
  }

  if (!(await getCurrentUser())) return { ok: false, error: SIGN_IN };
  const context = await getActiveFirmContext();
  if (!context) return { ok: false, error: 'Open a workspace first.' };
  if (!(await callerHasFirmRole(context.firm.id, FIRM_MANAGE_ROLES))) {
    return { ok: false, error: 'You do not have permission to change request types.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: NO_SERVICE };

  let order = sortOrder;
  if (order === null) {
    const { data: last } = await admin
      .from('firm_request_types')
      .select('sort_order')
      .eq('firm_id', context.firm.id)
      .order('sort_order', { ascending: false })
      .limit(1);
    const highest = ((last ?? []) as { sort_order: number | null }[])[0]?.sort_order;
    order = (typeof highest === 'number' ? highest : 0) + 1;
  }

  const { data, error } = await admin
    .from('firm_request_types')
    .insert({
      firm_id: context.firm.id,
      key: await uniqueKey(admin, context.firm.id, slugKey(label)),
      label,
      mode,
      sort_order: order,
      hidden: false,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'That request type could not be created.' };
  }

  revalidateFormSurfaces();
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Take a request type out of the picker, or put it back. Never a delete:
 * intakes already filed under it keep pointing at it, and its published
 * versions have to stay readable.
 */
export async function hideRequestTypeAction(
  typeId: string,
  hidden: boolean,
): Promise<ActionResult> {
  const gate = await gateOnType(typeId);
  if (!gate.ok) return gate;

  const { error } = await gate.admin
    .from('firm_request_types')
    .update({ hidden: hidden === true })
    .eq('id', gate.type.id)
    .eq('firm_id', gate.type.firmId);
  if (error) return { ok: false, error: error.message };

  revalidateFormSurfaces();
  return { ok: true };
}
