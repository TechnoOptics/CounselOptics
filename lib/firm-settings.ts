import 'server-only';
import { createServerSupabase } from './supabase/server';

/**
 * Per-firm surface toggles (firm_settings.hide_search /
 * hide_time_billing). These let an owner/admin hide whole surfaces of
 * the Counsel workspace they don't use - the global search box and the
 * Time & Billing group. Both default OFF, so a firm with no row (or an
 * older row from before these columns existed) sees everything.
 *
 * Reads go through the user-scoped client: the firm_settings
 * member-select policy lets any member read their own firm's flags,
 * which is all the layout / sidebar need. Writes live in
 * lib/firm-settings-actions.ts and are gated to owner/admin.
 */

export type FirmSurfaceSettings = {
  hideSearch: boolean;
  hideTimeBilling: boolean;
};

export const DEFAULT_FIRM_SURFACE_SETTINGS: FirmSurfaceSettings = {
  hideSearch: false,
  hideTimeBilling: false,
};

/** Read a firm's surface toggles (defaults to all-visible). */
export async function getFirmSurfaceSettings(
  firmId: string,
): Promise<FirmSurfaceSettings> {
  try {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('firm_settings')
      .select('hide_search, hide_time_billing')
      .eq('firm_id', firmId)
      .maybeSingle();
    const r = data as
      | { hide_search: boolean | null; hide_time_billing: boolean | null }
      | null;
    return {
      hideSearch: Boolean(r?.hide_search),
      hideTimeBilling: Boolean(r?.hide_time_billing),
    };
  } catch {
    // Never let a settings-read hiccup break the whole Counsel shell.
    return DEFAULT_FIRM_SURFACE_SETTINGS;
  }
}
