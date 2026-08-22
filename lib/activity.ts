/**
 * Case activity log + email digest. Every notable event on a case
 * (viewed, exhibit uploaded, review run, hearing updated, etc.) gets
 * written to public.audit_events, then we conditionally email the case
 * owner with a short summary. Email throttling is per-case + per-event-
 * type with a cooldown so the owner doesn't get spammed when a
 * collaborator clicks around or uploads ten exhibits in a row.
 *
 * Logging is best-effort: failures are caught and logged to console
 * but never block the underlying user action.
 */
import { createAdminSupabase } from './supabase/admin';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { sendEmail } from './email';
import { formatDateTimeLong } from './format';

export type CaseEventType =
  | 'case_created'
  | 'case_viewed'
  | 'case_status_changed'
  | 'case_deleted'
  | 'exhibit_uploaded'
  | 'exhibit_deleted'
  | 'review_run'
  | 'hearing_updated'
  | 'collaborator_invited'
  | 'collaborator_removed'
  | 'witness_statement_updated'
  // Requires supabase/migrations/20260822_case_description_history.sql. The
  // audit_events event_type check is a closed list and logCaseEvent swallows
  // its insert error, so until that migration is applied an edit to the
  // account produces no audit entry. The superseded text itself is not at
  // risk either way: it is written into cases.description_history in the same
  // statement as the new text.
  | 'case_description_updated'
  | 'imported';

const COOLDOWN_MS: Partial<Record<CaseEventType, number>> = {
  // Views are super noisy - only email at most once per 4 hours per
  // (case, viewer).
  case_viewed: 4 * 60 * 60 * 1000,
  // For substantive changes, batch within a 5-minute window so
  // a quick burst of edits coalesces into one email.
  exhibit_uploaded: 5 * 60 * 1000,
  exhibit_deleted: 5 * 60 * 1000,
  review_run: 5 * 60 * 1000,
  hearing_updated: 5 * 60 * 1000,
  case_status_changed: 5 * 60 * 1000,
  collaborator_invited: 0, // always notify
  collaborator_removed: 0,
  witness_statement_updated: 5 * 60 * 1000,
  case_description_updated: 5 * 60 * 1000,
  case_created: 0,
  case_deleted: 0,
  // Migration backfill is bulk + historical; never email about it.
  imported: Number.POSITIVE_INFINITY,
};

const EVENT_LABEL: Record<CaseEventType, string> = {
  case_created: 'Case created',
  case_viewed: 'viewed your case',
  case_status_changed: 'changed the case status',
  case_deleted: 'deleted the case',
  exhibit_uploaded: 'uploaded an exhibit',
  exhibit_deleted: 'deleted an exhibit',
  review_run: 'ran an Advottic Review',
  hearing_updated: 'updated the hearing',
  collaborator_invited: 'invited a collaborator',
  collaborator_removed: 'removed a collaborator',
  witness_statement_updated: 'updated their witness statement',
  case_description_updated: 'rewrote their account of what happened',
  imported: 'imported a record',
};

/**
 * Best-effort hearing reminder: email every collaborator on a case
 * (witnesses included) when the hearing date is set or changes.
 * Uses the service-role client so we don't need elevated session
 * context. Failures are logged + swallowed so a Resend hiccup never
 * blocks the underlying hearing save.
 */
export async function notifyCollaboratorsOfHearing(input: {
  caseId: string;
  hearingAt: string;
  hearingLocation: string | null;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return;
  const { data: caseRow } = await admin
    .from('cases')
    .select('title, subject_name')
    .eq('id', input.caseId)
    .maybeSingle();
  const title =
    (caseRow as { title?: string } | null)?.title ?? 'your Advottic case';
  const { data: collabs } = await admin
    .from('case_collaborators')
    .select('email, role')
    .eq('case_id', input.caseId);
  const recipients = (collabs ?? []) as { email: string; role: string }[];
  if (recipients.length === 0) return;

  const when = formatDateTimeLong(input.hearingAt);
  const where = input.hearingLocation
    ? `<p style="margin:0 0 14px;font-size:14px;color:#3f3f46;"><strong>Where:</strong> ${input.hearingLocation
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</p>`
    : '';

  await Promise.all(
    recipients.map((r) => {
      const roleLabel =
        r.role === 'witness'
          ? "You've been listed as a witness"
          : 'You have collaborator access';
      const subject = `[Advottic] Hearing scheduled for ${title}`;
      const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;padding:18px;color:#0f2d24;background:#f5edd6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5edd6;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:14px;padding:0;overflow:hidden;box-shadow:0 8px 24px -4px rgba(15,45,36,0.10);">
<tr><td style="background:linear-gradient(135deg,#0f2d24,#173b30);padding:18px 24px;">
  <p style="margin:0;color:#d5bb7e;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;font-weight:600;">Advottic · Hearing reminder</p>
  <h1 style="margin:6px 0 0;color:#fbf7e9;font-size:18px;font-weight:600;">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
</td></tr>
<tr><td style="padding:20px 24px;">
  <p style="margin:0 0 10px;font-size:14px;color:#52525b;">${roleLabel} on this case.</p>
  <p style="margin:0 0 14px;font-size:15px;color:#0f2d24;"><strong>When:</strong> ${when}</p>
  ${where}
  <p style="margin:0 0 14px;font-size:13.5px;line-height:1.55;color:#3f3f46;">
    Open the case file in Advottic to review the timeline, exhibits, and your role before the hearing.
  </p>
  <p style="margin:0 0 18px;">
    <a href="https://advottic.com/cases/${input.caseId}" style="display:inline-block;background:#0f2d24;color:#fbf7e9;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:13.5px;">Open case file</a>
  </p>
  <p style="margin:0;font-size:11px;color:#a1a1aa;line-height:1.55;">Advottic provides legal information and case organization, not legal advice. If you weren&rsquo;t expecting this, you can ignore the email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
      return sendEmail({
        to: r.email,
        subject,
        html,
        replyTo: 'contact@advottic.com',
      }).catch((err) => {
        console.error('[notifyCollaboratorsOfHearing]', err);
        return null;
      });
    }),
  );
}

/**
 * Record an audit event and, if appropriate, email the case owner.
 * `actor` defaults to the current user (from cookies). Pass the case
 * row to avoid an extra query when the caller already has it.
 */
export async function logCaseEvent(input: {
  caseId: string;
  eventType: CaseEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createServerSupabase();
    const user = await getCurrentUser();
    if (!user) return;

    const displayName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      null;

    const { data: inserted, error } = await supabase
      .from('audit_events')
      .insert({
        case_id: input.caseId,
        actor_user_id: user.id,
        actor_email: user.email ?? null,
        actor_display_name: displayName,
        event_type: input.eventType,
        metadata: input.metadata ?? {},
      })
      .select('id, created_at')
      .single();
    if (error) {
      console.error('[logCaseEvent] insert failed', error);
      return;
    }

    // Fire-and-forget owner notification; never block the user.
    void notifyOwnerIfDue({
      caseId: input.caseId,
      eventType: input.eventType,
      eventId: (inserted as { id: string }).id,
      actorUserId: user.id,
      actorDisplayName: displayName ?? user.email ?? 'A collaborator',
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error('[logCaseEvent] failed', err);
  }
}

async function notifyOwnerIfDue(input: {
  caseId: string;
  eventType: CaseEventType;
  eventId: string;
  actorUserId: string;
  actorDisplayName: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminSupabase();
  if (!admin) return; // service role required to read other users + email

  // Look up the case + owner. Service role bypasses RLS.
  const { data: caseRow } = await admin
    .from('cases')
    .select('id, title, user_id')
    .eq('id', input.caseId)
    .maybeSingle();
  const c = caseRow as { id: string; title: string; user_id: string } | null;
  if (!c) return;

  // Owners shouldn't email themselves about their own actions.
  if (c.user_id === input.actorUserId) return;

  const cooldown = COOLDOWN_MS[input.eventType] ?? 0;
  if (cooldown > 0) {
    const since = new Date(Date.now() - cooldown).toISOString();
    // Was a notification already sent for THIS case + event-type combination
    // (and, for views specifically, by the same actor) within the cooldown?
    let q = admin
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', input.caseId)
      .eq('event_type', input.eventType)
      .gte('notify_sent_at', since);
    if (input.eventType === 'case_viewed') {
      q = q.eq('actor_user_id', input.actorUserId);
    }
    const { count } = await q;
    if ((count ?? 0) > 0) return; // still on cooldown
  }

  // Look up owner email via the admin auth API.
  const { data: ownerResp } = await admin.auth.admin.getUserById(c.user_id);
  const ownerEmail = ownerResp?.user?.email ?? null;
  if (!ownerEmail) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
  const link = `${siteUrl}/cases/${c.id}`;
  const subject = `${input.actorDisplayName} ${EVENT_LABEL[input.eventType]} - ${c.title}`;
  const html = buildActivityEmailHtml({
    caseTitle: c.title,
    actorDisplayName: input.actorDisplayName,
    eventType: input.eventType,
    metadata: input.metadata,
    link,
  });

  const result = await sendEmail({ to: ownerEmail, subject, html });
  if (result.ok) {
    // Stamp this event so cooldown checks see it.
    await admin
      .from('audit_events')
      .update({ notify_sent_at: new Date().toISOString() })
      .eq('id', input.eventId);
  }
}

function buildActivityEmailHtml(input: {
  caseTitle: string;
  actorDisplayName: string;
  eventType: CaseEventType;
  metadata: Record<string, unknown>;
  link: string;
}): string {
  const headline = `${escapeHtml(input.actorDisplayName)} ${EVENT_LABEL[input.eventType]}`;
  const detail = describeEvent(input.eventType, input.metadata);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5edd6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#0f2d24;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5edd6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -4px rgba(15,45,36,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0f2d24 0%,#173b30 60%,#23362f 100%);padding:24px 32px;">
          <p style="margin:0;color:#d5bb7e;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;font-weight:600;">Advottic activity</p>
          <p style="margin:6px 0 0;color:#fbf7e9;font-size:18px;font-weight:600;">${headline}</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <h1 style="margin:0 0 6px;color:#0f2d24;font-size:18px;font-weight:600;line-height:1.3;">${escapeHtml(input.caseTitle)}</h1>
          ${detail ? `<p style="margin:0 0 18px;color:#3f3f46;font-size:14px;line-height:1.55;">${detail}</p>` : ''}
          <p style="margin:0 0 6px;">
            <a href="${escapeAttribute(input.link)}" style="display:inline-block;background:#0f2d24;color:#fbf7e9;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px;">Open the case</a>
          </p>
          <p style="margin:14px 0 0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">You are receiving this because you own this case on Advottic. We batch related changes within a few minutes so we don't flood you when a collaborator works through several edits at once.</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${new Date().getFullYear()} Advottic LLC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function describeEvent(type: CaseEventType, m: Record<string, unknown>): string {
  switch (type) {
    case 'exhibit_uploaded':
      return m.label && m.fileName
        ? `Added ${escapeHtml(String(m.label))}: ${escapeHtml(String(m.fileName))}.`
        : '';
    case 'exhibit_deleted':
      return m.label ? `Removed ${escapeHtml(String(m.label))}.` : '';
    case 'case_status_changed':
      return m.from && m.to
        ? `Status moved from <strong>${escapeHtml(String(m.from))}</strong> to <strong>${escapeHtml(String(m.to))}</strong>.`
        : '';
    case 'review_run':
      return 'A new Advottic Review is now attached to the case.';
    case 'hearing_updated':
      return m.hearingAt
        ? `New hearing date: <strong>${escapeHtml(String(m.hearingAt))}</strong>.`
        : 'Hearing details updated.';
    case 'collaborator_invited':
      return m.email ? `Invited <strong>${escapeHtml(String(m.email))}</strong>.` : '';
    case 'collaborator_removed':
      return m.email ? `Removed <strong>${escapeHtml(String(m.email))}</strong>.` : '';
    default:
      return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttribute(s: string): string {
  return escapeHtml(s);
}

/**
 * Read the most recent N audit events for a case. Used by the Activity
 * tab on the case detail page. RLS already restricts visibility to
 * case members.
 */
export type AuditEvent = {
  id: string;
  caseId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  eventType: CaseEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function listCaseAuditEvents(caseId: string, limit = 50): Promise<AuditEvent[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, case_id, actor_user_id, actor_email, actor_display_name, event_type, metadata, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[listCaseAuditEvents] failed', error);
    return [];
  }
  return (data as AuditEventRow[]).map(rowToEvent);
}

type AuditEventRow = {
  id: string;
  case_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_display_name: string | null;
  event_type: CaseEventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function rowToEvent(r: AuditEventRow): AuditEvent {
  return {
    id: r.id,
    caseId: r.case_id,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    actorDisplayName: r.actor_display_name,
    eventType: r.event_type,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}
