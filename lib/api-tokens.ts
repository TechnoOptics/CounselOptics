import crypto from 'node:crypto';
import { createAdminSupabase } from './supabase/admin';

/**
 * Public API token issuance + verification.
 *
 * Tokens look like: adv_<24 random bytes base64url>. The prefix
 * (first 8 chars) is stored alongside a SHA-256 hash so we can
 * surface "last used adv_AbCd...XyZ" in the dashboard while keeping
 * the secret unrecoverable from the database.
 *
 * Verify path: split prefix off, hash the rest, compare against
 * api_tokens.token_hash where revoked_at is null and expires_at is
 * future. Update last_used_at on success.
 */

export type ApiTokenScope = 'read' | 'write' | 'admin';

export type CreatedToken = {
  id: string;
  /** Plaintext - shown to the user ONCE. */
  token: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
};

export type VerifiedToken = {
  id: string;
  firmId: string | null;
  userId: string | null;
  scopes: ApiTokenScope[];
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createApiToken(input: {
  name: string;
  firmId?: string | null;
  userId?: string | null;
  scopes?: ApiTokenScope[];
  expiresAt?: string | null;
}): Promise<CreatedToken | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;
  const raw = crypto.randomBytes(24).toString('base64url');
  const token = `adv_${raw}`;
  const prefix = token.slice(0, 12);
  const tokenHash = hashToken(token);
  const scopes = input.scopes ?? ['read'];
  const { data, error } = await admin
    .from('api_tokens')
    .insert({
      name: input.name,
      firm_id: input.firmId ?? null,
      user_id: input.userId ?? null,
      token_hash: tokenHash,
      prefix,
      scopes,
      expires_at: input.expiresAt ?? null,
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return {
    id: (data as { id: string }).id,
    token,
    prefix,
    scopes,
    expiresAt: input.expiresAt ?? null,
  };
}

export async function verifyApiToken(
  authorizationHeader: string | null,
): Promise<VerifiedToken | null> {
  if (!authorizationHeader) return null;
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token.startsWith('adv_')) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const tokenHash = hashToken(token);
  const { data } = await admin
    .from('api_tokens')
    .select('id, firm_id, user_id, scopes, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    firm_id: string | null;
    user_id: string | null;
    scopes: string[];
    expires_at: string | null;
    revoked_at: string | null;
  };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  // A FIRM-BOUND TOKEN IS ONLY GOOD IF ITS HOLDER IS STILL IN THAT FIRM.
  //
  // Everything below this line in the request is scoped by `firm_id` alone,
  // through the service-role client, which answers to no RLS. So the row's
  // firm_id is the whole authorization, and until this check existed the row
  // was simply believed.
  //
  // That mattered because the row was not only written by us. `api_tokens`
  // carried an RLS policy, `api_tokens_owner_write`, that was `for all to
  // authenticated` with the check `user_id = auth.uid() OR <owner/admin of
  // firm_id>`. The OR is the defect: naming yourself in user_id satisfies it
  // and leaves firm_id and scopes unconstrained, so any signed-in person could
  // insert a row pointing at ANY firm with scopes ['admin'] and then present
  // the plaintext whose hash they had just stored. The policy was dropped from
  // production on 2026-08-15; this check is here so that dropping it is not
  // the only thing standing between a forged row and another firm's evidence.
  //
  // It also closes the ordinary case the policy had nothing to do with: a
  // person who leaves a firm, or is removed from it, keeps any token they
  // minted while they were a member. The credential outlived the membership.
  if (row.firm_id) {
    // Belt to the lookup's braces: `user_id = NULL` is never true in SQL, so
    // the query below would refuse a holder-less row anyway. Said explicitly
    // rather than left to rest on that.
    if (!row.user_id) return null;
    const { data: member } = await admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', row.firm_id)
      .eq('user_id', row.user_id)
      .maybeSingle();
    if (!member) return null;
  }

  // Touch last_used_at (best-effort; do not block the request).
  admin
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => undefined, () => undefined);
  return {
    id: row.id,
    firmId: row.firm_id,
    userId: row.user_id,
    scopes: (row.scopes as ApiTokenScope[]) ?? ['read'],
  };
}

export function tokenHasScope(
  token: VerifiedToken,
  scope: ApiTokenScope,
): boolean {
  if (token.scopes.includes('admin')) return true;
  if (scope === 'read') {
    return token.scopes.includes('read') || token.scopes.includes('write');
  }
  return token.scopes.includes(scope);
}
