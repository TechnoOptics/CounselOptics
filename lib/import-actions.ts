'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getActiveFirmContext } from './firm-storage';
import { parseCsv } from './csv';

/**
 * Onboarding / migration server actions for /counsel/import.
 *
 * Four lanes:
 *   - Clients CSV  -> firm_clients (creates a placeholder auth user
 *                     per email when one doesn't exist yet, the same
 *                     way the existing invite flow does)
 *   - Cases CSV    -> cases (firm-owned shells; user_id = importer
 *                     until the client linkage is filled in later)
 *   - Bulk docs    -> firm_documents + storage upload
 *   - JSON dump    -> mixed envelope, applies each section in order
 *
 * Default primary-attorney routing per the firm's preference: any
 * imported client/case is owned by the firm's first paralegal (by
 * joined_at). When no paralegal is on the firm, falls back to the
 * importer's user_id so the data still has an owner.
 *
 * All writes use the admin (service-role) client. We verify firm
 * membership at the top of every action before doing any work.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

async function requireFirmMember(): Promise<
  | { firmId: string; userId: string; admin: ReturnType<typeof createAdminSupabase> }
  | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not signed in.' };
  const ctx = await getActiveFirmContext();
  if (!ctx) return { error: 'No active firm context.' };
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Service role not configured on this deployment.' };
  // Bulk import runs through the service-role client (RLS-bypassing) and can
  // mass-create clients / cases / employees and seed role entitlements, so it
  // must be owner/admin-only, not any member (a read-only staff member could
  // otherwise provision the whole firm).
  const { data: membership } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', ctx.firm.id)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (membership as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return { error: 'Only firm owners or admins can import data.' };
  }
  return { firmId: ctx.firm.id, userId: user.id, admin };
}

/**
 * Resolve the default primary attorney for an imported row. Firm
 * convention (per onboarding setup): the firm's paralegal is the
 * first owner of any incoming client/case so they can triage and
 * pull in the necessary attorneys. Falls back to the user running
 * the import when no paralegal exists yet.
 */
async function resolveDefaultPrimaryAttorney(
  admin: NonNullable<ReturnType<typeof createAdminSupabase>>,
  firmId: string,
  fallbackUserId: string,
): Promise<string> {
  try {
    const { data } = await admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', firmId)
      .eq('role', 'paralegal')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const uid = (data as { user_id?: string } | null)?.user_id;
    if (uid) return uid;
  } catch {
    /* fall through to fallback */
  }
  return fallbackUserId;
}

// =====================================================================
// CSV PREVIEW
// =====================================================================

export async function previewCsvAction(input: {
  csvText: string;
  /** Cap rows shown in the preview so a huge file doesn't fill the UI. */
  previewRows?: number;
}): Promise<
  Result<{
    headers: string[];
    sample: Record<string, string>[];
    totalRows: number;
  }>
> {
  try {
    const parsed = parseCsv(input.csvText ?? '');
    if (parsed.headers.length === 0) {
      return { ok: false, error: 'CSV looks empty or has no header row.' };
    }
    const cap = Math.min(20, Math.max(1, input.previewRows ?? 5));
    return {
      ok: true,
      headers: parsed.headers,
      sample: parsed.rows.slice(0, cap),
      totalRows: parsed.rows.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not parse CSV.',
    };
  }
}

// =====================================================================
// LANE 1: Clients CSV
// =====================================================================

export type ClientsImportMapping = {
  email: string;
  displayName?: string;
  status?: string;
  attorneyEmail?: string;
  notes?: string;
};

export async function importClientsCsvAction(input: {
  csvText: string;
  mapping: ClientsImportMapping;
}): Promise<
  Result<{
    created: number;
    skipped: number;
    failures: Array<{ row: number; reason: string }>;
  }>
> {
  const ctx = await requireFirmMember();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { firmId, userId } = ctx;
  if (!ctx.admin) return { ok: false, error: 'Service role not configured.' };
  // Capture into a non-null local so nested closures (attorneyIdFor
  // below) keep the narrowing - TS otherwise loses it across the
  // function boundary.
  const admin: NonNullable<typeof ctx.admin> = ctx.admin;
  if (!input.mapping?.email) {
    return { ok: false, error: 'Map the email column before importing.' };
  }

  let parsed;
  try {
    parsed = parseCsv(input.csvText);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not parse CSV.',
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: 'CSV had no data rows after the header.' };
  }
  if (!parsed.headers.includes(input.mapping.email.toLowerCase())) {
    return {
      ok: false,
      error: `Email column "${input.mapping.email}" not in CSV headers.`,
    };
  }

  const defaultAttorney = await resolveDefaultPrimaryAttorney(
    admin,
    firmId,
    userId,
  );

  // Cache the attorney lookup so we don't re-query for every row that
  // shares an attorney email.
  const attorneyByEmail = new Map<string, string>();
  async function attorneyIdFor(email: string): Promise<string | null> {
    const key = email.trim().toLowerCase();
    if (!key) return null;
    if (attorneyByEmail.has(key)) return attorneyByEmail.get(key)!;
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = data.users.find((u) => (u.email ?? '').toLowerCase() === key);
      if (!found) {
        attorneyByEmail.set(key, '');
        return null;
      }
      // Must be a member of this firm for the linkage to make sense.
      const { data: mem } = await admin
        .from('firm_members')
        .select('user_id')
        .eq('firm_id', firmId)
        .eq('user_id', found.id)
        .maybeSingle();
      const id = (mem as { user_id?: string } | null)?.user_id ?? '';
      attorneyByEmail.set(key, id);
      return id || null;
    } catch {
      attorneyByEmail.set(key, '');
      return null;
    }
  }

  const failures: Array<{ row: number; reason: string }> = [];
  let created = 0;
  let skipped = 0;

  const emailKey = input.mapping.email.toLowerCase();
  const dnKey = input.mapping.displayName?.toLowerCase();
  const statusKey = input.mapping.status?.toLowerCase();
  const atyEmailKey = input.mapping.attorneyEmail?.toLowerCase();

  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i]!;
    const email = (r[emailKey] ?? '').trim().toLowerCase();
    if (!email) {
      failures.push({ row: i + 2, reason: 'Empty email' });
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      failures.push({ row: i + 2, reason: `Invalid email: ${email}` });
      continue;
    }
    const displayName = dnKey ? (r[dnKey] ?? '').trim() : '';
    const status = statusKey ? (r[statusKey] ?? '').trim().toLowerCase() : '';
    const safeStatus =
      status === 'active' || status === 'archived' ? status : 'invited';

    // Find or create the auth user. We're conservative: createUser
    // with `email_confirm: false` so they still need to verify the
    // magic link before they can sign in, exactly the same as a
    // normal client invite.
    let clientUserId: string | null = null;
    try {
      const { data } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      const found = data.users.find(
        (u) => (u.email ?? '').toLowerCase() === email,
      );
      if (found) {
        clientUserId = found.id;
      } else {
        const created = await admin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: displayName ? { full_name: displayName } : undefined,
        });
        if (created.error || !created.data.user) {
          failures.push({
            row: i + 2,
            reason: created.error?.message ?? 'createUser returned no user',
          });
          continue;
        }
        clientUserId = created.data.user.id;
      }
    } catch (err) {
      failures.push({
        row: i + 2,
        reason: err instanceof Error ? err.message : 'auth lookup failed',
      });
      continue;
    }

    // De-dupe: if this client is already on the firm, skip.
    const { data: existing } = await admin
      .from('firm_clients')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', clientUserId)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    // Resolve primary attorney for this row (per-row override -> firm default).
    let attorneyId = defaultAttorney;
    if (atyEmailKey) {
      const v = (r[atyEmailKey] ?? '').trim();
      if (v) {
        const id = await attorneyIdFor(v);
        if (id) attorneyId = id;
      }
    }

    const { error: insertErr } = await admin.from('firm_clients').insert({
      firm_id: firmId,
      user_id: clientUserId,
      primary_attorney_id: attorneyId,
      invited_by: userId,
      status: safeStatus,
    });
    if (insertErr) {
      failures.push({ row: i + 2, reason: insertErr.message });
      continue;
    }
    created += 1;
  }

  revalidatePath('/counsel/clients');
  revalidatePath('/counsel');
  return { ok: true, created, skipped, failures };
}

// =====================================================================
// LANE: Employees CSV (#8) - pre-provisioned Hub accounts
// =====================================================================

export type EmployeesImportMapping = {
  email: string;
  displayName?: string;
  department?: string;
  roleKey?: string;
  externalId?: string;
};

/**
 * Import an employee roster (#8). Unlike the Clients lane, we do NOT
 * create an auth user up front: we drop a firm_employees row with
 * user_id = null, pre-populated with the person's details. The persona
 * resolver (lib/persona.ts) auto-links that row to the real auth user
 * the first time they sign in with a matching email - which is exactly
 * "creates accounts with prepopulated data waiting for their first
 * sign in". Works for a ServiceNow / Workday / HRIS export (map the
 * columns) or a plain spreadsheet; a live API adapter is a separate,
 * credential-gated follow-up.
 *
 * Idempotent per firm: an email already on the firm (as an employee)
 * is skipped, so re-running an updated export won't duplicate people.
 */
export async function importEmployeesCsvAction(input: {
  csvText: string;
  mapping: EmployeesImportMapping;
}): Promise<
  Result<{
    created: number;
    skipped: number;
    failures: Array<{ row: number; reason: string }>;
  }>
> {
  const ctx = await requireFirmMember();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { firmId } = ctx;
  if (!ctx.admin) return { ok: false, error: 'Service role not configured.' };
  const admin: NonNullable<typeof ctx.admin> = ctx.admin;
  if (!input.mapping?.email) {
    return { ok: false, error: 'Map the email column before importing.' };
  }

  let parsed;
  try {
    parsed = parseCsv(input.csvText);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not parse CSV.',
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: 'CSV had no data rows after the header.' };
  }
  if (!parsed.headers.includes(input.mapping.email.toLowerCase())) {
    return {
      ok: false,
      error: `Email column "${input.mapping.email}" not in CSV headers.`,
    };
  }

  const emailKey = input.mapping.email.toLowerCase();
  const dnKey = input.mapping.displayName?.toLowerCase();
  const deptKey = input.mapping.department?.toLowerCase();
  const roleKey = input.mapping.roleKey?.toLowerCase();
  const extKey = input.mapping.externalId?.toLowerCase();

  const failures: Array<{ row: number; reason: string }> = [];
  let created = 0;
  let skipped = 0;
  // Guard against duplicate emails within the same file too.
  const seen = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i]!;
    const email = (r[emailKey] ?? '').trim().toLowerCase();
    if (!email) {
      failures.push({ row: i + 2, reason: 'Empty email' });
      continue;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      failures.push({ row: i + 2, reason: `Invalid email: ${email}` });
      continue;
    }
    if (seen.has(email)) {
      skipped += 1;
      continue;
    }
    seen.add(email);

    // Already an employee on this firm? Skip (idempotent re-import).
    const { data: existing } = await admin
      .from('firm_employees')
      .select('id')
      .eq('firm_id', firmId)
      .ilike('email', email)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const displayName = dnKey ? (r[dnKey] ?? '').trim() || null : null;
    const department = deptKey ? (r[deptKey] ?? '').trim() || null : null;
    const roleVal = roleKey ? (r[roleKey] ?? '').trim() || null : null;
    const externalId = extKey ? (r[extKey] ?? '').trim() || null : null;

    const { error: insertErr } = await admin.from('firm_employees').insert({
      firm_id: firmId,
      user_id: null, // linked on first sign-in by lib/persona.ts
      email,
      display_name: displayName,
      department,
      role_key: roleVal,
      source: 'manual',
      external_id: externalId,
    });
    if (insertErr) {
      failures.push({ row: i + 2, reason: insertErr.message });
      continue;
    }
    created += 1;
  }

  revalidatePath('/counsel/employees');
  revalidatePath('/counsel');
  return { ok: true, created, skipped, failures };
}

// =====================================================================
// LANE 2: Cases CSV
// =====================================================================

export type CasesImportMapping = {
  title: string;
  subjectName?: string;
  subjectType?: string;
  caseType?: string;
  jurisdictionState?: string;
  jurisdictionCity?: string;
  status?: string;
  description?: string;
};

export async function importCasesCsvAction(input: {
  csvText: string;
  mapping: CasesImportMapping;
}): Promise<
  Result<{
    created: number;
    failures: Array<{ row: number; reason: string }>;
  }>
> {
  const ctx = await requireFirmMember();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { firmId, userId, admin } = ctx;
  if (!admin) return { ok: false, error: 'Service role not configured.' };
  if (!input.mapping?.title) {
    return { ok: false, error: 'Map the title column before importing.' };
  }

  let parsed;
  try {
    parsed = parseCsv(input.csvText);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not parse CSV.',
    };
  }
  if (parsed.rows.length === 0) {
    return { ok: false, error: 'CSV had no data rows.' };
  }

  const failures: Array<{ row: number; reason: string }> = [];
  let created = 0;
  const m = input.mapping;
  const lower = (s?: string) => (s ? s.toLowerCase() : undefined);
  const k = {
    title: m.title.toLowerCase(),
    subjectName: lower(m.subjectName),
    subjectType: lower(m.subjectType),
    caseType: lower(m.caseType),
    jurisdictionState: lower(m.jurisdictionState),
    jurisdictionCity: lower(m.jurisdictionCity),
    status: lower(m.status),
    description: lower(m.description),
  };

  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i]!;
    const title = (r[k.title] ?? '').trim();
    if (!title) {
      failures.push({ row: i + 2, reason: 'Empty title' });
      continue;
    }
    const subjectName = k.subjectName ? (r[k.subjectName] ?? '').trim() : '';
    const subjectType = (k.subjectType ? (r[k.subjectType] ?? '').trim() : 'other') || 'other';
    const caseType = (k.caseType ? (r[k.caseType] ?? '').trim() : 'other') || 'other';
    const status = (k.status ? (r[k.status] ?? '').trim().toLowerCase() : 'open') || 'open';
    const description = k.description ? (r[k.description] ?? '').trim() : '';
    const jurState = k.jurisdictionState ? (r[k.jurisdictionState] ?? '').trim() : '';
    const jurCity = k.jurisdictionCity ? (r[k.jurisdictionCity] ?? '').trim() : '';

    const { error: insertErr } = await admin.from('cases').insert({
      firm_id: firmId,
      user_id: userId, // placeholder owner; link to a client later
      title,
      subject_name: subjectName || title,
      subject_type: subjectType,
      case_type: caseType,
      status,
      posture: 'claimant',
      description,
      jurisdiction_country: 'US',
      jurisdiction_state: jurState,
      jurisdiction_city: jurCity,
      sandbox: false,
    });
    if (insertErr) {
      failures.push({ row: i + 2, reason: insertErr.message });
      continue;
    }
    created += 1;
  }

  revalidatePath('/counsel/cases');
  revalidatePath('/counsel');
  return { ok: true, created, failures };
}

// =====================================================================
// LANE 3: Bulk document upload
// =====================================================================

export type BulkDocsImportOptions = {
  caseId?: string | null;
  clientUserId?: string | null;
  tag?: string | null;
};

export async function importBulkDocumentAction(input: {
  fileName: string;
  mimeType: string;
  /** Base64-encoded bytes. Caller is responsible for size limits. */
  base64: string;
  options?: BulkDocsImportOptions;
}): Promise<Result<{ documentId: string }>> {
  const ctx = await requireFirmMember();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { firmId, userId, admin } = ctx;
  if (!admin) return { ok: false, error: 'Service role not configured.' };

  const fileName = (input.fileName ?? '').trim();
  if (!fileName) return { ok: false, error: 'File name is required.' };

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.base64, 'base64');
  } catch {
    return { ok: false, error: 'Could not decode file body.' };
  }
  if (buffer.length === 0) {
    return { ok: false, error: 'File is empty.' };
  }
  if (buffer.length > 50 * 1024 * 1024) {
    return { ok: false, error: 'File too large (50 MB cap on this surface).' };
  }

  // The matter and client ids come from the caller and are written through the
  // service-role client, so confirm both belong to this firm before they are
  // stamped onto a document row.
  const linkedCaseId = input.options?.caseId ?? null;
  if (linkedCaseId) {
    const { data: kase } = await admin
      .from('cases')
      .select('id')
      .eq('id', linkedCaseId)
      .eq('firm_id', firmId)
      .maybeSingle();
    if (!kase) return { ok: false, error: 'That matter is not in this firm.' };
  }
  const linkedClientUserId = input.options?.clientUserId ?? null;
  if (linkedClientUserId) {
    const { data: client } = await admin
      .from('firm_clients')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', linkedClientUserId)
      .maybeSingle();
    if (!client) return { ok: false, error: 'That client is not on this firm.' };
  }

  const id = crypto.randomUUID();
  const safeName = fileName.slice(0, 120).replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
  const filePath = `${firmId}/${id}/${safeName}`;
  const upload = await admin.storage
    .from('firm-documents')
    .upload(filePath, buffer, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (upload.error) return { ok: false, error: upload.error.message };

  const tags = ['imported'];
  if (input.options?.tag) tags.push(input.options.tag);

  const { error: insertErr } = await admin.from('firm_documents').insert({
    id,
    firm_id: firmId,
    name: fileName,
    mime_type: input.mimeType || 'application/octet-stream',
    file_path: filePath,
    file_size: buffer.length,
    version: 1,
    uploaded_by: userId,
    tags,
    case_id: linkedCaseId,
    client_user_id: linkedClientUserId,
    status: 'received',
    description: 'Uploaded via /counsel/import bulk uploader.',
  });
  if (insertErr) {
    // Try to clean up storage if the DB insert failed so we don't
    // leave an orphan file behind.
    await admin.storage.from('firm-documents').remove([filePath]).catch(() => null);
    return { ok: false, error: insertErr.message };
  }

  revalidatePath('/counsel/documents');
  return { ok: true, documentId: id };
}

// =====================================================================
// LANE 4: JSON dump import
// =====================================================================

type JsonDump = {
  clients?: Array<{
    email: string;
    display_name?: string;
    status?: string;
  }>;
  cases?: Array<{
    title: string;
    subject_name?: string;
    subject_type?: string;
    case_type?: string;
    status?: string;
    description?: string;
    jurisdiction_state?: string;
    jurisdiction_city?: string;
  }>;
  intakes?: Array<{
    client_name: string;
    matter_type?: string;
    jurisdiction_state?: string;
    matter_summary?: string;
    status?: string;
  }>;
};

export async function previewJsonDumpAction(input: {
  jsonText: string;
}): Promise<
  Result<{
    counts: { clients: number; cases: number; intakes: number };
  }>
> {
  try {
    const o = JSON.parse(input.jsonText) as JsonDump;
    return {
      ok: true,
      counts: {
        clients: o.clients?.length ?? 0,
        cases: o.cases?.length ?? 0,
        intakes: o.intakes?.length ?? 0,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON.',
    };
  }
}

export async function importJsonDumpAction(input: {
  jsonText: string;
}): Promise<
  Result<{
    clientsCreated: number;
    casesCreated: number;
    intakesCreated: number;
    failures: string[];
  }>
> {
  const ctx = await requireFirmMember();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const { firmId, userId, admin } = ctx;
  if (!admin) return { ok: false, error: 'Service role not configured.' };

  let dump: JsonDump;
  try {
    dump = JSON.parse(input.jsonText) as JsonDump;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid JSON.',
    };
  }

  const defaultAttorney = await resolveDefaultPrimaryAttorney(
    admin,
    firmId,
    userId,
  );

  const failures: string[] = [];
  let clientsCreated = 0;
  let casesCreated = 0;
  let intakesCreated = 0;

  for (const c of dump.clients ?? []) {
    const email = (c.email ?? '').trim().toLowerCase();
    if (!email) {
      failures.push('client: missing email');
      continue;
    }
    try {
      const { data } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      let uid = data.users.find(
        (u) => (u.email ?? '').toLowerCase() === email,
      )?.id;
      if (!uid) {
        const created = await admin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: c.display_name ? { full_name: c.display_name } : undefined,
        });
        if (created.error || !created.data.user) {
          failures.push(`client ${email}: ${created.error?.message ?? 'create failed'}`);
          continue;
        }
        uid = created.data.user.id;
      }
      const { data: existing } = await admin
        .from('firm_clients')
        .select('id')
        .eq('firm_id', firmId)
        .eq('user_id', uid)
        .maybeSingle();
      if (existing) continue;
      const { error: insErr } = await admin.from('firm_clients').insert({
        firm_id: firmId,
        user_id: uid,
        primary_attorney_id: defaultAttorney,
        invited_by: userId,
        status: c.status === 'active' || c.status === 'archived' ? c.status : 'invited',
      });
      if (insErr) {
        failures.push(`client ${email}: ${insErr.message}`);
        continue;
      }
      clientsCreated += 1;
    } catch (err) {
      failures.push(`client ${email}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  for (const k of dump.cases ?? []) {
    const title = (k.title ?? '').trim();
    if (!title) {
      failures.push('case: missing title');
      continue;
    }
    const { error: insErr } = await admin.from('cases').insert({
      firm_id: firmId,
      user_id: userId,
      title,
      subject_name: k.subject_name || title,
      subject_type: k.subject_type || 'other',
      case_type: k.case_type || 'other',
      status: k.status || 'open',
      posture: 'claimant',
      description: k.description || '',
      jurisdiction_country: 'US',
      jurisdiction_state: k.jurisdiction_state || '',
      jurisdiction_city: k.jurisdiction_city || '',
      sandbox: false,
    });
    if (insErr) {
      failures.push(`case ${title}: ${insErr.message}`);
      continue;
    }
    casesCreated += 1;
  }

  for (const it of dump.intakes ?? []) {
    const clientName = (it.client_name ?? '').trim();
    if (!clientName) {
      failures.push('intake: missing client_name');
      continue;
    }
    const { error: insErr } = await admin.from('firm_matter_intakes').insert({
      firm_id: firmId,
      created_by: userId,
      client_name: clientName,
      matter_type: it.matter_type || null,
      jurisdiction_state: it.jurisdiction_state || null,
      matter_summary: it.matter_summary || null,
      status: it.status || 'pending',
      intake_answers: { imported: true, source: 'json_dump' },
    });
    if (insErr) {
      failures.push(`intake ${clientName}: ${insErr.message}`);
      continue;
    }
    intakesCreated += 1;
  }

  revalidatePath('/counsel/clients');
  revalidatePath('/counsel/cases');
  revalidatePath('/counsel/inbox');
  revalidatePath('/counsel');
  return {
    ok: true,
    clientsCreated,
    casesCreated,
    intakesCreated,
    failures,
  };
}
