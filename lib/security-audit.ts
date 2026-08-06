import 'server-only';
import { createAdminSupabase } from './supabase/admin';

/**
 * Append-only security/audit event logging (HIPAA 164.312(b) audit controls;
 * SOC 2 CC7.2; ISO 27001 A.8.15). Writes to the existing `security_events`
 * table (RLS: admin-select only, no insert/delete policy -> service-role
 * writes, effectively append-only). The security-pulse dashboard already
 * reads this table.
 *
 * Design note: routine audit entries (login, export) are recorded with
 * `severity: 'low'` and auto-acknowledged so they DON'T land in the
 * dashboard's "open events need triage" queue. Security-relevant events
 * (login_failed, suspicious) are logged with a higher severity and left
 * unacknowledged so they surface for review. Privileged access sits in
 * between: `admin_case_view` and `admin_impersonation` are 'medium', so an
 * operator reaching into a customer's data always asks someone for review
 * (HIPAA 164.308(a)(1)(ii)(D), information system activity review).
 * Logging is best-effort and
 * never throws into the caller: an audit-write failure must not break the
 * user action it is recording. It is never silent either, see
 * `reportAuditFailure` below.
 *
 * The severity vocabulary is pinned by the `security_events_severity_check`
 * constraint on the table and by the HQ dashboards that bucket events into
 * low/medium/high/critical. Do not introduce values outside that set: the
 * insert is untyped, so a bad value fails only at runtime, in production.
 */
export type SecurityEventKind =
  | 'login'
  | 'logout'
  | 'login_failed'
  | 'data_exported'
  | 'account_deleted'
  | 'role_changed'
  | 'employee_deactivated'
  | 'mfa_enrolled'
  | 'mfa_removed'
  | 'admin_impersonation'
  /** An HQ operator opened a case they do not own, via the service role. */
  | 'admin_case_view';

export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';

/** Pull source metadata (IP, UA, URL) from an incoming request. */
export function requestMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
  url: string | null;
} {
  const h = req.headers;
  const fwd = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim();
  const ip = fwd || h.get('x-real-ip') || null;
  let url: string | null = null;
  try {
    url = new URL(req.url).pathname;
  } catch {
    url = null;
  }
  return { ip, userAgent: h.get('user-agent'), url };
}

export async function logSecurityEvent(input: {
  kind: SecurityEventKind;
  severity?: SecuritySeverity;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  url?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminSupabase();
    if (!admin) {
      reportAuditFailure(input.kind, 'service-role key not configured');
      return;
    }
    const severity: SecuritySeverity = input.severity ?? 'low';
    // NOTE: postgrest-js resolves with `{ error }` instead of throwing, so
    // this result MUST be inspected. Ignoring it is what hid a constraint
    // violation that silently dropped every audit write for months.
    const { error } = await admin.from('security_events').insert({
      kind: input.kind,
      severity,
      user_id: input.userId ?? null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      url: input.url ?? null,
      details: input.details ?? {},
      // Routine low entries are audit records, not alerts: pre-acknowledge
      // so they don't flood the triage dashboard. Higher severities stay
      // open for review.
      acknowledged_at: severity === 'low' ? new Date().toISOString() : null,
    });
    if (error) {
      reportAuditFailure(
        input.kind,
        `${error.message}${error.code ? ` (${error.code})` : ''}`,
      );
    }
  } catch (e) {
    // Never block the primary action, but never fail silently either.
    reportAuditFailure(input.kind, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Surface a dropped audit write. An audit trail that can fail invisibly is
 * worse than no audit trail, because it is trusted. This stays on the error
 * channel so it reaches the platform logs and alerting without touching the
 * user-facing request.
 */
function reportAuditFailure(kind: SecurityEventKind, reason: string): void {
  console.error(
    `[security-audit] failed to record security event "${kind}": ${reason}`,
  );
}
