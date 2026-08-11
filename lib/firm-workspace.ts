import type { FirmType } from './firm-types';

/**
 * What a firm's TYPE says about the shape of its workspace.
 *
 * `firms.firm_type` has existed since the token-economy schema
 * (supabase/fixes/2026-07-04-token-economy-schema.sql:45, CHECK-constrained
 * over six values, indexed). It was written at onboarding and then read by
 * nothing, so an in-house legal team was handed a rail with Time, Billing,
 * Trust, Leads and Referrals on it - none of which an in-house team has.
 *
 * This module is the table that fixes that, and it is deliberately only a
 * DEFAULT. A legal-aid clinic bills some matters, an in-house team may run a
 * panel of outside counsel, and `other` is by definition unclassified, so every
 * answer here has to be overridable and the override has to win. See
 * resolveSurfaceHidden for the order.
 *
 * Pure and I/O-free so the resolver, the settings UI and the tests share one
 * source of truth. The read that feeds it lives in lib/firm-settings.ts.
 */

/** A whole group of Counsel surfaces that stands or falls together. */
export type WorkspaceSurface = 'timeBilling' | 'growth';

export const WORKSPACE_SURFACES: readonly WorkspaceSurface[] = [
  'timeBilling',
  'growth',
];

/**
 * The Growth group (Leads + Referrals). The Time & Billing group's hrefs are
 * TIME_BILLING_HREFS in lib/menu-config.ts, which already existed; this is its
 * counterpart and lives here rather than there so a surface and its hrefs are
 * declared in one place going forward.
 */
export const GROWTH_HREFS: readonly string[] = [
  '/counsel/leads',
  '/counsel/referrals',
];

/**
 * The surfaces each type hides UNLESS its owner says otherwise.
 *
 * `corporate` and `government` are the two types that do not invoice an
 * external client, do not hold client funds in trust, and do not buy inbound
 * work from a marketplace. Everything else keeps exactly today's workspace, so
 * no firm's rail changes shape until somebody changes its type.
 *
 * `legal_aid` is deliberately on the everything-shown row. A clinic bills under
 * fee-shifting statutes, holds IOLTA, and takes referrals from other
 * organizations. Guessing otherwise would take a working surface away from an
 * organization that needs it.
 */
const HIDDEN_BY_TYPE: Record<FirmType, readonly WorkspaceSurface[]> = {
  individual: [],
  firm: [],
  legal_aid: [],
  other: [],
  corporate: ['timeBilling', 'growth'],
  government: ['timeBilling', 'growth'],
};

export function hiddenSurfacesForType(
  firmType: FirmType,
): readonly WorkspaceSurface[] {
  return HIDDEN_BY_TYPE[firmType] ?? [];
}

/** An owner's explicit answer, which beats the type default either way. */
export type SurfaceOverride = 'show' | 'hide';

export type SurfaceOverrides = Partial<
  Record<WorkspaceSurface, SurfaceOverride>
>;

/**
 * Parse `firms.metadata.surfaceOverrides`.
 *
 * jsonb, alongside `menuConfig`, rather than a new column: the shape of a
 * workspace is display configuration, the firms table already carries the
 * firm's other display configuration in this exact field, and no migration is
 * owed for a feature whose only new state is two optional strings.
 *
 * Defensive in the same way readMenuConfig is - an unknown surface name or an
 * unknown value is dropped rather than trusted, because this decides whether a
 * surface exists.
 */
export function readSurfaceOverrides(metadata: unknown): SurfaceOverrides {
  const raw = (metadata as { surfaceOverrides?: unknown } | null)
    ?.surfaceOverrides;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SurfaceOverrides = {};
  for (const surface of WORKSPACE_SURFACES) {
    const v = (raw as Record<string, unknown>)[surface];
    if (v === 'show' || v === 'hide') out[surface] = v;
  }
  return out;
}

/** Why a surface is in the state it is in, for the settings page to say. */
export type SurfaceSource = 'override' | 'legacy' | 'type';

export type SurfaceDecision = { hidden: boolean; source: SurfaceSource };

/**
 * Resolve one surface, and say which of the three answers won.
 *
 * Order:
 *   1. An explicit override. The owner said so, in either direction.
 *   2. `firm_settings.hide_time_billing`, for timeBilling only, and only as a
 *      HIDE. The column is NOT NULL DEFAULT false, so a stored `false` cannot
 *      be told apart from never-touched; reading it as "show me billing" would
 *      make it silently outrank the type default for every firm that has a
 *      settings row. Reading it as a hide-only latch preserves every choice a
 *      firm has actually made and asserts nothing about the ones it hasn't.
 *   3. The type default.
 */
export function surfaceDecision(
  surface: WorkspaceSurface,
  firmType: FirmType,
  overrides: SurfaceOverrides,
  legacyHideTimeBilling: boolean,
): SurfaceDecision {
  const override = overrides[surface];
  if (override) return { hidden: override === 'hide', source: 'override' };
  if (surface === 'timeBilling' && legacyHideTimeBilling) {
    return { hidden: true, source: 'legacy' };
  }
  return { hidden: hiddenSurfacesForType(firmType).includes(surface), source: 'type' };
}

export function resolveSurfaceHidden(
  surface: WorkspaceSurface,
  firmType: FirmType,
  overrides: SurfaceOverrides,
  legacyHideTimeBilling: boolean,
): boolean {
  return surfaceDecision(surface, firmType, overrides, legacyHideTimeBilling)
    .hidden;
}
