/**
 * Counsel dashboard tile catalog + per-user preference shape.
 *
 * The /counsel root used to render a fixed grid of eight tiles. It
 * was a lot of noise for someone who only wanted "what came in this
 * morning" and "what's mine right now." The dashboard now defaults
 * to just two tiles - Action center + Assigned to me - and lets each
 * user add whichever data + navigation tiles they actually use from
 * a catalog of ~15. Preferences persist per-user in
 * profiles.dashboard_preferences (see the migration in
 * supabase/fixes/2026-05-19-profile-dashboard-preferences.sql).
 *
 * Tile ids are stable strings. Unknown ids are ignored on render so
 * a renamed / removed tile never breaks an existing preferences row.
 */

export type CounselTileId =
  // Work surface - what's on my plate now
  | 'action-center'
  | 'assigned-to-me'
  | 'quick-actions'
  | 'meetings-upcoming'
  | 'upcoming-hearings'
  | 'intake-pipeline'
  // Data surface - firm-wide counters
  | 'cases-overview'
  | 'clients-overview'
  | 'team-overview'
  | 'documents-overview'
  | 'signing-overview'
  | 'recent-activity'
  | 'recent-uploads'
  // Navigation surface - quick shortcuts
  | 'team-chat'
  | 'firm-settings';

export type CounselTileCategory = 'work' | 'data' | 'navigation';

export type CounselTileMeta = {
  id: CounselTileId;
  label: string;
  description: string;
  category: CounselTileCategory;
  /** Tile width in the 4-column grid. Defaults to 1. */
  span?: 1 | 2 | 4;
  /** When true, only owners + admins see this tile in the customizer. */
  adminOnly?: boolean;
};

/**
 * The full catalog. Order here is the order shown in the customizer
 * (grouped by category). The default-enabled set is a separate list
 * below so adding a tile to the catalog doesn't accidentally enable
 * it for every user.
 */
export const COUNSEL_TILES: CounselTileMeta[] = [
  // ---- work
  {
    id: 'action-center',
    label: 'Action center',
    description:
      'New intakes waiting on triage, signing requests sitting on someone, anything that needs a human now.',
    category: 'work',
    span: 4,
  },
  {
    id: 'assigned-to-me',
    label: 'Assigned to me',
    description:
      'Clients + matters where you are the primary attorney. Quick path back into your active work.',
    category: 'work',
    span: 4,
  },
  {
    id: 'quick-actions',
    label: 'Quick actions',
    description:
      'One-click shortcuts: new case, new intake, schedule meeting, upload document.',
    category: 'work',
    span: 2,
  },
  {
    id: 'meetings-upcoming',
    label: 'Upcoming meetings',
    description: 'Your next few calendar events with join links.',
    category: 'work',
    span: 2,
  },
  {
    id: 'upcoming-hearings',
    label: 'Hearings + deadlines',
    description:
      'Court dates and statute-of-limitations alerts coming up this week.',
    category: 'work',
    span: 2,
  },
  {
    id: 'intake-pipeline',
    label: 'Intake pipeline',
    description:
      'Lane counts from the request inbox: needs attention, in review, accepted, closed.',
    category: 'work',
    span: 2,
  },

  // ---- data
  {
    id: 'cases-overview',
    label: 'Cases overview',
    description: 'Open + active vs total cases at a glance.',
    category: 'data',
    span: 1,
  },
  {
    id: 'clients-overview',
    label: 'Clients overview',
    description: 'Total + active clients.',
    category: 'data',
    span: 1,
  },
  {
    id: 'team-overview',
    label: 'Team overview',
    description: 'Members + pending invites.',
    category: 'data',
    span: 1,
  },
  {
    id: 'documents-overview',
    label: 'Documents overview',
    description: 'Document count and most recent activity.',
    category: 'data',
    span: 1,
  },
  {
    id: 'signing-overview',
    label: 'Signing overview',
    description: 'Signature requests in flight.',
    category: 'data',
    span: 1,
  },
  {
    id: 'recent-activity',
    label: 'Recent activity',
    description: 'The last few things that happened across the firm.',
    category: 'data',
    span: 2,
  },
  {
    id: 'recent-uploads',
    label: 'Recent uploads',
    description: 'Most recently added documents.',
    category: 'data',
    span: 2,
  },

  // ---- navigation
  {
    id: 'team-chat',
    label: 'Team chat',
    description: 'Quick link into firm channels + DMs.',
    category: 'navigation',
    span: 1,
  },
  {
    id: 'firm-settings',
    label: 'Firm settings',
    description: 'Brand, scope, integrations. Owner + admin only.',
    category: 'navigation',
    span: 1,
    adminOnly: true,
  },
];

/**
 * Default tiles when the user has no preferences row. Matches the
 * brief: "default just be the welcome and the ask bella with an
 * action center if there are any new things that have come in and an
 * assigned to me section if that member of the legal team has been
 * assigned to anything." Welcome + Ask Advottic are not tiles
 * (they're page chrome, always present); Action center + Assigned to
 * me are tiles so they can be hidden if the user wants a fully blank
 * dashboard.
 */
export const DEFAULT_ENABLED_TILES: CounselTileId[] = [
  'action-center',
  'assigned-to-me',
];

export type DashboardPreferences = {
  /** Ordered list of tile ids the user wants visible. */
  enabled?: string[];
};

export type AllDashboardPreferences = Partial<
  Record<'counsel', DashboardPreferences>
>;

export function parseDashboardPreferences(
  raw: unknown,
): AllDashboardPreferences {
  if (!raw || typeof raw !== 'object') return {};
  return raw as AllDashboardPreferences;
}

const KNOWN_IDS: ReadonlySet<CounselTileId> = new Set(
  COUNSEL_TILES.map((t) => t.id),
);

/** True if a string is a known tile id. */
export function isCounselTileId(id: string): id is CounselTileId {
  return KNOWN_IDS.has(id as CounselTileId);
}

/**
 * Resolve the enabled tile list for a user, filtering out unknown
 * ids and falling back to the default set when no preference row
 * exists. The returned array preserves the user's chosen order.
 */
export function getCounselDashboardConfig(raw: unknown): CounselTileId[] {
  const prefs = parseDashboardPreferences(raw).counsel;
  if (!prefs || !Array.isArray(prefs.enabled)) {
    return [...DEFAULT_ENABLED_TILES];
  }
  return prefs.enabled.filter(isCounselTileId);
}

/** Grouped tile metadata for the customizer panel. */
export const COUNSEL_TILE_CATEGORIES: {
  id: CounselTileCategory;
  label: string;
  description: string;
}[] = [
  {
    id: 'work',
    label: 'Work surface',
    description: "What's on your plate right now.",
  },
  {
    id: 'data',
    label: 'Firm data',
    description: 'Counts and recent activity across the firm.',
  },
  {
    id: 'navigation',
    label: 'Shortcuts',
    description: 'Quick links into other parts of the workspace.',
  },
];
