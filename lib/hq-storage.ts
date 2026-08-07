/**
 * Read-side helpers for Advottic HQ - the unified business cockpit
 * that owns BOTH the consumer app and Advottic Counsel.
 *
 * Everything here uses the service-role admin client and assumes the
 * caller has already been admin-gated by the route or layout.
 */

import { createAdminSupabase } from './supabase/admin';
import { summarizeProbeUptime, type ProbeUptime } from './hq-metrics';
import { adminSummarizeOpenCrashes } from './storage';
import type { FirmType } from './firm-types';

// =====================================================================
// Active firms list
// =====================================================================

export type HqFirmRow = {
  id: string;
  slug: string;
  name: string;
  firmType: FirmType;
  accentColor: string;
  logoUrl: string | null;
  jurisdictions: string[];
  practiceAreas: string[];
  /**
   * True when the firm has been provisioned a tenant white-label
   * subdomain at <slug>.advottic.com. Drives the HQ subdomain toggle.
   */
  subdomainEnabled: boolean;
  createdAt: string;
  memberCount: number;
  clientCount: number;
  caseCount: number;
  lastActivityAt: string | null;
  // Stripe-side billing snapshot (for the firm's billing contact -
  // currently the firm creator). Subscriptions are still per-user
  // until firm-level billing lands; we surface the creator's plan as
  // a stand-in.
  /** auth.users.id of the firm's creator. Powers the "View as
   *  firm owner" impersonation flow on /admin/firms. May be null
   *  for legacy rows; UI hides the impersonate affordance when so. */
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerPlan: string | null;
  ownerSubscriptionStatus: string | null;
};

export async function adminListFirms(): Promise<HqFirmRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];

  const { data: firmsRaw, error } = await admin
    .from('firms')
    .select(
      'id, slug, name, firm_type, accent_color, logo_url, jurisdictions, practice_areas, subdomain_enabled, created_at, created_by',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  type FirmDb = {
    id: string;
    slug: string;
    name: string;
    firm_type: FirmType;
    accent_color: string;
    logo_url: string | null;
    jurisdictions: string[] | null;
    practice_areas: string[] | null;
    subdomain_enabled: boolean | null;
    created_at: string;
    created_by: string | null;
  };
  const firms = (firmsRaw ?? []) as FirmDb[];
  if (firms.length === 0) return [];

  const firmIds = firms.map((f) => f.id);
  const ownerIds = Array.from(
    new Set(firms.map((f) => f.created_by).filter((v): v is string => Boolean(v))),
  );
  const sentinel = ['00000000-0000-0000-0000-000000000000'];

  const [membersResp, clientsResp, casesResp, subsResp, profilesResp, authResp] = await Promise.all(
    [
      admin.from('firm_members').select('firm_id').in('firm_id', firmIds),
      admin.from('firm_clients').select('firm_id').in('firm_id', firmIds),
      admin.from('firm_cases').select('firm_id, updated_at').in('firm_id', firmIds),
      ownerIds.length
        ? admin.from('subscriptions').select('user_id, status, tier').in('user_id', ownerIds)
        : Promise.resolve({ data: [] as { user_id: string; status: string; tier: string | null }[] }),
      ownerIds.length
        ? admin
            .from('profiles')
            .select('id, display_name')
            .in('id', ownerIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
      ownerIds.length
        ? admin.auth.admin.listUsers({ perPage: 1000 })
        : Promise.resolve({ data: { users: [] as { id: string; email: string | null }[] } }),
    ],
  );

  const memberCounts = new Map<string, number>();
  for (const row of (membersResp.data ?? []) as { firm_id: string }[]) {
    memberCounts.set(row.firm_id, (memberCounts.get(row.firm_id) ?? 0) + 1);
  }
  const clientCounts = new Map<string, number>();
  for (const row of (clientsResp.data ?? []) as { firm_id: string }[]) {
    clientCounts.set(row.firm_id, (clientCounts.get(row.firm_id) ?? 0) + 1);
  }
  const caseCounts = new Map<string, number>();
  const lastActivity = new Map<string, string>();
  for (const row of (casesResp.data ?? []) as { firm_id: string; updated_at: string }[]) {
    caseCounts.set(row.firm_id, (caseCounts.get(row.firm_id) ?? 0) + 1);
    const prev = lastActivity.get(row.firm_id);
    if (!prev || row.updated_at > prev) lastActivity.set(row.firm_id, row.updated_at);
  }
  const subs = new Map<string, { status: string; tier: string | null }>();
  for (const s of (subsResp.data ?? []) as {
    user_id: string;
    status: string;
    tier: string | null;
  }[]) {
    subs.set(s.user_id, { status: s.status, tier: s.tier });
  }
  const profiles = new Map<string, { display_name: string | null }>();
  for (const p of (profilesResp.data ?? []) as {
    id: string;
    display_name: string | null;
  }[]) {
    profiles.set(p.id, { display_name: p.display_name });
  }
  const emails = new Map<string, string | null>();
  const authUsers = (authResp as { data: { users: { id: string; email: string | null }[] } }).data
    .users;
  for (const u of authUsers) emails.set(u.id, u.email ?? null);

  return firms.map((f) => ({
    id: f.id,
    slug: f.slug,
    name: f.name,
    firmType: f.firm_type,
    accentColor: f.accent_color,
    logoUrl: f.logo_url,
    jurisdictions: f.jurisdictions ?? [],
    practiceAreas: f.practice_areas ?? [],
    subdomainEnabled: Boolean(f.subdomain_enabled),
    createdAt: f.created_at,
    memberCount: memberCounts.get(f.id) ?? 0,
    clientCount: clientCounts.get(f.id) ?? 0,
    caseCount: caseCounts.get(f.id) ?? 0,
    lastActivityAt: lastActivity.get(f.id) ?? null,
    ownerUserId: f.created_by ?? null,
    ownerEmail: f.created_by ? emails.get(f.created_by) ?? null : null,
    ownerName: f.created_by ? profiles.get(f.created_by)?.display_name ?? null : null,
    ownerPlan: f.created_by ? subs.get(f.created_by)?.tier ?? null : null,
    ownerSubscriptionStatus: f.created_by ? subs.get(f.created_by)?.status ?? null : null,
  }));
}

// =====================================================================
// Outbound + redemption-pending invitations (grants)
// =====================================================================

export type HqGrantRow = {
  id: string;
  requestId: string | null;
  email: string;
  organizationName: string;
  firmType: FirmType;
  kind: 'application' | 'outbound';
  inviteNote: string | null;
  expiresAt: string;
  grantedAt: string;
  acceptedAt: string | null;
  firmId: string | null;
  status: 'pending' | 'redeemed' | 'expired';
};

export async function adminListGrants(): Promise<HqGrantRow[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data, error } = await admin
    .from('firm_access_grants')
    .select(
      'id, request_id, email, organization_name, firm_type, kind, invite_note, expires_at, granted_at, accepted_at, firm_id',
    )
    .order('granted_at', { ascending: false });
  if (error) throw error;
  const now = Date.now();
  return ((data ?? []) as Array<{
    id: string;
    request_id: string | null;
    email: string;
    organization_name: string;
    firm_type: FirmType;
    kind: 'application' | 'outbound' | null;
    invite_note: string | null;
    expires_at: string;
    granted_at: string;
    accepted_at: string | null;
    firm_id: string | null;
  }>).map((g) => {
    const expired = !g.accepted_at && new Date(g.expires_at).getTime() < now;
    return {
      id: g.id,
      requestId: g.request_id,
      email: g.email,
      organizationName: g.organization_name,
      firmType: g.firm_type,
      kind: g.kind ?? 'application',
      inviteNote: g.invite_note,
      expiresAt: g.expires_at,
      grantedAt: g.granted_at,
      acceptedAt: g.accepted_at,
      firmId: g.firm_id,
      status: g.accepted_at ? 'redeemed' : expired ? 'expired' : 'pending',
    };
  });
}

// =====================================================================
// Cross-side counts for the HQ landing dashboard
// =====================================================================

export type HqDashboardCounts = {
  consumer: {
    users: number;
    activeSubs: number;
    pastDueSubs: number;
    casesTotal: number;
    feedbackOpen: number;
  };
  counsel: {
    firms: number;
    pendingRequests: number;
    scheduledRequests: number;
    pendingGrants: number;
    expiredGrants: number;
  };
  ops: {
    /** Noise-filtered count - matches the default visible count on /admin/crashes (V3 CR-23). */
    crashOpen: number;
    /** Raw unfiltered count - includes Script error / Firefox / ResizeObserver noise. */
    crashOpenRaw: number;
    healthStatus: 'pass' | 'fail' | 'unknown';
    healthLastRun: string | null;
    healthFailureCount: number;
  };
};

export async function adminGetHqDashboardCounts(): Promise<HqDashboardCounts> {
  const admin = createAdminSupabase();
  if (!admin) {
    return {
      consumer: { users: 0, activeSubs: 0, pastDueSubs: 0, casesTotal: 0, feedbackOpen: 0 },
      counsel: {
        firms: 0,
        pendingRequests: 0,
        scheduledRequests: 0,
        pendingGrants: 0,
        expiredGrants: 0,
      },
      ops: { crashOpen: 0, crashOpenRaw: 0, healthStatus: 'unknown', healthLastRun: null, healthFailureCount: 0 },
    };
  }

  const [
    usersResp,
    subsResp,
    casesResp,
    feedbackResp,
    firmsResp,
    requestsResp,
    grantsResp,
    crashSummary,
    healthResp,
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('subscriptions').select('status'),
    // Sandbox-flagged cases (test data, scratch rows, accidental dups)
    // are excluded from the HQ tally so the operator dashboard reflects
    // real platform usage. Audit 2026-05-12 P2.
    admin.from('cases').select('id', { count: 'exact', head: true }).eq('sandbox', false),
    admin.from('feedback').select('status').neq('status', 'resolved'),
    admin.from('firms').select('id', { count: 'exact', head: true }),
    admin.from('firm_access_requests').select('status'),
    admin.from('firm_access_grants').select('expires_at, accepted_at'),
    // Audit W20 V3 CR-23: the noise (script-error / firefox-extension /
    // ResizeObserver false positives) is subtracted before reporting an
    // open-count, so this pill and /admin/crashes agree. The count itself
    // comes from adminSummarizeOpenCrashes so all three HQ surfaces are
    // literally the same call rather than three similar queries.
    adminSummarizeOpenCrashes(),
    admin
      .from('system_health')
      .select('ran_at, probes, failures')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const subs = (subsResp.data ?? []) as { status: string }[];
  const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'trialing').length;
  const pastDueSubs = subs.filter((s) => s.status === 'past_due' || s.status === 'unpaid').length;
  const feedback = (feedbackResp.data ?? []) as { status: string }[];
  const requests = (requestsResp.data ?? []) as { status: string }[];
  const grants = (grantsResp.data ?? []) as { expires_at: string; accepted_at: string | null }[];
  const now = Date.now();

  let healthStatus: 'pass' | 'fail' | 'unknown' = 'unknown';
  let healthLastRun: string | null = null;
  let healthFailureCount = 0;
  const latestHealth = (healthResp as { data: unknown }).data as
    | {
        ran_at: string;
        probes: Record<string, string>;
        failures: { probe: string; error: string }[];
      }
    | null
    | undefined;
  if (latestHealth) {
    healthLastRun = latestHealth.ran_at;
    healthFailureCount = (latestHealth.failures ?? []).length;
    const probeValues = Object.values(latestHealth.probes ?? {});
    healthStatus = probeValues.some((v) => v === 'fail')
      ? 'fail'
      : probeValues.length > 0
        ? 'pass'
        : 'unknown';
  }

  return {
    consumer: {
      users: usersResp.data?.users.length ?? 0,
      activeSubs,
      pastDueSubs,
      casesTotal: casesResp.count ?? 0,
      feedbackOpen: feedback.length,
    },
    counsel: {
      firms: firmsResp.count ?? 0,
      pendingRequests: requests.filter((r) => r.status === 'pending').length,
      scheduledRequests: requests.filter((r) => r.status === 'scheduled').length,
      pendingGrants: grants.filter(
        (g) => !g.accepted_at && new Date(g.expires_at).getTime() >= now,
      ).length,
      expiredGrants: grants.filter(
        (g) => !g.accepted_at && new Date(g.expires_at).getTime() < now,
      ).length,
    },
    ops: {
      // crashOpen reflects the noise-filtered count to match the
      // default visible count on /admin/crashes (CR-23). The raw
      // crashOpenRaw is included alongside so the security pulse
      // and any other downstream surface that wants the unfiltered
      // total can read it without re-querying.
      crashOpen: crashSummary.open,
      crashOpenRaw: crashSummary.total,
      healthStatus,
      healthLastRun,
      healthFailureCount,
    },
  };
}

// =====================================================================
// Live health probe - runs on demand at request time so the HQ
// dashboard never lies when the daily cron breaks
// =====================================================================

export type LiveProbe = {
  name: 'database' | 'auth';
  status: 'pass' | 'fail';
  latencyMs: number;
  error: string | null;
};

export type LiveHealth = {
  ranAt: string;
  totalLatencyMs: number;
  probes: LiveProbe[];
  ok: boolean;
  cronSnapshotAgeMs: number | null;
  cronSnapshotStale: boolean;
};

/** Stale threshold: daily cron should run every 24 hours. Anything
 *  older than 36h (1.5x cadence) means the cron is broken. */
const CRON_STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

/**
 * Hits Supabase right now to verify it's reachable. Used by the HQ
 * landing's status pill and the System health page's "Live" row, so
 * the founder always sees the actual current state regardless of
 * whether the daily cron is healthy.
 */
export async function adminGetLiveHealth(): Promise<LiveHealth> {
  const startedAt = Date.now();
  const probes: LiveProbe[] = [];
  const admin = createAdminSupabase();

  if (!admin) {
    return {
      ranAt: new Date(startedAt).toISOString(),
      totalLatencyMs: 0,
      probes: [
        {
          name: 'database',
          status: 'fail',
          latencyMs: 0,
          error: 'SUPABASE_SERVICE_ROLE_KEY not configured',
        },
      ],
      ok: false,
      cronSnapshotAgeMs: null,
      cronSnapshotStale: true,
    };
  }

  // Database: cheap count head against a small table.
  {
    const t0 = Date.now();
    try {
      const { error } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      probes.push({
        name: 'database',
        status: error ? 'fail' : 'pass',
        latencyMs: Date.now() - t0,
        error: error?.message ?? null,
      });
    } catch (err) {
      probes.push({
        name: 'database',
        status: 'fail',
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Auth: list-users with perPage=1 is the documented health-check pattern.
  {
    const t0 = Date.now();
    try {
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      probes.push({
        name: 'auth',
        status: error ? 'fail' : 'pass',
        latencyMs: Date.now() - t0,
        error: error?.message ?? null,
      });
    } catch (err) {
      probes.push({
        name: 'auth',
        status: 'fail',
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Snapshot age - once the cron has not written for longer than
  // CRON_STALE_THRESHOLD_MS the static "Daily probes" tiles are stale and
  // the UI must say so.
  let cronSnapshotAgeMs: number | null = null;
  try {
    const { data: latest } = await admin
      .from('system_health')
      .select('ran_at')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestRow = latest as { ran_at: string } | null | undefined;
    if (latestRow?.ran_at) {
      cronSnapshotAgeMs = Date.now() - new Date(latestRow.ran_at).getTime();
    }
  } catch {
    cronSnapshotAgeMs = null;
  }

  const ok = probes.every((p) => p.status === 'pass');
  return {
    ranAt: new Date(startedAt).toISOString(),
    totalLatencyMs: Date.now() - startedAt,
    probes,
    ok,
    cronSnapshotAgeMs,
    cronSnapshotStale:
      cronSnapshotAgeMs === null || cronSnapshotAgeMs > CRON_STALE_THRESHOLD_MS,
  };
}

// =====================================================================
// Extended health metrics for the System health page
// =====================================================================

export type HqHealthExtras = {
  gdpr: { consented: number; total: number; rate: number };
  security: {
    openEvents: number;
    last24hCount: number;
    /** Privileged-access entries (admin_case_view, admin_impersonation). */
    last24hMedium: number;
    last24hHigh: number;
    last24hCritical: number;
  };
  uptime: ProbeUptime;
  activity: {
    totalAccounts: number;
    onlineNow: number; // signed in within the last 5 minutes
    activeToday: number; // signed in within the last 24 hours
    activeWeek: number; // signed in within the last 7 days
  };
};

const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export async function adminGetHqHealthExtras(): Promise<HqHealthExtras> {
  const admin = createAdminSupabase();
  if (!admin) {
    return {
      gdpr: { consented: 0, total: 0, rate: 0 },
      security: {
        openEvents: 0,
        last24hCount: 0,
        last24hMedium: 0,
        last24hHigh: 0,
        last24hCritical: 0,
      },
      uptime: { passedProbes: 0, totalProbes: 0, ratio: null, passedRuns: 0, totalRuns: 0 },
      activity: { totalAccounts: 0, onlineNow: 0, activeToday: 0, activeWeek: 0 },
    };
  }

  const since24h = new Date(Date.now() - ONE_DAY_MS).toISOString();

  const [
    profilesResp,
    securityOpenResp,
    securityRecentResp,
    healthChecksResp,
    authResp,
  ] = await Promise.all([
    admin.from('profiles').select('id, consented_at'),
    admin
      .from('security_events')
      .select('id', { count: 'exact', head: true })
      .is('acknowledged_at', null),
    admin
      .from('security_events')
      .select('severity')
      .gte('occurred_at', since24h),
    admin
      .from('system_health')
      .select('probes')
      .gte('ran_at', since24h),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const profiles = (profilesResp.data ?? []) as {
    id: string;
    consented_at: string | null;
  }[];
  const consented = profiles.filter((p) => Boolean(p.consented_at)).length;
  const total = profiles.length;

  const recent = (securityRecentResp.data ?? []) as { severity: string }[];
  const last24hMedium = recent.filter((r) => r.severity === 'medium').length;
  const last24hHigh = recent.filter((r) => r.severity === 'high').length;
  const last24hCritical = recent.filter((r) => r.severity === 'critical').length;

  const checks = (healthChecksResp.data ?? []) as {
    probes: Record<string, string>;
  }[];
  const uptime = summarizeProbeUptime(checks);

  const now = Date.now();
  const authUsers = (authResp.data?.users ?? []) as {
    id: string;
    last_sign_in_at?: string | null;
  }[];
  const totalAccounts = authUsers.length;
  let onlineNow = 0;
  let activeToday = 0;
  let activeWeek = 0;
  for (const u of authUsers) {
    if (!u.last_sign_in_at) continue;
    const ts = new Date(u.last_sign_in_at).getTime();
    if (Number.isNaN(ts)) continue;
    const age = now - ts;
    if (age <= FIVE_MIN_MS) onlineNow += 1;
    if (age <= ONE_DAY_MS) activeToday += 1;
    if (age <= ONE_WEEK_MS) activeWeek += 1;
  }

  return {
    gdpr: {
      consented,
      total,
      rate: total > 0 ? consented / total : 0,
    },
    security: {
      openEvents: securityOpenResp.count ?? 0,
      last24hCount: recent.length,
      last24hMedium,
      last24hHigh,
      last24hCritical,
    },
    uptime,
    activity: { totalAccounts, onlineNow, activeToday, activeWeek },
  };
}
