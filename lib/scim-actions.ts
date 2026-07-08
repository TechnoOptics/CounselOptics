'use server';

import { randomBytes } from 'node:crypto';
import { getCurrentUser } from './supabase/server';
import { getActiveFirmContext } from './firm-storage';
import { createAdminSupabase } from './supabase/admin';
import { hashScimToken } from './scim';

/** Default lifetime for a freshly issued SCIM token: one year. */
const SCIM_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * Resolve the caller and confirm they are an owner/admin of their active firm.
 * Returns the firm id + a service-role client, or an error string. Every SCIM
 * management query is scoped to `firmId` so one firm can never touch another's
 * tokens.
 */
async function requireFirmAdmin(): Promise<
  { firmId: string; userId: string; admin: Admin } | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not signed in.' };
  const ctx = await getActiveFirmContext();
  if (!ctx) return { error: 'No active firm workspace.' };
  const admin = createAdminSupabase();
  if (!admin) return { error: 'Service role not configured on this deployment.' };

  const { data: member } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', ctx.firm.id)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (member as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return { error: 'Only firm owners and admins can manage SCIM.' };
  }
  return { firmId: ctx.firm.id, userId: user.id, admin };
}

/**
 * Issue a new per-firm SCIM bearer token. Owner/admin only. The plaintext
 * token is returned ONCE (only its hash is stored); the admin pastes it
 * into their IdP's provisioning config. The token expires after one year;
 * generating a new token does not revoke old ones — use listScimTokensAction
 * / revokeScimTokenAction to rotate and retire them.
 */
export async function generateScimTokenAction(): Promise<{
  ok: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
}> {
  const ctx = await requireFirmAdmin();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const token = `scim_${randomBytes(24).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + SCIM_TOKEN_TTL_MS).toISOString();
  const { error } = await ctx.admin.from('firm_scim_tokens').insert({
    firm_id: ctx.firmId,
    token_hash: hashScimToken(token),
    created_by: ctx.userId,
    label: 'SCIM provisioning token',
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token, expiresAt };
}

export type ScimTokenSummary = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

/**
 * List the firm's issued SCIM tokens (never the token or its hash — those are
 * write-only). Owner/admin only, scoped to the active firm.
 */
export async function listScimTokensAction(): Promise<{
  ok: boolean;
  tokens?: ScimTokenSummary[];
  error?: string;
}> {
  const ctx = await requireFirmAdmin();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.admin
    .from('firm_scim_tokens')
    .select('id, label, created_at, last_used_at, expires_at, revoked_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<{
    id: string;
    label: string | null;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
    revoked_at: string | null;
  }>;
  return {
    ok: true,
    tokens: rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    })),
  };
}

/**
 * Revoke a SCIM token by id. Owner/admin only. The `firm_id` filter ensures a
 * caller can only revoke tokens belonging to their own firm — an id from
 * another firm matches no row and is a no-op.
 */
export async function revokeScimTokenAction(tokenId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!tokenId) return { ok: false, error: 'Missing token id.' };
  const ctx = await requireFirmAdmin();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const { data, error } = await ctx.admin
    .from('firm_scim_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('firm_id', ctx.firmId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Token not found or already revoked.' };
  return { ok: true };
}
