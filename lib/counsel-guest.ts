import 'server-only';
import type { User } from '@supabase/supabase-js';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { getFirmById, getFirmByIdAdmin } from './firm-storage';
import type { Firm } from './firm-types';
import type { OccurredPrecision } from './timeline-types';
import { relevanceBand } from './timeline-types';

/**
 * Case-scoped Counsel GUEST access.
 *
 * A "counsel guest" is a signed-in user who has been added to one or more firm
 * matters as co-counsel (case_collaborators role 'attorney') but who is NOT a
 * firm_members row on any firm. They get the firm-framed Counsel view of ONLY
 * their assigned matter(s) - never the rest of the firm workspace (other
 * matters, clients, team, billing, analytics, settings). See lib/persona.ts
 * (persona kind 'counsel_guest'), app/counsel/layout.tsx (the path-scoped
 * shell), and the per-route guards on the /counsel/cases/[id] surfaces.
 *
 * Two onboarding paths resolve to the SAME guest context:
 *   1. Email invite  - the firm invites by email; the person self-signs-up and
 *      their case_collaborators row links by email (existing flow).
 *   2. Provisioned    - the firm mints the account directly with a username +
 *      temp password (firm_guest_accounts). A provisioned guest can be
 *      DEACTIVATED (deactivated_at) to cut access instantly, and is forced
 *      through a password change on first login (must_change_password).
 *
 * Everything here is DEFAULT-DENY and verified server-side on every call.
 */

export type GuestContext = {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** The matters this guest may reach on the Counsel side. May be empty for a
   *  freshly provisioned guest not yet assigned to a case. */
  caseIds: string[];
  /** Owning / branding firm, best-effort (null if it can't be resolved). */
  firm: Firm | null;
  firmId: string | null;
  /** True when this identity was minted by a firm (firm_guest_accounts). */
  provisioned: boolean;
  /** Provisioned guest still owes the first-login password change. */
  mustChangePassword: boolean;
  /** firm_guest_accounts.id, when provisioned. */
  guestAccountId: string | null;
};

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * Resolve the guest context for an already-authenticated user, or null if the
 * user is not a counsel guest (signed out, a firm member, a deactivated guest,
 * or someone with no attorney-collaborator matters and no guest identity).
 *
 * Kept separate from the session read so lib/persona.ts can reuse it with the
 * user it already holds.
 */
export async function resolveGuestContextForUser(
  user: User,
): Promise<GuestContext | null> {
  const admin = createAdminSupabase();
  if (!admin) return null;

  // A firm member is NEVER a guest - the full firm workspace persona wins.
  // This is also what keeps the guest surface strictly for OUTSIDE counsel.
  const { data: memberRow } = await admin
    .from('firm_members')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (memberRow) return null;

  // Provisioned guest identity (may not exist for an email-invited guest).
  const { data: guestRow } = await admin
    .from('firm_guest_accounts')
    .select('id, firm_id, must_change_password, deactivated_at')
    .eq('user_id', user.id)
    .maybeSingle();
  const guest = guestRow as
    | {
        id: string;
        firm_id: string;
        must_change_password: boolean;
        deactivated_at: string | null;
      }
    | null;

  // Deactivated provisioned guest => access is cut. Fail closed.
  if (guest && guest.deactivated_at) return null;

  // The matters they've been added to as co-counsel (attorney), already linked
  // to their auth user (a held/pending invite has user_id = null and grants
  // nothing until claimed).
  const { data: collabRows } = await admin
    .from('case_collaborators')
    .select('case_id')
    .eq('user_id', user.id)
    .eq('role', 'attorney');
  const collabCaseIds = Array.from(
    new Set(
      ((collabRows ?? []) as { case_id: string }[])
        .map((r) => r.case_id)
        .filter(Boolean),
    ),
  );

  // Neither a provisioned identity nor any co-counsel matter => not a guest.
  if (!guest && collabCaseIds.length === 0) return null;

  // Resolve which of those matters actually exist, and their owning firm. A
  // provisioned guest is additionally constrained to matters owned by the firm
  // that owns their identity - defense in depth against a mis-set collaborator
  // row pointing at another firm's case.
  let caseIds: string[] = [];
  let firmId: string | null = guest ? guest.firm_id : null;
  if (collabCaseIds.length > 0) {
    const { data: caseRows } = await admin
      .from('cases')
      .select('id, firm_id')
      .in('id', collabCaseIds);
    const rows = ((caseRows ?? []) as { id: string; firm_id: string | null }[])
      .filter((r) => r.firm_id); // firm matters only
    if (guest) {
      caseIds = rows.filter((r) => r.firm_id === guest.firm_id).map((r) => r.id);
    } else {
      caseIds = rows.map((r) => r.id);
      // Email-invited guest: owning firm is the (single) firm behind their
      // matters. If they span firms - unusual - pick the first deterministically.
      firmId = rows[0]?.firm_id ?? null;
    }
  }

  // A guest is not a firm member, so the RLS read of `firms` returns nothing;
  // fall back to the admin path (the guest's link to firmId was already
  // verified above) so the shell gets the firm's name/logo and trial clock.
  const firm = firmId
    ? (await getFirmById(firmId).catch(() => null)) ??
      (await getFirmByIdAdmin(firmId).catch(() => null))
    : null;

  return {
    userId: user.id,
    email: user.email ?? null,
    displayName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null,
    caseIds,
    firm,
    firmId,
    provisioned: Boolean(guest),
    mustChangePassword: guest ? guest.must_change_password : false,
    guestAccountId: guest ? guest.id : null,
  };
}

/** Convenience wrapper that reads the current session first. */
export async function getGuestContext(): Promise<GuestContext | null> {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  return resolveGuestContextForUser(user);
}

/** True when this guest may reach the given matter. Always verify server-side. */
export function guestCanAccessCase(
  guest: GuestContext,
  caseId: string,
): boolean {
  return guest.caseIds.includes(caseId);
}

/**
 * The ONLY /counsel/* paths a guest may reach:
 *   - /counsel/guest, /counsel/guest/*   (holding page, force-change, profile)
 *   - /counsel/cases/<id>[/*]            (their assigned matter + subpages)
 * Everything else in the workspace is denied. Pass the effective x-pathname.
 */
export function guestPathAllowed(
  guest: GuestContext,
  pathname: string,
): boolean {
  if (pathname === '/counsel/guest' || pathname.startsWith('/counsel/guest/')) {
    return true;
  }
  const m = /^\/counsel\/cases\/([^/]+)(?:\/.*)?$/.exec(pathname);
  if (m && m[1] && guest.caseIds.includes(m[1])) return true;
  return false;
}

/**
 * True when the CURRENT user is a case-scoped guest allowed to READ `caseId`.
 * Optionally require the matter to belong to `firmId` (defense in depth). Used
 * to widen the firm-side read paths (timeline bundle, export) to co-counsel
 * guests without loosening the firm-only WRITE gates. Fails closed.
 */
export async function guestCanReadCase(
  caseId: string,
  firmId?: string,
): Promise<boolean> {
  const guest = await getGuestContext();
  if (!guest) return false;
  if (!guestCanAccessCase(guest, caseId)) return false;
  if (firmId && guest.firmId && guest.firmId !== firmId) return false;
  return true;
}

/** Where to send a guest who hit a path they may not reach. */
export function guestFallbackPath(guest: GuestContext): string {
  if (guest.mustChangePassword) return '/counsel/guest/password';
  if (guest.caseIds.length > 0) return `/counsel/cases/${guest.caseIds[0]}`;
  return '/counsel/guest';
}

export type GuestCaseSummary = {
  id: string;
  title: string;
  subjectName: string | null;
  caseType: string | null;
  status: string | null;
  jurisdictionState: string | null;
  jurisdictionCity: string | null;
  jurisdictionCountry: string | null;
  description: string | null;
  hearingAt: string | null;
  hearingLocation: string | null;
};

/**
 * Read the guest-safe summary of a matter, or null if the current user is not
 * a guest with access to it. Only non-privileged, matter-descriptive fields -
 * never firm-internal ops (time, billing, trust, invoices, members).
 */
export async function getGuestCaseSummary(
  caseId: string,
): Promise<{ case: GuestCaseSummary; guest: GuestContext } | null> {
  const guest = await getGuestContext();
  if (!guest || !guestCanAccessCase(guest, caseId)) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;
  const { data } = await admin
    .from('cases')
    .select(
      'id, title, subject_name, case_type, status, jurisdiction_state, jurisdiction_city, jurisdiction_country, description, hearing_at, hearing_location',
    )
    .eq('id', caseId)
    .maybeSingle();
  if (!data) return null;
  const c = data as {
    id: string;
    title: string;
    subject_name: string | null;
    case_type: string | null;
    status: string | null;
    jurisdiction_state: string | null;
    jurisdiction_city: string | null;
    jurisdiction_country: string | null;
    description: string | null;
    hearing_at: string | null;
    hearing_location: string | null;
  };
  return {
    guest,
    case: {
      id: c.id,
      title: c.title,
      subjectName: c.subject_name,
      caseType: c.case_type,
      status: c.status,
      jurisdictionState: c.jurisdiction_state,
      jurisdictionCity: c.jurisdiction_city,
      jurisdictionCountry: c.jurisdiction_country,
      description: c.description,
      hearingAt: c.hearing_at,
      hearingLocation: c.hearing_location,
    },
  };
}

/**
 * Cut a guest's access when they are removed from a matter. The caller has
 * already deleted the case_collaborators row (that alone revokes the matter -
 * there is no re-grant handler, so an old invite/magic link signs them in with
 * NO grant). This adds the belt-and-suspenders step for FIRM-PROVISIONED
 * guests: if the removed person is such a guest and this was their LAST matter,
 * deactivate the whole firm-owned identity so it is permanently cut - not left
 * as a dormant login that lands on the holding page. A multi-matter guest keeps
 * their other matters (only that one collaborator row was removed).
 *
 * Best-effort and idempotent; never throws into the caller.
 */
export async function revokeGuestAccessOnRemoval(input: {
  userId: string | null;
  firmId: string;
}): Promise<void> {
  const { userId, firmId } = input;
  if (!userId) return; // pending/held invite: deleting the row already revoked
  const admin = createAdminSupabase();
  if (!admin) return;
  try {
    const { data: guestRow } = await admin
      .from('firm_guest_accounts')
      .select('id, deactivated_at')
      .eq('user_id', userId)
      .eq('firm_id', firmId)
      .maybeSingle();
    const guest = guestRow as { id: string; deactivated_at: string | null } | null;
    if (!guest || guest.deactivated_at) return; // not provisioned, or already cut
    // Any remaining co-counsel matters for this identity?
    const { data: remaining } = await admin
      .from('case_collaborators')
      .select('id')
      .eq('user_id', userId)
      .eq('role', 'attorney')
      .limit(1);
    if (remaining && remaining.length > 0) return; // still on another matter
    await admin
      .from('firm_guest_accounts')
      .update({
        deactivated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', guest.id);
  } catch {
    // Table not migrated / transient failure - the collaborator-row deletion
    // already revoked matter access, so this is non-blocking.
  }
}

export type CaseGuestAccount = {
  guestAccountId: string;
  userId: string;
  username: string;
  deactivatedAt: string | null;
  mustChangePassword: boolean;
};

/**
 * List the firm-PROVISIONED guest identities that have access to `caseId`
 * (matched via their attorney collaborator row). Firm-side read through the
 * admin client; the caller's authorization is enforced by the case page.
 */
export async function listCaseGuestAccounts(
  caseId: string,
  firmId: string,
): Promise<CaseGuestAccount[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data: collabRows } = await admin
    .from('case_collaborators')
    .select('user_id')
    .eq('case_id', caseId)
    .eq('role', 'attorney')
    .not('user_id', 'is', null);
  const userIds = Array.from(
    new Set(
      ((collabRows ?? []) as { user_id: string | null }[])
        .map((r) => r.user_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  if (userIds.length === 0) return [];
  const { data: guestRows } = await admin
    .from('firm_guest_accounts')
    .select('id, user_id, username, deactivated_at, must_change_password')
    .eq('firm_id', firmId)
    .in('user_id', userIds);
  return ((guestRows ?? []) as {
    id: string;
    user_id: string;
    username: string;
    deactivated_at: string | null;
    must_change_password: boolean;
  }[]).map((g) => ({
    guestAccountId: g.id,
    userId: g.user_id,
    username: g.username,
    deactivatedAt: g.deactivated_at,
    mustChangePassword: g.must_change_password,
  }));
}

// ── Guest-scoped reads (READ-ONLY) ─────────────────────────────────────────
// Guests view + export their matter; they do not run the firm builder. These
// helpers re-verify access on every call and read through the admin client
// (a guest is not the case row owner, so RLS would otherwise return nothing),
// exactly mirroring the firm-side read path.

export type GuestTimelineEvent = {
  id: string;
  occurredAt: string | null;
  occurredPrecision: OccurredPrecision;
  kind: string;
  title: string;
  description: string | null;
  sourceLabel: string | null;
  attachments: number;
};

export type GuestTimelineBundle = {
  events: GuestTimelineEvent[];
  people: Array<{ id: string; displayName: string | null; role: string | null }>;
  narrative: {
    summary: string | null;
    narrative: string | null;
    conclusion: string | null;
  } | null;
};

/**
 * Read a matter's timeline for a guest. Returns an empty bundle (never throws)
 * when the caller is not a guest with access to `caseId`.
 */
export async function getGuestTimelineBundle(
  caseId: string,
): Promise<GuestTimelineBundle> {
  const empty: GuestTimelineBundle = { events: [], people: [], narrative: null };
  const guest = await getGuestContext();
  if (!guest || !guestCanAccessCase(guest, caseId)) return empty;
  const admin = createAdminSupabase();
  if (!admin) return empty;
  const [{ data: ev }, { data: pl }, { data: nr }] = await Promise.all([
    admin
      .from('case_timeline_events')
      .select('id, occurred_at, occurred_precision, kind, title, description, source_label, media, position, ai_extracted')
      .eq('case_id', caseId),
    admin
      .from('case_people')
      .select('id, display_name, role')
      .eq('case_id', caseId)
      .order('display_name'),
    admin
      .from('case_timeline_narratives')
      .select('summary, narrative, conclusion')
      .eq('case_id', caseId)
      .maybeSingle(),
  ]);
  type Row = {
    id: string;
    occurred_at: string | null;
    occurred_precision: OccurredPrecision | null;
    kind: string | null;
    title: string | null;
    description: string | null;
    source_label: string | null;
    media: unknown[] | null;
    position: number | null;
    ai_extracted: { relevance_score?: number } | null;
  };
  const events: GuestTimelineEvent[] = ((ev ?? []) as Row[])
    // Only items USEFUL to the case (relevance band medium/high, plus unscored);
    // low-relevance uploads stay in the evidence database, off the chronology.
    .filter((r) => relevanceBand(r.ai_extracted?.relevance_score) !== 'low')
    .map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      occurredPrecision: r.occurred_precision ?? 'day',
      kind: r.kind ?? 'note',
      title: r.title ?? '',
      description: r.description,
      sourceLabel: r.source_label,
      attachments: Array.isArray(r.media) ? r.media.length : 0,
      _pos: r.position ?? 0,
    }))
    // Chronological, undated last; stable by position within the same instant.
    .sort((a, b) => {
      const at = a.occurredAt ? Date.parse(a.occurredAt) : Number.POSITIVE_INFINITY;
      const bt = b.occurredAt ? Date.parse(b.occurredAt) : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return a._pos - b._pos;
    })
    .map(({ _pos, ...rest }) => rest);
  const people = ((pl ?? []) as { id: string; display_name: string | null; role: string | null }[]).map(
    (p) => ({ id: p.id, displayName: p.display_name, role: p.role }),
  );
  return {
    events,
    people,
    narrative: (nr as GuestTimelineBundle['narrative']) ?? null,
  };
}
