import 'server-only';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Case activity stream. A per-matter feed the firm can read to see when an
 * outside co-counsel (guest) logs in, views the matter, opens a section,
 * comments, or downloads the packet.
 *
 * All writes go through the ADMIN client (service role) from server code that
 * has already authorized the actor - the table has no anon/authenticated insert
 * policy. Reads are firm-scoped by RLS, and additionally re-checked here.
 */

export type CaseActivityAction =
  | 'login'
  | 'view_matter'
  | 'view_timeline'
  | 'view_evidence'
  | 'open_section'
  | 'comment'
  | 'download'
  | 'export';

export type CaseActor = {
  userId: string;
  email: string | null;
  label: string;
  kind: 'firm' | 'guest' | 'client' | 'other';
  firmId: string | null;
};

export type CaseActivityEvent = {
  id: string;
  action: CaseActivityAction | string;
  actorKind: string;
  actorLabel: string | null;
  actorEmail: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

const NAME_FALLBACK = 'Someone';

/**
 * Who is acting on this matter, and in what capacity. Resolves the current auth
 * user against the case's firm (firm member => 'firm') and the matter's
 * collaborators (attorney => 'guest' co-counsel). Returns null when signed out
 * or the case can't be read.
 */
export async function resolveCaseActor(caseId: string): Promise<CaseActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const admin = createAdminSupabase();
  if (!admin) return null;

  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  const firmId = (caseRow as { firm_id: string | null } | null)?.firm_id ?? null;

  const { data: profileRow } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();
  const displayName = (profileRow as { display_name: string | null } | null)?.display_name ?? null;
  const label =
    (displayName && displayName.trim()) ||
    (user.email ? user.email.split('@')[0] : '') ||
    NAME_FALLBACK;

  let kind: CaseActor['kind'] = 'other';
  if (firmId) {
    const { data: member } = await admin
      .from('firm_members')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (member) kind = 'firm';
  }
  if (kind === 'other') {
    const { data: collab } = await admin
      .from('case_collaborators')
      .select('role')
      .eq('case_id', caseId)
      .eq('user_id', user.id)
      .maybeSingle();
    const role = (collab as { role: string | null } | null)?.role ?? null;
    if (role === 'attorney') kind = 'guest';
    else if (role === 'represented') kind = 'client';
    else if (role) kind = 'other';
  }

  return { userId: user.id, email: user.email ?? null, label, kind, firmId };
}

/**
 * Record an activity event. Fire-and-forget: never throws, so instrumenting a
 * page or action can't break it.
 *
 * @param opts.skipFirm  don't log when the actor is a firm member (used for
 *   routine views/downloads so the owner's own activity doesn't spam the feed).
 * @param opts.throttleMinutes  skip if the same actor logged the same action on
 *   this matter within the window (dedupes page-view churn / reloads).
 */
export async function logCaseActivity(opts: {
  caseId: string;
  action: CaseActivityAction;
  detail?: Record<string, unknown>;
  actor?: CaseActor | null;
  skipFirm?: boolean;
  throttleMinutes?: number;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    if (!admin) return;
    const actor = opts.actor ?? (await resolveCaseActor(opts.caseId));
    if (!actor) return;
    if (opts.skipFirm && actor.kind === 'firm') return;

    if (opts.throttleMinutes && opts.throttleMinutes > 0) {
      const since = new Date(Date.now() - opts.throttleMinutes * 60_000).toISOString();
      const { data: recent } = await admin
        .from('case_activity')
        .select('id')
        .eq('case_id', opts.caseId)
        .eq('actor_user_id', actor.userId)
        .eq('action', opts.action)
        .gte('created_at', since)
        .limit(1);
      if (recent && recent.length > 0) return;
    }

    await admin.from('case_activity').insert({
      case_id: opts.caseId,
      firm_id: actor.firmId,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      actor_label: actor.label,
      actor_kind: actor.kind,
      action: opts.action,
      detail: opts.detail ?? {},
    });
  } catch {
    /* activity logging is best-effort - never surface an error to the caller */
  }
}

/**
 * Firm-scoped read of a matter's activity feed. Verifies the matter belongs to
 * `firmId` before returning anything (defense in depth on top of RLS).
 */
export async function listCaseActivity(
  firmId: string,
  caseId: string,
  limit = 60,
): Promise<CaseActivityEvent[]> {
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data: caseRow } = await admin
    .from('cases')
    .select('firm_id')
    .eq('id', caseId)
    .maybeSingle();
  if ((caseRow as { firm_id: string | null } | null)?.firm_id !== firmId) return [];

  const { data } = await admin
    .from('case_activity')
    .select('id, action, actor_kind, actor_label, actor_email, detail, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    action: String(r.action),
    actorKind: String(r.actor_kind ?? 'guest'),
    actorLabel: (r.actor_label as string | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    createdAt: String(r.created_at),
  }));
}
