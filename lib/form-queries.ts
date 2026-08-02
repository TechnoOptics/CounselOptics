import 'server-only';

import type { createAdminSupabase } from './supabase/admin';
import { readFormPayload, type FormPayload } from './form-schema';

/**
 * Reads for the intake form builder: request types, the form attached to a
 * type, and the payload of whatever version is currently published.
 *
 * Deliberately NOT a `'use server'` module. Every export of one of those is a
 * callable HTTP endpoint, and these functions take an already-privileged
 * service-role client and, in one case, look a row up with no firm scoping at
 * all. They are for trusted server callers only: `lib/form-actions.ts`, which
 * authorizes first, and server components that have already resolved the
 * caller's firm. Same split as `lib/intake-notify.ts`.
 *
 * Every function that takes a `firmId` scopes its query by it. The one that
 * does not, `getRequestTypeById`, is the function the firm is derived FROM.
 *
 * See docs/superpowers/specs/2026-08-01-intake-form-builder-design.md.
 */

export type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

export type RequestTypeMode = 'client' | 'inhouse';

export type RequestType = {
  id: string;
  firmId: string;
  /** Written once, never renamed: answers and historical intakes hang off it. */
  key: string;
  /** What legal edits. Safe to change at any time. */
  label: string;
  mode: RequestTypeMode;
  sortOrder: number;
  hidden: boolean;
  createdAt: string;
};

type RequestTypeRow = {
  id: string;
  firm_id: string;
  key: string;
  label: string;
  mode: string | null;
  sort_order: number | null;
  hidden: boolean | null;
  created_at: string;
};

export const REQUEST_TYPE_COLS =
  'id, firm_id, key, label, mode, sort_order, hidden, created_at';

function toRequestType(r: RequestTypeRow): RequestType {
  return {
    id: r.id,
    firmId: r.firm_id,
    key: r.key,
    label: r.label,
    mode: r.mode === 'client' ? 'client' : 'inhouse',
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : 0,
    hidden: r.hidden === true,
    createdAt: r.created_at,
  };
}

/**
 * Every request type the firm has, hidden ones included, in the order legal
 * arranged them. Hidden is a display decision that differs by surface: the
 * settings index has to show hidden types so they can be brought back, while
 * the employee picker filters them out. Filtering here would make the first
 * of those impossible.
 */
export async function listRequestTypes(admin: Admin, firmId: string): Promise<RequestType[]> {
  if (!firmId) return [];
  const { data } = await admin
    .from('firm_request_types')
    .select(REQUEST_TYPE_COLS)
    .eq('firm_id', firmId)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  return ((data ?? []) as RequestTypeRow[]).map(toRequestType);
}

/**
 * One request type by id, with NO firm scoping, because this is what a
 * caller's firm is derived from. An action calls this first and then checks
 * the caller's role against the `firmId` it returns; it must never take a
 * firm id from the caller and pass it here as a filter, which would let a
 * caller assert the very thing being checked.
 */
export async function getRequestTypeById(
  admin: Admin,
  typeId: string,
): Promise<RequestType | null> {
  if (!typeId) return null;
  const { data } = await admin
    .from('firm_request_types')
    .select(REQUEST_TYPE_COLS)
    .eq('id', typeId)
    .maybeSingle();
  return data ? toRequestType(data as RequestTypeRow) : null;
}

export type FormState = {
  requestTypeId: string;
  /** Null until something has been saved against this type. */
  formId: string | null;
  /**
   * The stored draft exactly as written, NOT coerced. A draft is allowed to
   * be incomplete, and `readFormPayload` drops a question that has no label
   * yet, which is precisely the state a half-finished draft is in. The
   * builder needs its own scratch work back verbatim; it can run the draft
   * through `readFormPayload` itself when it wants to preview it.
   */
  draft: unknown;
  draftUpdatedAt: string | null;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  /** Read through the lenient path, because a stored version must render. */
  published: FormPayload | null;
};

type FormRow = {
  id: string;
  draft_payload: unknown;
  published_version_id: string | null;
  updated_at: string | null;
};

const FORM_COLS = 'id, draft_payload, published_version_id, updated_at';

/**
 * The builder's view of one request type: its draft, and the version that is
 * live right now. Returns null when the type does not belong to `firmId`, so
 * a page can treat a foreign or deleted type as not found.
 */
export async function getFormForType(
  admin: Admin,
  firmId: string,
  typeId: string,
): Promise<FormState | null> {
  if (!firmId || !typeId) return null;

  const { data: typeRow } = await admin
    .from('firm_request_types')
    .select('id')
    .eq('id', typeId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!typeRow) return null;

  const { data } = await admin
    .from('firm_intake_forms')
    .select(FORM_COLS)
    .eq('firm_id', firmId)
    .eq('request_type_id', typeId)
    .maybeSingle();
  const form = (data ?? null) as FormRow | null;

  const state: FormState = {
    requestTypeId: typeId,
    formId: form?.id ?? null,
    draft: form?.draft_payload ?? null,
    draftUpdatedAt: form?.draft_payload != null ? form.updated_at ?? null : null,
    publishedVersionId: form?.published_version_id ?? null,
    publishedVersion: null,
    published: null,
  };
  if (!form?.published_version_id) return state;

  const { data: versionRow } = await admin
    .from('firm_intake_form_versions')
    .select('id, version, payload')
    .eq('id', form.published_version_id)
    .maybeSingle();
  const v = (versionRow ?? null) as { version: number | null; payload: unknown } | null;
  if (v) {
    state.publishedVersion = typeof v.version === 'number' ? v.version : null;
    state.published = readFormPayload(v.payload);
  }
  return state;
}

/**
 * The live form for a request type, addressed by its stable `key` rather than
 * its id, which is how an arriving request identifies itself (the partner API
 * sends a slug, not a uuid). Null when the firm has no form published for
 * that type, which is the signal to fall back to the existing hardcoded
 * questions: a firm that never opens the builder must see no change.
 *
 * Hidden types still resolve. Hiding controls what the picker offers next,
 * not whether a request already in flight can be rendered.
 */
export async function getPublishedPayload(
  admin: Admin,
  firmId: string,
  typeKey: string,
): Promise<{ payload: FormPayload; versionId: string } | null> {
  if (!firmId || !typeKey) return null;

  const { data: typeRow } = await admin
    .from('firm_request_types')
    .select('id')
    .eq('firm_id', firmId)
    .eq('key', typeKey)
    .maybeSingle();
  const type = (typeRow ?? null) as { id: string } | null;
  if (!type) return null;

  const { data: formRow } = await admin
    .from('firm_intake_forms')
    .select('published_version_id')
    .eq('firm_id', firmId)
    .eq('request_type_id', type.id)
    .maybeSingle();
  const versionId = (formRow as { published_version_id: string | null } | null)
    ?.published_version_id;
  if (!versionId) return null;

  const { data: versionRow } = await admin
    .from('firm_intake_form_versions')
    .select('id, payload')
    .eq('id', versionId)
    .maybeSingle();
  const v = (versionRow ?? null) as { id: string; payload: unknown } | null;
  if (!v) return null;

  return { payload: readFormPayload(v.payload), versionId: v.id };
}

export type PublishedForms = Record<string, { payload: FormPayload; versionId: string }>;

/**
 * Every form the firm has published, keyed by its request type's `key`.
 *
 * The intake surfaces need this for the whole picker at once, so that changing
 * the selected type does not cost a round trip. `getPublishedPayload` answers
 * the same question for one type, but calling it per type would be three
 * queries per option and Zinpro already has sixteen of them. This is two
 * queries, or three once anything is actually published. The submit path
 * reads this map too, rather than `getPublishedPayload`, because it has to
 * ask whether OTHER types are published in order to break a duplicate-label
 * tie safely.
 *
 * An empty object is the normal answer today and means every type falls back
 * to the existing fixed fields. A failed read returns the same empty object
 * rather than throwing, because a firm must be able to file a request whether
 * or not this feature is reachable.
 */
export async function listPublishedPayloads(
  admin: Admin,
  firmId: string,
): Promise<PublishedForms> {
  if (!firmId) return {};

  const { data: typeRows } = await admin
    .from('firm_request_types')
    .select('id, key')
    .eq('firm_id', firmId);
  const types = (typeRows ?? []) as { id: string; key: string }[];
  if (types.length === 0) return {};

  const { data: formRows } = await admin
    .from('firm_intake_forms')
    .select('request_type_id, published_version_id')
    .eq('firm_id', firmId)
    .not('published_version_id', 'is', null);
  const forms = (formRows ?? []) as {
    request_type_id: string;
    published_version_id: string | null;
  }[];

  const keyByTypeId = new Map(types.map((t) => [t.id, t.key]));
  const keyByVersionId = new Map<string, string>();
  for (const form of forms) {
    const key = keyByTypeId.get(form.request_type_id);
    if (key && form.published_version_id) keyByVersionId.set(form.published_version_id, key);
  }
  if (keyByVersionId.size === 0) return {};

  const { data: versionRows } = await admin
    .from('firm_intake_form_versions')
    .select('id, payload')
    .in('id', [...keyByVersionId.keys()]);

  const published: PublishedForms = {};
  for (const version of (versionRows ?? []) as { id: string; payload: unknown }[]) {
    const key = keyByVersionId.get(version.id);
    if (key) published[key] = { payload: readFormPayload(version.payload), versionId: version.id };
  }
  return published;
}

/** The exact payload of one version, for rendering an intake as it was filed. */
export async function getVersionPayload(
  admin: Admin,
  versionId: string,
): Promise<FormPayload | null> {
  if (!versionId) return null;
  const { data } = await admin
    .from('firm_intake_form_versions')
    .select('payload')
    .eq('id', versionId)
    .maybeSingle();
  if (!data) return null;
  return readFormPayload((data as { payload: unknown }).payload);
}

/**
 * One past the highest version a form already has. Pure, so the numbering can
 * be pinned by a unit test without a database. Rows whose version is missing
 * or nonsensical are ignored rather than allowed to drag the counter
 * backwards onto a number that is already taken.
 */
export function nextVersionNumber(rows: { version: number | null }[] | null): number {
  let highest = 0;
  for (const row of rows ?? []) {
    const v = Number(row?.version);
    if (Number.isFinite(v) && v > highest) highest = v;
  }
  return Math.floor(highest) + 1;
}

/** The version number the next publish of `formId` should take. */
export async function getNextVersion(admin: Admin, formId: string): Promise<number> {
  const { data } = await admin
    .from('firm_intake_form_versions')
    .select('version')
    .eq('form_id', formId)
    .order('version', { ascending: false })
    .limit(1);
  return nextVersionNumber((data ?? []) as { version: number | null }[]);
}
