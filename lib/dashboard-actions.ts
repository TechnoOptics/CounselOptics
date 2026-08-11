'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import {
  isCounselMetricId,
  isCounselTileId,
  parseDashboardPreferences,
  type CounselTileId,
} from '@/lib/counsel-dashboard';

/**
 * Persist what the signed-in user chose to see on /counsel: which FIGURES
 * are switched off, and which PANELS are on and in what order.
 *
 * Only ids that map to something in the catalog are saved, on both halves.
 * Unknown ones are silently dropped so a stale UI submission never poisons
 * the preferences row - the same rule the read side applies again.
 *
 * `hiddenMetrics` is optional and an omitted one leaves the stored figures
 * alone, so a caller that still sends only the old `{ enabled }` payload
 * cannot wipe somebody's figure choices. The picker never sends a partial
 * hidden set: it merges what it could not offer back in first (see
 * mergeHiddenMetrics), because a figure its workspace hid this week is a
 * choice to keep, not a choice to forget.
 */
export async function updateCounselDashboardPreferencesAction(input: {
  enabled: string[];
  hiddenMetrics?: string[];
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
  const hiddenMetrics =
    input.hiddenMetrics === undefined
      ? current.counsel?.hiddenMetrics
      : (input.hiddenMetrics ?? []).filter(isCounselMetricId);
  const next = {
    ...current,
    counsel: { ...current.counsel, enabled, hiddenMetrics },
  };

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
