'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import {
  isCounselTileId,
  parseDashboardPreferences,
  type CounselTileId,
} from '@/lib/counsel-dashboard';

/**
 * Persist the Counsel dashboard tile selection for the signed-in
 * user. Only ids that map to a known tile are saved; unknown ones
 * are silently dropped so a stale UI submission never poisons the
 * preferences row.
 */
export async function updateCounselDashboardPreferencesAction(input: {
  enabled: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  const enabled: CounselTileId[] = Array.isArray(input?.enabled)
    ? input.enabled.filter(isCounselTileId)
    : [];

  const supabase = createServerSupabase();
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('dashboard_preferences')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const current = parseDashboardPreferences(profile?.dashboard_preferences);
  const next = { ...current, counsel: { enabled } };

  // Use upsert so a brand-new user (no profiles row yet, edge case
  // when the signup trigger lagged) still gets their preference
  // saved. Conflict on the primary key id - the supabase auth
  // trigger always populates this column, but upsert is harmless if
  // a row already exists.
  const { error: writeError } = await supabase
    .from('profiles')
    .upsert(
      { id: user.id, dashboard_preferences: next },
      { onConflict: 'id' },
    );
  if (writeError) return { ok: false, error: writeError.message };

  revalidatePath('/counsel');
  return { ok: true };
}
