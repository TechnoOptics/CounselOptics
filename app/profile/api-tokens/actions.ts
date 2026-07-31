'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createApiToken } from '@/lib/api-tokens';

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
  return { ok: true, token: created.token, prefix: created.prefix };
}
