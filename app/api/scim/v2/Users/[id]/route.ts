import {
  authenticateScim,
  employeeToScimUser,
  readScimUser,
  scimBaseUrl,
  scimError,
  scimJson,
  type EmployeeRow,
  type ScimAuth,
} from '@/lib/scim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT = 'id, email, display_name, external_id, deactivated_at, created_at, department';

async function load(auth: ScimAuth, id: string): Promise<EmployeeRow | null> {
  const { data } = await auth.admin
    .from('firm_employees')
    .select(SELECT)
    .eq('firm_id', auth.firmId)
    .eq('id', id)
    .maybeSingle();
  return (data as EmployeeRow) ?? null;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const e = await load(auth, params.id);
  if (!e) return scimError(404, 'User not found.');
  return scimJson(employeeToScimUser(e, scimBaseUrl(req)));
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const e = await load(auth, params.id);
  if (!e) return scimError(404, 'User not found.');
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimError(400, 'Request body is not valid JSON.', 'invalidSyntax');
  }
  const u = readScimUser(body);
  const { data: upd, error } = await auth.admin
    .from('firm_employees')
    .update({
      display_name: u.displayName ?? e.display_name,
      external_id: u.externalId ?? e.external_id,
      deactivated_at:
        u.active === false ? (e.deactivated_at ?? new Date().toISOString()) : null,
    })
    .eq('id', e.id)
    .select(SELECT)
    .single();
  if (error) return scimError(500, error.message);
  return scimJson(employeeToScimUser(upd as EmployeeRow, scimBaseUrl(req)));
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const e = await load(auth, params.id);
  if (!e) return scimError(404, 'User not found.');
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimError(400, 'Request body is not valid JSON.', 'invalidSyntax');
  }

  // Apply the common Operations IdPs send (deactivate = replace active=false).
  const ops = Array.isArray(body.Operations)
    ? (body.Operations as Array<Record<string, unknown>>)
    : [];
  let active = !e.deactivated_at;
  let displayName = e.display_name;
  const truthy = (v: unknown) => v === true || String(v).toLowerCase() === 'true';
  for (const op of ops) {
    const path = String(op.path ?? '').toLowerCase();
    const value = op.value;
    if (path === 'active') active = truthy(value);
    else if (path === 'displayname') displayName = String(value);
    else if (!op.path && value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if ('active' in v) active = truthy(v.active);
      if ('displayName' in v) displayName = String(v.displayName);
    }
  }

  const { data: upd, error } = await auth.admin
    .from('firm_employees')
    .update({
      deactivated_at: active ? null : (e.deactivated_at ?? new Date().toISOString()),
      display_name: displayName,
    })
    .eq('id', e.id)
    .select(SELECT)
    .single();
  if (error) return scimError(500, error.message);
  return scimJson(employeeToScimUser(upd as EmployeeRow, scimBaseUrl(req)));
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const e = await load(auth, params.id);
  if (!e) return scimError(404, 'User not found.');
  // Soft-deprovision: keep the row (audit) but mark inactive.
  await auth.admin
    .from('firm_employees')
    .update({ deactivated_at: e.deactivated_at ?? new Date().toISOString() })
    .eq('id', e.id);
  return new Response(null, { status: 204 });
}
