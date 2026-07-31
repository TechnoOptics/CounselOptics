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
 * `severity: 'info'` and auto-acknowledged so they DON'T land in the
 * dashboard's "open events need triage" queue. Security-relevant events
 * (login_failed, suspicious) are logged with a higher severity and left
 * unacknowledged so they surface for review. Logging is best-effort and
 * never throws into the caller: an audit-write failure must not break the
 * user action it is recording.
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

export type SecuritySeverity = 'info' | 'warning' | 'critical';

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
    if (!admin) return;
    const severity: SecuritySeverity = input.severity ?? 'info';
    await admin.from('security_events').insert({
      kind: input.kind,
      severity,
      user_id: input.userId ?? null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      url: input.url ?? null,
      details: input.details ?? {},
      // Routine info entries are audit records, not alerts: pre-acknowledge
      // so they don't flood the triage dashboard. Warnings/criticals stay
      // open for review.
      acknowledged_at: severity === 'info' ? new Date().toISOString() : null,
    });
  } catch {
    /* best-effort audit; never block the primary action */
  }
}
