/**
 * What a person can choose to see on /counsel, and how that choice is stored.
 *
 * THE PAGE HAS TWO KINDS OF THING ON IT, AND THEY ARE NOT THE SAME KIND.
 *
 *   FIGURES are the numbers: the four headline counts across the top and the
 *   twelve on the board under them. This is what somebody means when they
 *   point at the dashboard and say "tile", and until this module existed
 *   there was no way to hide a single one of them.
 *
 *   PANELS are the blocks underneath: Action center, Assigned to me, Quick
 *   actions, and the shortcut cards. The code has always called these
 *   "tiles", which is why the old control looked correct from the inside and
 *   wrong to the person using it - "Customize dashboard" opened a dialog
 *   that could rearrange page sections and could not hide a single number.
 *
 * The two are stored differently, because they are used differently:
 *
 *   PANELS PERSIST AS AN ORDERED ENABLED LIST. They are opt-in (two of
 *   fifteen by default) and their order is the user's, so the list has to
 *   carry both facts. `counsel.enabled`, unchanged, so a row written before
 *   any of this keeps working exactly as it did.
 *
 *   FIGURES PERSIST AS A HIDDEN SET. They are opt-out - every figure shows
 *   until somebody says otherwise - and their order is NOT the user's: the
 *   bands say whose move each figure is, which is a fact about the figure
 *   and not a preference. Storing the exceptions rather than the selection
 *   also means a figure added next quarter appears for everybody instead of
 *   only for people who never opened this dialog. `counsel.hiddenMetrics`.
 *
 * Both are per-user, in profiles.dashboard_preferences (migration:
 * supabase/fixes/2026-05-19-profile-dashboard-preferences.sql). Ids on both
 * sides are stable strings and UNKNOWN IDS ARE DROPPED ON READ as well as on
 * write, so a stale UI submission or a deleted figure can never poison a
 * preferences row.
 *
 * WHAT WINS WHEN THEY DISAGREE. A user's pick only ever selects among the
 * things their workspace and their role can actually show them:
 *
 *   1. ROLE. `staff` is refused `cases` and `firm_documents` by an applied
 *      migration, and a refused select returns an empty set with no error,
 *      so a matter or document figure would sit at a permanent zero that
 *      reads as good news. Those figures are absent for that role, not zero.
 *   2. THE WORKSPACE. Money figures open /counsel/billing, and that page
 *      redirects when time and billing is off - whether off came from the
 *      firm's type (lib/firm-workspace.ts), an owner's override, or the
 *      legacy hide_time_billing flag. lib/firm-settings.ts resolves all
 *      three into one boolean before it reaches here.
 *   3. THE USER'S PICK, over whatever is left.
 *
 * A pick for something rule 1 or 2 removed is kept, not deleted: it goes
 * dormant and comes back if the workspace changes its mind. See
 * mergeHiddenMetrics for the half of that which happens on save.
 */

import type { FirmRole } from './firm-types';

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

/**
 * A table a figure or a panel cannot be drawn without.
 *
 * `matters` is public.cases and `documents` is public.firm_documents - the
 * two the staff role is refused - and `timeBilling` is the whole time,
 * billing and trust surface. Naming the DEPENDENCY rather than the rule
 * keeps one list of rules (see hasCapability) instead of a per-item
 * condition that has to be re-derived every time a role or a firm type
 * changes shape.
 */
export type DashboardCapability = 'matters' | 'documents' | 'timeBilling';

export type CounselTileMeta = {
  id: CounselTileId;
  label: string;
  description: string;
  category: CounselTileCategory;
  /** Tile width in the 4-column grid. Defaults to 1. */
  span?: 1 | 2 | 4;
  /** When true, only owners + admins see this tile in the customizer. */
  adminOnly?: boolean;
  /** Withheld from a viewer who cannot read the rows behind it. */
  requires?: DashboardCapability;
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
      'New intakes waiting on triage, signing requests sitting on someone, anything that needs your attention now.',
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
    requires: 'matters',
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
    requires: 'matters',
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
    requires: 'documents',
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
    requires: 'documents',
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
  /** Ordered list of PANEL ids the user wants visible. Opt-in. */
  enabled?: string[];
  /**
   * FIGURE ids the user has switched off. Opt-out: absent means every
   * figure, and an empty array means every figure too. Only a listed id is
   * hidden, so a figure shipped after this row was written shows up.
   */
  hiddenMetrics?: string[];
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

/* ==========================================================================
 * Figures
 * ======================================================================== */

/**
 * The firm roles that can read public.cases and public.firm_documents.
 *
 * A COPY OF AN APPLIED POLICY, and the copy is the point: this list decides
 * what the picker offers, and the policy decides what the database returns.
 * If they drift, a role gets a switch for a figure that will always read
 * zero. supabase/migrations/20260731_staff_role_read_scope.sql is the
 * policy; tests/counsel-dashboard-metrics.test.ts parses that file and
 * fails if the two lists stop matching, so this cannot be kept honest by
 * the comment alone.
 */
export const MATTER_READ_ROLES: readonly FirmRole[] = [
  'owner',
  'admin',
  'attorney',
  'paralegal',
];

/** Who is looking, and what their firm has switched on. */
export type DashboardViewerContext = {
  role: FirmRole;
  /**
   * Time, billing and trust hidden for this firm. Already resolved from the
   * owner's override, the legacy hide_time_billing flag and the firm's type,
   * in that order, by lib/firm-settings.ts + lib/firm-workspace.ts.
   */
  hideTimeBilling: boolean;
};

/** Whether this viewer can be shown something that needs `cap`. */
export function hasCapability(
  cap: DashboardCapability,
  ctx: DashboardViewerContext,
): boolean {
  switch (cap) {
    case 'matters':
    case 'documents':
      return MATTER_READ_ROLES.includes(ctx.role);
    case 'timeBilling':
      return !ctx.hideTimeBilling;
  }
}

/**
 * Where a figure sits on the page. `headline` is the strip across the top;
 * the rest are the board's bands, and they carry the band's own id so the
 * picker groups figures the way the dashboard groups them.
 */
export type CounselMetricGroupId =
  | 'headline'
  | 'firm-owes'
  | 'out-with-others'
  | 'matter-health'
  | 'money';

export type CounselMetricMeta = {
  id: string;
  /**
   * The label the figure is drawn with. THE ONLY PLACE IT IS WRITTEN:
   * lib/counsel-metrics.ts looks it up from here rather than spelling it
   * again, so the switch and the number it controls cannot come apart.
   */
  label: string;
  group: CounselMetricGroupId;
  requires?: DashboardCapability;
};

/**
 * The picker's groups, in the order the page draws them.
 *
 * The four band entries restate lib/counsel-metrics.ts's band names because
 * that module imports this one and not the other way round; the test file
 * builds the real bands and fails if a label or blurb differs, so this stays
 * a mirror rather than a second opinion.
 */
export const COUNSEL_METRIC_GROUPS: {
  id: CounselMetricGroupId;
  label: string;
  blurb: string;
}[] = [
  {
    id: 'headline',
    label: 'Headline figures',
    blurb: 'The four numbers across the top of the page.',
  },
  {
    id: 'firm-owes',
    label: 'Waiting on the firm',
    blurb: 'Somebody here owes a decision on these.',
  },
  {
    id: 'out-with-others',
    label: 'Out with someone else',
    blurb: 'Sent, and waiting on a reply. Chase if it has been a while.',
  },
  {
    id: 'matter-health',
    label: 'Matter health',
    blurb: 'How the caseload is sitting, whoever it belongs to.',
  },
  {
    id: 'money',
    label: 'Money',
    blurb: 'Billed and not yet paid, and work not yet billed.',
  },
];

/**
 * Every figure on /counsel.
 *
 * The headline four are hand-written StatCards on the page rather than a
 * loop, so their ids appear there as literals and a test pins each one to
 * the page's source. `headline-clients` carries the law-firm noun; the page
 * substitutes the per-type vocabulary word (an in-house team has employees,
 * not clients) at render.
 */
export const COUNSEL_METRICS: CounselMetricMeta[] = [
  // ---- the strip
  /*
   * Open TICKETS, not open matters.
   *
   * The strip leads with the thing the legal team is actually asked for. A
   * request arrives as a ticket and most are answered as one; a matter is the
   * comparatively rare outcome where a file gets opened. Leading with matters
   * put the smaller number in the larger position.
   *
   * NO `requires` capability, and that is checked rather than assumed:
   * supabase/migrations/20260731_staff_role_read_scope.sql scopes `staff` out
   * of public.cases and public.firm_documents ONLY, so a staff member reads
   * firm_matter_intakes normally and this figure is a real number for them.
   */
  {
    id: 'headline-open-tickets',
    label: 'Open tickets',
    group: 'headline',
  },
  { id: 'headline-signatures-out', label: 'Signatures out', group: 'headline' },
  { id: 'headline-clients', label: 'Clients', group: 'headline' },
  {
    id: 'headline-documents',
    label: 'Documents',
    group: 'headline',
    requires: 'documents',
  },

  // ---- waiting on the firm
  { id: 'approvals-waiting', label: 'Awaiting approval', group: 'firm-owes' },
  {
    id: 'signing-attention',
    label: 'Signing needs attention',
    group: 'firm-owes',
  },
  {
    id: 'documents-overdue',
    label: 'Documents overdue',
    group: 'firm-owes',
    requires: 'documents',
  },
  {
    id: 'matters-unassigned',
    label: 'Unassigned matters',
    group: 'firm-owes',
    requires: 'matters',
  },

  // ---- out with someone else
  { id: 'signing-out', label: 'Out for signature', group: 'out-with-others' },
  {
    id: 'clients-invited',
    label: 'Client invitations open',
    group: 'out-with-others',
  },
  {
    id: 'team-invitations',
    label: 'Team invitations open',
    group: 'out-with-others',
  },

  // ---- matter health
  {
    id: 'matters-hearing',
    label: 'Hearing within 30 days',
    group: 'matter-health',
    requires: 'matters',
  },
  {
    id: 'matters-stale',
    label: 'No movement in 30 days',
    group: 'matter-health',
    requires: 'matters',
  },
  {
    id: 'documents-unfiled',
    label: 'Documents not on a matter',
    group: 'matter-health',
    requires: 'documents',
  },

  // ---- money
  {
    id: 'billing-outstanding',
    label: 'Outstanding',
    group: 'money',
    requires: 'timeBilling',
  },
  {
    id: 'billing-unbilled',
    label: 'Unbilled time',
    group: 'money',
    requires: 'timeBilling',
  },
];

const METRIC_BY_ID: ReadonlyMap<string, CounselMetricMeta> = new Map(
  COUNSEL_METRICS.map((m) => [m.id, m]),
);

export function isCounselMetricId(id: unknown): id is string {
  return typeof id === 'string' && METRIC_BY_ID.has(id);
}

/**
 * The label a figure is drawn with. Throws on an unknown id rather than
 * returning the id or an empty string: an unnamed figure on a dashboard is
 * worse than a build that stops.
 */
export function metricLabel(id: string): string {
  const meta = METRIC_BY_ID.get(id);
  if (!meta) throw new Error(`unknown counsel metric: ${id}`);
  return meta.label;
}

export function metricMeta(id: string): CounselMetricMeta | undefined {
  return METRIC_BY_ID.get(id);
}

/** The figures this viewer can be offered at all. Rules 1 and 2. */
export function offerableMetrics(
  ctx: DashboardViewerContext,
): CounselMetricMeta[] {
  return COUNSEL_METRICS.filter(
    (m) => !m.requires || hasCapability(m.requires, ctx),
  );
}

export function offerableMetricIds(ctx: DashboardViewerContext): string[] {
  return offerableMetrics(ctx).map((m) => m.id);
}

/** The panels this viewer can be offered. Same two rules, plus admin-only. */
export function offerablePanelIds(
  ctx: DashboardViewerContext,
  isAdmin: boolean,
): CounselTileId[] {
  return COUNSEL_TILES.filter(
    (t) =>
      (isAdmin || !t.adminOnly) &&
      (!t.requires || hasCapability(t.requires, ctx)),
  ).map((t) => t.id);
}

/**
 * The figure ids this user switched off, unknown ones dropped.
 *
 * Dropping on read as well as on write is what keeps a deleted figure, or a
 * stale tab's submission, from turning into a permanently hidden something
 * else if an id is ever reused.
 */
export function getCounselHiddenMetrics(raw: unknown): string[] {
  const prefs = parseDashboardPreferences(raw).counsel;
  if (!prefs || !Array.isArray(prefs.hiddenMetrics)) return [];
  return prefs.hiddenMetrics.filter(isCounselMetricId);
}

/**
 * What the page actually draws: offerable, minus what the user hid.
 *
 * The order is the catalog's, never the stored list's, because the bands
 * mean something. Rules 1 and 2 are applied BEFORE rule 3, which is why a
 * money figure cannot be resurrected by an old pick.
 */
export function visibleMetricIds(
  raw: unknown,
  ctx: DashboardViewerContext,
): string[] {
  const hidden = new Set(getCounselHiddenMetrics(raw));
  return offerableMetricIds(ctx).filter((id) => !hidden.has(id));
}

/**
 * The hidden set to save, given what the picker was able to show.
 *
 * A picker can only answer for the figures it drew. If it wrote its answer
 * as the whole truth, then saving the dialog while the firm had billing
 * switched off would quietly un-hide Outstanding, and it would reappear on
 * the day billing came back. So a stored id the picker could not offer is
 * carried through untouched: the choice goes DORMANT rather than being
 * deleted.
 */
export function mergeHiddenMetrics(
  stored: readonly string[],
  offered: readonly string[],
  hiddenNow: readonly string[],
): string[] {
  const offeredSet = new Set(offered.filter(isCounselMetricId));
  const dormant = stored.filter(
    (id) => isCounselMetricId(id) && !offeredSet.has(id),
  );
  const chosen = hiddenNow.filter(
    (id) => isCounselMetricId(id) && offeredSet.has(id),
  );
  return [...new Set([...dormant, ...chosen])];
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
