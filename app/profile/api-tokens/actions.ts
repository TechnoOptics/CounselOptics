'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createApiToken } from '@/lib/api-tokens';
import { callerIsFirmAdmin } from '@/lib/firm-authz';
import { logSecurityEvent } from '@/lib/security-audit';

export async function createTokenAction(
  name: string,
): Promise<{ ok: boolean; error?: string; token?: string; prefix?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!name.trim()) return { ok: false, error: 'Name is required.' };
  const created = await createApiToken({
    name: name.trim(),
    userId: user.id,
    scopes: ['read'],
  });
  if (!created) {
    return { ok: false, error: 'Server is not fully configured.' };
  }
  revalidatePath('/profile/api-tokens');
  // Same TokensPanel, same rows, rendered inside the firm workspace.
  revalidatePath('/counsel/profile/api-tokens');
  return { ok: true, token: created.token, prefix: created.prefix };
}

/**
 * Firm-scoped integration token (read + write): what a partner app like
 * Zinpro One authenticates with. Only firm owners/admins may mint one, and
 * the token is bound to that firm so the partner API confines every call
 * to it.
 */
export async function createFirmTokenAction(
  name: string,
  firmId: string,
): Promise<{ ok: boolean; error?: string; token?: string; prefix?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!name.trim()) return { ok: false, error: 'Name is required.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };
  const { data: membership } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (membership as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return {
      ok: false,
      error: 'Only firm owners and admins can mint a firm integration token.',
    };
  }
  const created = await createApiToken({
    name: name.trim(),
    userId: user.id,
    firmId,
    scopes: ['read', 'write'],
  });
  if (!created) {
    return { ok: false, error: 'Server is not fully configured.' };
  }
  revalidatePath('/profile/api-tokens');
  // A firm integration token is minted from the counsel route far more
  // often than the consumer one, so this is the invalidation that
  // actually matters for it.
  revalidatePath('/counsel/profile/api-tokens');
  return { ok: true, token: created.token, prefix: created.prefix };
}

/**
 * Revoke an issued token.
 *
 * `revoked_at` is the column lib/api-tokens.ts already filters on when it
 * authenticates a bearer, so setting it is the whole enforcement. It is set,
 * never cleared, and the row is never deleted: the point of the record is
 * that this credential existed and stopped working at a known moment.
 *
 * Three things here are load-bearing.
 *
 * 1. The authorization is INSIDE the action. Next compiles every export of a
 *    'use server' module into a public HTTP endpoint, callable by any
 *    signed-in user with a token id of their choosing, so not rendering the
 *    button is not a gate. The rule is: the user the token was issued to, or
 *    an owner/admin of the firm it is bound to. The firm half asks
 *    lib/firm-authz.ts, the one firm authorization axis in this codebase, and
 *    asks it about the firm stored ON THE TOKEN rather than one the caller
 *    supplied.
 *
 * 2. The write goes through the service-role client, which bypasses RLS, so
 *    the check above is the only one there is. That is deliberate: no UPDATE
 *    policy on `api_tokens` is known to exist, and a user-scoped update that
 *    RLS filters to nothing is indistinguishable from a successful one.
 *
 * 3. Which is the third thing. postgrest-js does not raise when zero rows
 *    match; an `.update().eq()` that hit nothing resolves with `error: null`.
 *    So the update asks for the affected rows back and an empty result is a
 *    failure the caller is told about. Remove the `.select('id')` and
 *    PostgREST returns no body at all, `rows` is null, and this refuses -
 *    which is the right direction, but it means the happy path stops working
 *    rather than quietly lying, and the tests say so.
 */
export async function revokeTokenAction(
  tokenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  if (!tokenId) return { ok: false, error: 'Pick a token to revoke.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };

  const { data } = await admin
    .from('api_tokens')
    .select('id, name, prefix, user_id, firm_id')
    .eq('id', tokenId)
    .maybeSingle();
  const token = data as {
    id: string;
    name: string | null;
    prefix: string | null;
    user_id: string | null;
    firm_id: string | null;
  } | null;

  // A failed read lands here too, and refusing on it is the fail-closed
  // direction. "No such token" and "not yours" get the same sentence so the
  // endpoint cannot be used to learn which token ids exist.
  const refusal = 'That token is not yours to revoke.';
  if (!token) return { ok: false, error: refusal };

  const holdsToken = token.user_id !== null && token.user_id === user.id;
  const administersFirm =
    token.firm_id !== null && (await callerIsFirmAdmin(token.firm_id));
  if (!holdsToken && !administersFirm) return { ok: false, error: refusal };

  const { data: rows, error } = await admin
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    // Keeps the first revocation timestamp: a second attempt matches no row
    // rather than rewriting when the token stopped working.
    .is('revoked_at', null)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!rows || (rows as unknown[]).length === 0) {
    return { ok: false, error: 'That token had already been revoked.' };
  }

  // Revoking a credential is a security event. logSecurityEvent inspects its
  // own `{ error }` and never throws, so this try guards headers() only.
  try {
    const h = headers();
    await logSecurityEvent({
      kind: 'api_token_revoked',
      userId: user.id,
      ip: (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
      userAgent: h.get('user-agent'),
      details: {
        token_id: token.id,
        token_name: token.name,
        prefix: token.prefix,
        firm_id: token.firm_id,
        issued_to_user_id: token.user_id,
        revoked_by_firm_admin: !holdsToken,
      },
    });
  } catch {
    /* best-effort audit */
  }

  revalidatePath('/profile/api-tokens');
  revalidatePath('/counsel/profile/api-tokens');
  return { ok: true };
}
