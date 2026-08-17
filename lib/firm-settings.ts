import 'server-only';
import { createServerSupabase } from './supabase/server';
import { readRequestPrefix, readTicketPrefix } from './ticket-allocator';
import { FIRM_TYPES, type Firm, type FirmType } from './firm-types';
import {
  readSurfaceOverrides,
  surfaceDecision,
  type SurfaceSource,
  type WorkspaceSurface,
} from './firm-workspace';

/**
 * Which surfaces of the Counsel workspace this firm has.
 *
 * Three inputs, resolved here into one answer:
 *
 *   - the firm's TYPE (firms.firm_type). An in-house or government legal team
 *     does not invoice a client, hold client funds, or buy inbound work, so
 *     Time/Billing/Trust and Leads/Referrals default to hidden for those two.
 *     Every other type keeps today's workspace exactly.
 *   - the owner's OVERRIDE (firms.metadata.surfaceOverrides), which beats the
 *     type default in either direction.
 *   - the legacy per-firm toggles (firm_settings.hide_search /
 *     hide_time_billing). hide_search is still a plain boolean and is nobody
 *     else's business; hide_time_billing is now a hide-only latch so that
 *     every firm that already switched Time & Billing off keeps it off.
 *
 * The precedence lives in lib/firm-workspace.ts, which is pure, so the
 * settings UI and the tests read the same table this does.
 *
 * Reads go through the user-scoped client: the firm_settings
 * member-select policy lets any member read their own firm's flags,
 * which is all the layout / sidebar need. Writes live in
 * lib/firm-settings-actions.ts and are gated to owner/admin.
 */

export type FirmSurfaceSettings = {
  hideSearch: boolean;
  /**
   * EFFECTIVE, not stored. Resolved from the firm's type, its owner's
   * override, and the legacy hide_time_billing column, in that order of
   * precedence. See lib/firm-workspace.ts.
   */
  hideTimeBilling: boolean;
  /** Effective, same resolution: Leads + Referrals. */
  hideGrowth: boolean;
  /** What kind of legal team this is, for vocabulary and for the rail. */
  firmType: FirmType;
  /** Which of the three answers won, per surface, for the settings page. */
  source: Record<WorkspaceSurface, SurfaceSource>;
};

export const DEFAULT_FIRM_SURFACE_SETTINGS: FirmSurfaceSettings = {
  hideSearch: false,
  hideTimeBilling: false,
  hideGrowth: false,
  firmType: 'firm',
  source: { timeBilling: 'type', growth: 'type' },
};

/**
 * Read a firm's EFFECTIVE surface state.
 *
 * This is the one resolver. Every consumer - the three Time/Billing/Trust
 * route guards, the five Growth ones, the dashboard, Reports, My work, the
 * matter page, the header, the sidebar and the settings page - reads the
 * answer here rather than deciding for itself, which is why making the type
 * count required no edit at any of them.
 *
 * `firm` is optional and is a pure optimization: a caller that already holds
 * the Firm (the counsel layout does) passes it and saves a round trip. A
 * caller that passes only an id gets one extra select. Both produce the same
 * answer; nothing may depend on which path was taken.
 */
export async function getFirmSurfaceSettings(
  firmId: string,
  firm?: Pick<Firm, 'firmType' | 'metadata'>,
): Promise<FirmSurfaceSettings> {
  try {
    const supabase = createServerSupabase();
    const [settingsRes, firmRow] = await Promise.all([
      supabase
        .from('firm_settings')
        .select('hide_search, hide_time_billing')
        .eq('firm_id', firmId)
        .maybeSingle(),
      firm
        ? Promise.resolve(null)
        : supabase
            .from('firms')
            .select('firm_type, metadata')
            .eq('id', firmId)
            .maybeSingle()
            .then((r) => r.data as { firm_type: string | null; metadata: unknown } | null),
    ]);
    const r = settingsRes.data as
      | { hide_search: boolean | null; hide_time_billing: boolean | null }
      | null;
    const legacyHideTimeBilling = Boolean(r?.hide_time_billing);

    // An unrecognized stored type falls back to 'firm', which is the
    // everything-shown row. A workspace whose type we cannot read must not
    // lose surfaces over it.
    const rawType = firm ? firm.firmType : firmRow?.firm_type;
    const firmType: FirmType = FIRM_TYPES.includes(rawType as FirmType)
      ? (rawType as FirmType)
      : 'firm';
    const overrides = readSurfaceOverrides(
      firm ? firm.metadata : firmRow?.metadata,
    );

    const timeBilling = surfaceDecision(
      'timeBilling',
      firmType,
      overrides,
      legacyHideTimeBilling,
    );
    const growth = surfaceDecision(
      'growth',
      firmType,
      overrides,
      legacyHideTimeBilling,
    );

    return {
      hideSearch: Boolean(r?.hide_search),
      hideTimeBilling: timeBilling.hidden,
      hideGrowth: growth.hidden,
      firmType,
      source: { timeBilling: timeBilling.source, growth: growth.source },
    };
  } catch {
    // Never let a settings-read hiccup break the whole Counsel shell.
    return DEFAULT_FIRM_SURFACE_SETTINGS;
  }
}

/**
 * The letters in front of this firm's ticket numbers, for the settings page
 * to show.
 *
 * DELIBERATELY NOT ADDED TO THE SELECT ABOVE. `ticket_prefix` arrives with
 * 20260807_flow_join.sql, which is not applied, and naming an absent column
 * in that column list would fail the request. Its catch would then hand back
 * DEFAULT_FIRM_SURFACE_SETTINGS, and a firm that had hidden Time and Billing
 * would watch it reappear across the whole workspace. A second query costs
 * one round trip on one page.
 *
 * The allocator owns the read so the settings page and the write path cannot
 * disagree about what an unset, unusable or not-yet-migrated prefix means.
 */
export async function getFirmTicketPrefix(firmId: string): Promise<string> {
  return readTicketPrefix(createServerSupabase(), firmId);
}

/**
 * The letters in front of this firm's legal-request references, for the
 * settings page to show.
 *
 * Its own read for the same reason as the one above: `request_prefix` arrives
 * with 20260817_request_number.sql, and naming an absent column in the surface
 * settings select would take the whole read down with it, handing back the
 * defaults and undoing a firm's surface toggles across the workspace.
 *
 * The allocator owns the read so the settings page and the write path cannot
 * disagree about what an unset or unusable prefix means.
 */
export async function getFirmRequestPrefix(firmId: string): Promise<string> {
  return readRequestPrefix(createServerSupabase(), firmId);
}
