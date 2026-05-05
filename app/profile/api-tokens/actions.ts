'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/supabase/server';
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
