'use server';

import { randomBytes } from 'node:crypto';
import { getCurrentUser } from './supabase/server';
import { getActiveFirmContext } from './firm-storage';
import { createAdminSupabase } from './supabase/admin';
import { hashScimToken } from './scim';

/**
 * Issue a new per-firm SCIM bearer token. Owner/admin only. The plaintext
 * token is returned ONCE (only its hash is stored); the admin pastes it
 * into their IdP's provisioning config. Generating a new token does not
 * revoke old ones — call this again to rotate, and old tokens can be
 * cleared out separately.
 */
export async function generateScimTokenAction(): Promise<{
  ok: boolean;
  token?: string;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const ctx = await getActiveFirmContext();
  if (!ctx) return { ok: false, error: 'No active firm workspace.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service role not configured on this deployment.' };

  const { data: member } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', ctx.firm.id)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (member as { role?: string } | null)?.role;
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only firm owners and admins can manage SCIM.' };
  }

  const token = `scim_${randomBytes(24).toString('base64url')}`;
  const { error } = await admin.from('firm_scim_tokens').insert({
    firm_id: ctx.firm.id,
    token_hash: hashScimToken(token),
    created_by: user.id,
    label: 'SCIM provisioning token',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, token };
}
