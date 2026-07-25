'use server';

import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';

/**
 * Firm-owned form templates ("Forms"): the legal team configures reusable
 * documents (NDA, vendor form, …) with {{field}} placeholders; employees fill,
 * sign, and export them from the Hub portal — self-service for request types
 * that used to become tickets.
 *
 * firm_templates carries RLS with NO policies: every path below runs on the
 * service-role client behind an explicit gate — firm membership for authoring,
 * authorizeFirmActor (employee entitlement) for reading published templates.
 */

export type TemplateField = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'textarea';
  required: boolean;
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
    });
  }
  return out;
}

export async function createFirmTemplateAction(
  firmId: string,
  input: { name: string; description?: string; category?: string; body: string; fields: TemplateField[]; status?: 'draft' | 'published' },
): Promise<{ ok: boolean; error?: string; template?: FirmTemplate }> {
  const gate = await requireAuthor(firmId);
  if ('error' in gate) return { ok: false, error: gate.error };
  const name = input.name.trim().slice(0, 120);
  const body = input.body.trim().slice(0, 100000);
  if (!name || !body) return { ok: false, error: 'Give the template a name and a body.' };
  const { data, error } = await gate.admin
    .from('firm_templates')
    .insert({
      firm_id: firmId,
      name,
      description: input.description?.trim().slice(0, 500) || null,
      category: input.category?.trim().slice(0, 60) || null,
      body,
      fields: sanitizeFields(input.fields),
      status: input.status === 'draft' ? 'draft' : 'published',
      created_by: gate.user.id,
    })
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the template.' };
  return { ok: true, template: toTemplate(data as Row) };
}

export async function updateFirmTemplateAction(
  firmId: string,
  templateId: string,
  input: Partial<{ name: string; description: string; category: string; body: string; fields: TemplateField[]; status: 'draft' | 'published' | 'archived' }>,
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
  const { data, error } = await gate.admin
    .from('firm_templates')
    .update(patch)
    .eq('id', templateId)
    .eq('firm_id', firmId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not update the template.' };
  return { ok: true, template: toTemplate(data as Row) };
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
