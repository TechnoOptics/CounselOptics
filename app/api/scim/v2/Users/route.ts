import {
  authenticateScim,
  employeeToScimUser,
  readScimUser,
  scimBaseUrl,
  scimError,
  scimJson,
  SCIM_LIST_SCHEMA,
  type EmployeeRow,
} from '@/lib/scim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT = 'id, email, display_name, external_id, deactivated_at, created_at, department';

export async function GET(req: Request) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const base = scimBaseUrl(req);
  const url = new URL(req.url);
  const filter = url.searchParams.get('filter');
  const startIndex = Math.max(1, parseInt(url.searchParams.get('startIndex') || '1', 10) || 1);
  const count = Math.min(200, Math.max(0, parseInt(url.searchParams.get('count') || '100', 10) || 100));

  let q = auth.admin
    .from('firm_employees')
    .select(SELECT, { count: 'exact' })
    .eq('firm_id', auth.firmId);

  // IdPs check existence with `userName eq "x"` before creating.
  if (filter) {
    const m = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (m) q = q.ilike('email', m[1]);
  }

  const { data, count: total, error } = await q
    .order('created_at', { ascending: true })
    .range(startIndex - 1, startIndex - 1 + Math.max(count - 1, 0));
  if (error) return scimError(500, error.message);

  const resources = ((data as EmployeeRow[]) ?? []).map((e) => employeeToScimUser(e, base));
  return scimJson({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: total ?? resources.length,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  });
}

export async function POST(req: Request) {
  const auth = await authenticateScim(req);
  if (!auth) return scimError(401, 'Invalid or missing bearer token.');
  const base = scimBaseUrl(req);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimError(400, 'Request body is not valid JSON.', 'invalidSyntax');
  }
  const u = readScimUser(body);
  if (!u.email) return scimError(400, 'userName (email) is required.', 'invalidValue');

  // Upsert by (firm_id, email): re-provisioning a previously deactivated
  // user reactivates them rather than erroring.
  const { data: existing } = await auth.admin
    .from('firm_employees')
    .select(SELECT)
    .eq('firm_id', auth.firmId)
    .ilike('email', u.email)
    .maybeSingle();

  if (existing) {
    const e = existing as EmployeeRow;
    const { data: upd, error } = await auth.admin
      .from('firm_employees')
      .update({
        display_name: u.displayName ?? e.display_name,
        external_id: u.externalId ?? e.external_id,
        deactivated_at: u.active === false ? new Date().toISOString() : null,
      })
      .eq('id', e.id)
      .select(SELECT)
      .single();
    if (error) return scimError(500, error.message);
    return scimJson(employeeToScimUser(upd as EmployeeRow, base), 200);
  }

  const { data: created, error } = await auth.admin
    .from('firm_employees')
    .insert({
      firm_id: auth.firmId,
      email: u.email,
      display_name: u.displayName ?? null,
      external_id: u.externalId ?? null,
      source: 'scim',
      deactivated_at: u.active === false ? new Date().toISOString() : null,
    })
    .select(SELECT)
    .single();
  if (error) return scimError(409, error.message, 'uniqueness');
  return scimJson(employeeToScimUser(created as EmployeeRow, base), 201);
}
