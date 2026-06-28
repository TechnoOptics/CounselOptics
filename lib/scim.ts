/**
 * SCIM 2.0 helpers. Enterprise IdPs (Entra ID, Okta) call our SCIM
 * endpoints with a per-firm bearer token to provision / deprovision
 * users. A SCIM "User" maps to a `firm_employees` row (the directory
 * record, distinct from firm_members): create -> insert, active=false /
 * DELETE -> set deactivated_at (soft, for audit). Tokens are stored
 * hashed; only the service_role touches firm_scim_tokens.
 */
import { createHash } from 'node:crypto';
import { createAdminSupabase } from './supabase/admin';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export function hashScimToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;
export type ScimAuth = { firmId: string; admin: Admin };

/** Resolve the firm from the Bearer token, or null (caller returns 401). */
export async function authenticateScim(req: Request): Promise<ScimAuth | null> {
  const header = req.headers.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin
    .from('firm_scim_tokens')
    .select('id, firm_id')
    .eq('token_hash', hashScimToken(m[1].trim()))
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; firm_id: string };
  admin
    .from('firm_scim_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(
      () => undefined,
      () => undefined,
    );
  return { firmId: row.firm_id, admin };
}

export type EmployeeRow = {
  id: string;
  email: string;
  display_name: string | null;
  external_id: string | null;
  deactivated_at: string | null;
  created_at: string;
  department: string | null;
};

export function employeeToScimUser(e: EmployeeRow, base: string) {
  const parts = (e.display_name || e.email).trim().split(/\s+/);
  const givenName = parts[0];
  const familyName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: e.id,
    ...(e.external_id ? { externalId: e.external_id } : {}),
    userName: e.email,
    name: { formatted: e.display_name || e.email, givenName, familyName },
    displayName: e.display_name || e.email,
    emails: [{ value: e.email, primary: true, type: 'work' }],
    active: !e.deactivated_at,
    meta: {
      resourceType: 'User',
      created: e.created_at,
      location: `${base}/Users/${e.id}`,
    },
  };
}

/** Pull a userName/email + displayName + active from an inbound SCIM body. */
export function readScimUser(body: Record<string, unknown>): {
  email?: string;
  displayName?: string;
  externalId?: string;
  active?: boolean;
} {
  const emails = Array.isArray(body.emails) ? (body.emails as Array<Record<string, unknown>>) : [];
  const primaryEmail =
    (emails.find((x) => x.primary)?.value as string | undefined) ??
    (emails[0]?.value as string | undefined);
  const name = (body.name as Record<string, unknown> | undefined) ?? {};
  const displayName =
    (body.displayName as string | undefined) ??
    (name.formatted as string | undefined) ??
    ([name.givenName, name.familyName].filter(Boolean).join(' ') || undefined);
  return {
    email: ((body.userName as string | undefined) ?? primaryEmail)?.toLowerCase(),
    displayName,
    externalId: body.externalId as string | undefined,
    active: typeof body.active === 'boolean' ? (body.active as boolean) : undefined,
  };
}

export function scimJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/scim+json' },
  });
}

export function scimError(status: number, detail: string, scimType?: string): Response {
  return scimJson(
    { schemas: [SCIM_ERROR_SCHEMA], detail, status: String(status), ...(scimType ? { scimType } : {}) },
    status,
  );
}

export function scimBaseUrl(req: Request): string {
  return `${new URL(req.url).origin}/api/scim/v2`;
}
