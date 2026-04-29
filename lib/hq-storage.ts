/**
 * Read-side helpers for Advottic HQ - the unified business cockpit
 * that owns BOTH the consumer app and Advottic Counsel.
 *
 * Everything here uses the service-role admin client and assumes the
 * caller has already been admin-gated by the route or layout.
 */

import { createAdminSupabase } from './supabase/admin';
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
  jurisdictions: string[];
  practiceAreas: string[];
  createdAt: string;
  memberCount: number;
  clientCount: number;
  caseCount: number;
  lastActivityAt: string | null;
  // Stripe-side billing snapshot (for the firm's billing contact -
  // currently the firm creator). Subscriptions are still per-user
  // until firm-level billing lands; we surface the creator's plan as
  // a stand-in.
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
      'id, slug, name, firm_type, accent_color, jurisdictions, practice_areas, created_at, created_by',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  type FirmDb = {
    id: string;
    slug: string;
    name: string;
    firm_type: FirmType;
    accent_color: string;
    jurisdictions: string[] | null;
    practice_areas: string[] | null;
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
    jurisdictions: f.jurisdictions ?? [],
    practiceAreas: f.practice_areas ?? [],
    createdAt: f.created_at,
    memberCount: memberCounts.get(f.id) ?? 0,
    clientCount: clientCounts.get(f.id) ?? 0,
    caseCount: caseCounts.get(f.id) ?? 0,
    lastActivityAt: lastActivity.get(f.id) ?? null,
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
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('subscriptions').select('status'),
    admin.from('cases').select('id', { count: 'exact', head: true }),
    admin.from('feedback').select('status').neq('status', 'resolved'),
    admin.from('firms').select('id', { count: 'exact', head: true }),
    admin.from('firm_access_requests').select('status'),
    admin.from('firm_access_grants').select('expires_at, accepted_at'),
  ]);

  const subs = (subsResp.data ?? []) as { status: string }[];
  const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'trialing').length;
  const pastDueSubs = subs.filter((s) => s.status === 'past_due' || s.status === 'unpaid').length;
  const feedback = (feedbackResp.data ?? []) as { status: string }[];
  const requests = (requestsResp.data ?? []) as { status: string }[];
  const grants = (grantsResp.data ?? []) as { expires_at: string; accepted_at: string | null }[];
  const now = Date.now();

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
  };
}
