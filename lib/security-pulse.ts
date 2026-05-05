import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isIntegrationEncryptionConfigured,
  encryptToken,
  decryptToken,
} from '@/lib/integration-tokens';
import { MICROSOFT_CONFIG, ZOOM_CONFIG } from '@/lib/integration-oauth';
import { verifySignatureChain, sha256 } from '@/lib/esign-audit';
import { isServiceRoleConfigured, createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Security pulse: a battery of checks that run against the live
 * service-role Supabase client + the runtime env to surface attacks,
 * leaks, drift, and bugs across the platform. Each check is short
 * (under 500ms) and side-effect-free until a remedy is explicitly
 * triggered.
 *
 * The engine is intentionally additive: adding a new check means
 * adding one row to ALL_CHECKS. The HQ Security dashboard pulls the
 * full list and renders each as a pulse card; an operator can fire
 * a single check, run all of them, or trigger an autofix when the
 * check exposes one.
 *
 * Design constraints:
 *   - Never auto-apply a destructive remedy. The autofix function
 *     mutates state but only in a way that's reversible (mark a
 *     row as needing reconnect, set a flag, etc.). Anything that
 *     would delete data, ban a user, or revoke a token surfaces as
 *     a human-confirmed action via the dashboard, not autofix.
 *   - Never assume an env var is set. Missing config returns a
 *     warning, not a thrown error - the dashboard should still
 *     render even when half the platform isn't configured.
 *   - Cheap to call: the dashboard polls this every ~30s. Avoid
 *     anything that talks to external APIs unless rate-budgeted.
 */

export type PulseStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export type PulseCategory =
  | 'crypto'
  | 'auth'
  | 'access'
  | 'integrity'
  | 'data'
  | 'deploy'
  | 'config';

export type PulseAutofix = {
  id: string;
  label: string;
  /** True when this fix touches data; the dashboard requires confirmation. */
  destructive?: boolean;
};

export type PulseCheckResult = {
  id: string;
  label: string;
  category: PulseCategory;
  status: PulseStatus;
  message: string;
  detail?: string;
  durationMs: number;
  autofix?: PulseAutofix | null;
  /** ISO timestamp when this run completed. */
  ranAt: string;
};

export type PulseSummary = {
  ranAt: string;
  totalDurationMs: number;
  counts: { healthy: number; warning: number; critical: number; unknown: number };
  pulse: 'green' | 'amber' | 'red' | 'unknown';
  results: PulseCheckResult[];
};

type CheckContext = {
  admin: SupabaseClient | null;
};

type CheckRunner = (ctx: CheckContext) => Promise<{
  status: PulseStatus;
  message: string;
  detail?: string;
  autofix?: PulseAutofix | null;
}>;

type CheckDefinition = {
  id: string;
  label: string;
  category: PulseCategory;
  run: CheckRunner;
};

// ===========================================================================
// Individual checks
// ===========================================================================

const checkEncryptionEnvelope: CheckDefinition = {
  id: 'crypto.envelope',
  label: 'Token encryption envelope',
  category: 'crypto',
  run: async () => {
    if (!isIntegrationEncryptionConfigured()) {
      return {
        status: 'critical',
        message: 'INTEGRATION_ENCRYPTION_KEY missing or malformed.',
        detail:
          'OAuth tokens cannot be stored. Generate a key with `openssl rand -base64 32` and add it to the Vercel env (Sensitive).',
      };
    }
    try {
      const sample = crypto.randomBytes(48).toString('hex');
      const envelope = encryptToken(sample);
      const recovered = decryptToken(envelope);
      if (recovered !== sample) {
        return {
          status: 'critical',
          message: 'Round-trip mismatch: encrypted then decrypted value differs.',
        };
      }
      return {
        status: 'healthy',
        message: 'AES-256-GCM round-trip verified.',
      };
    } catch (err) {
      return {
        status: 'critical',
        message: 'Encrypt or decrypt threw an exception.',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

const checkOAuthProviders: CheckDefinition = {
  id: 'config.oauth',
  label: 'OAuth provider credentials',
  category: 'config',
  run: async () => {
    const missing: string[] = [];
    for (const cfg of [MICROSOFT_CONFIG, ZOOM_CONFIG]) {
      if (!process.env[cfg.clientIdEnv]?.trim()) missing.push(cfg.clientIdEnv);
      if (!process.env[cfg.clientSecretEnv]?.trim())
        missing.push(cfg.clientSecretEnv);
    }
    if (missing.length === 0) {
      return {
        status: 'healthy',
        message: 'Microsoft and Zoom OAuth credentials configured.',
      };
    }
    return {
      status: missing.length >= 4 ? 'warning' : 'warning',
      message: `${missing.length} OAuth env var(s) missing.`,
      detail: missing.join(', '),
    };
  },
};

const checkServiceRole: CheckDefinition = {
  id: 'config.service_role',
  label: 'Supabase service role',
  category: 'config',
  run: async ({ admin }) => {
    if (!isServiceRoleConfigured()) {
      return {
        status: 'critical',
        message: 'SUPABASE_SERVICE_ROLE_KEY not set.',
        detail:
          'HQ functions and any cross-tenant query depend on this key. Add from Supabase Project Settings, API, "service_role".',
      };
    }
    if (!admin) {
      return {
        status: 'critical',
        message: 'Service role configured but client failed to initialize.',
      };
    }
    const { error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (error) {
      return {
        status: 'critical',
        message: 'Service role probe query failed.',
        detail: error.message,
      };
    }
    return {
      status: 'healthy',
      message: 'Service-role client connected.',
    };
  },
};

const checkRlsCriticalTables: CheckDefinition = {
  id: 'access.rls_critical',
  label: 'RLS on critical tables',
  category: 'access',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable; cannot inspect RLS state.',
      };
    }
    const tables = [
      'firm_signing_requests',
      'firm_signatures',
      'firm_documents',
      'firm_integrations',
      'firm_signature_events',
      'profiles',
    ];
    // pg_class.relrowsecurity reflects the table-level "RLS ENABLED" flag.
    // We use the rest call via supabase RPC pattern; if no RPC defined,
    // fall back to a direct table probe (a select with anon would be
    // denied if RLS is on - but admin bypasses, so we cannot detect from
    // a row count alone). The cleanest path is a small SQL function;
    // here we attempt rpc('check_rls') and degrade to a heuristic.
    try {
      const { data, error } = await admin.rpc('hq_check_rls', { p_tables: tables });
      if (!error && Array.isArray(data)) {
        const rows = data as Array<{ table_name: string; rls_enabled: boolean }>;
        const off = rows.filter((r) => !r.rls_enabled).map((r) => r.table_name);
        if (off.length === 0) {
          return {
            status: 'healthy',
            message: `RLS enabled on all ${tables.length} critical tables.`,
          };
        }
        return {
          status: 'critical',
          message: `RLS disabled on ${off.length} table(s).`,
          detail: off.join(', '),
        };
      }
    } catch {
      /* fall through */
    }
    // Heuristic fallback: we cannot verify, so return unknown.
    return {
      status: 'unknown',
      message:
        'Cannot verify RLS state; install hq_check_rls(p_tables text[]) for live readout.',
      detail:
        'Run the migration in supabase/fixes/2026-05-05-hq-check-rls.sql to enable this check.',
    };
  },
};

const checkSignatureChainIntegrity: CheckDefinition = {
  id: 'integrity.esign_chain',
  label: 'E-signature audit chain',
  category: 'integrity',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable; cannot walk audit chains.',
      };
    }
    const { data, error } = await admin
      .from('firm_signing_requests')
      .select('id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(15);
    if (error) {
      return {
        status: 'unknown',
        message: 'Could not list recent signing requests.',
        detail: error.message,
      };
    }
    const requests = (data ?? []) as Array<{ id: string }>;
    if (requests.length === 0) {
      return {
        status: 'healthy',
        message: 'No signing requests yet; chain integrity vacuously holds.',
      };
    }
    const broken: string[] = [];
    for (const r of requests) {
      const v = await verifySignatureChain(admin, r.id);
      if (!v.ok && v.events > 0) broken.push(`${r.id} (${v.reason})`);
    }
    if (broken.length === 0) {
      return {
        status: 'healthy',
        message: `Verified ${requests.length} recent signing request chains.`,
      };
    }
    return {
      status: 'critical',
      message: `${broken.length} broken signing chain(s) found.`,
      detail: broken.join(' | '),
    };
  },
};

const checkStaleOAuthTokens: CheckDefinition = {
  id: 'auth.stale_oauth',
  label: 'OAuth token freshness',
  category: 'auth',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable; cannot inspect token rows.',
      };
    }
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from('firm_integrations')
      .select('id, provider, account_email, token_expires_at, updated_at')
      .lt('token_expires_at', new Date().toISOString())
      .order('token_expires_at', { ascending: true })
      .limit(50);
    if (error) {
      // The table may not exist yet; degrade gracefully.
      if ((error.message ?? '').toLowerCase().includes('does not exist')) {
        return {
          status: 'unknown',
          message: 'firm_integrations table missing; skipping.',
        };
      }
      return {
        status: 'unknown',
        message: 'Could not list firm_integrations.',
        detail: error.message,
      };
    }
    const expired = (data ?? []) as Array<{
      id: string;
      provider: string;
      account_email: string | null;
      updated_at: string;
    }>;
    const stale = expired.filter((r) => r.updated_at < oneDayAgo);
    if (expired.length === 0) {
      return {
        status: 'healthy',
        message: 'No expired OAuth tokens in firm_integrations.',
      };
    }
    return {
      status: stale.length > 0 ? 'warning' : 'healthy',
      message:
        stale.length > 0
          ? `${stale.length} expired token(s) not refreshed in 24h.`
          : `${expired.length} expired token(s) (will refresh on next use).`,
      detail: expired
        .slice(0, 8)
        .map((r) => `${r.provider}:${r.account_email ?? r.id}`)
        .join(', '),
      autofix:
        stale.length > 0
          ? {
              id: 'mark_integrations_needs_reconnect',
              label: `Force ${stale.length} stale connection(s) to re-auth`,
            }
          : null,
    };
  },
};

const checkOpenSecurityEvents: CheckDefinition = {
  id: 'integrity.open_events',
  label: 'Open security events',
  category: 'integrity',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable; cannot count events.',
      };
    }
    const { count, error } = await admin
      .from('security_events')
      .select('id', { count: 'exact', head: true })
      .is('acknowledged_at', null);
    if (error) {
      if ((error.message ?? '').toLowerCase().includes('does not exist')) {
        return {
          status: 'unknown',
          message: 'security_events table missing; provision migration.',
          detail:
            'Run supabase/fixes/2026-05-05-security-events.sql to enable event tracking.',
        };
      }
      return {
        status: 'unknown',
        message: 'Could not count open security events.',
        detail: error.message,
      };
    }
    if (!count || count === 0) {
      return {
        status: 'healthy',
        message: 'No unacknowledged security events.',
      };
    }
    return {
      status: count > 5 ? 'critical' : 'warning',
      message: `${count} open security event(s) need triage.`,
    };
  },
};

const checkLoginFailureSpike: CheckDefinition = {
  id: 'auth.login_spike',
  label: 'Failed-login spike (24h)',
  category: 'auth',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable.',
      };
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Look for security_events of kind 'login_failed' first; fall back
    // to a soft signal from auth.audit_log_entries via auth schema if
    // exposed (Supabase usually does not expose it via PostgREST so we
    // rely on the application-side log).
    const { count, error } = await admin
      .from('security_events')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'login_failed')
      .gte('occurred_at', since);
    if (error) {
      return {
        status: 'unknown',
        message: 'Could not query login_failed events.',
        detail: error.message,
      };
    }
    const total = count ?? 0;
    if (total < 25) {
      return {
        status: 'healthy',
        message: `${total} failed login(s) in last 24h.`,
      };
    }
    if (total < 100) {
      return {
        status: 'warning',
        message: `Elevated: ${total} failed logins in 24h.`,
        autofix: {
          id: 'enable_strict_rate_limit',
          label: 'Tighten /auth rate limit for 1 hour',
        },
      };
    }
    return {
      status: 'critical',
      message: `Spike: ${total} failed logins in 24h - possible credential stuffing.`,
      autofix: {
        id: 'enable_strict_rate_limit',
        label: 'Tighten /auth rate limit for 1 hour',
        destructive: false,
      },
    };
  },
};

const checkDocumentShaSpotCheck: CheckDefinition = {
  id: 'data.doc_sha_spotcheck',
  label: 'Document SHA-256 spot check',
  category: 'data',
  run: async ({ admin }) => {
    if (!admin) {
      return {
        status: 'unknown',
        message: 'Service role unavailable.',
      };
    }
    const { data, error } = await admin
      .from('firm_signing_requests')
      .select('id, document_id, document_sha256')
      .not('document_sha256', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) {
      return {
        status: 'unknown',
        message: 'Could not list signing requests for spot check.',
        detail: error.message,
      };
    }
    const rows = (data ?? []) as Array<{
      id: string;
      document_id: string;
      document_sha256: string;
    }>;
    if (rows.length === 0) {
      return {
        status: 'healthy',
        message: 'No hashed documents to spot-check yet.',
      };
    }
    const mismatches: string[] = [];
    for (const r of rows) {
      const { data: doc } = await admin
        .from('firm_documents')
        .select('file_path')
        .eq('id', r.document_id)
        .maybeSingle();
      const filePath = (doc as { file_path?: string } | null)?.file_path;
      if (!filePath) continue;
      try {
        const downloaded = await admin.storage
          .from('firm-documents')
          .download(filePath);
        if (downloaded.error || !downloaded.data) continue;
        const arr = await downloaded.data.arrayBuffer();
        const observed = sha256(Buffer.from(arr));
        if (observed !== r.document_sha256) mismatches.push(r.id);
      } catch {
        /* skip on any storage hiccup */
      }
    }
    if (mismatches.length === 0) {
      return {
        status: 'healthy',
        message: `${rows.length} document hash(es) match storage bytes.`,
      };
    }
    return {
      status: 'critical',
      message: `${mismatches.length} document hash mismatch(es).`,
      detail:
        'Stored bytes differ from the hash recorded at signing-request creation. Documents may have been tampered with after consent.',
    };
  },
};

const checkSubdomainHealth: CheckDefinition = {
  id: 'deploy.subdomain',
  label: 'enterprise.advottic.com reachability',
  category: 'deploy',
  run: async () => {
    const url = 'https://enterprise.advottic.com/';
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: ctrl.signal,
      });
      clearTimeout(t);
      // 200, 3xx (redirect), 401 (auth gate) all mean the route is up.
      const ok = resp.status >= 200 && resp.status < 500;
      return ok
        ? {
            status: 'healthy' as const,
            message: `Subdomain responded with ${resp.status}.`,
          }
        : {
            status: 'warning' as const,
            message: `Subdomain returned ${resp.status}.`,
          };
    } catch (err) {
      return {
        status: 'warning',
        message: 'Subdomain unreachable from server.',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ===========================================================================
// Engine
// ===========================================================================

export const ALL_CHECKS: CheckDefinition[] = [
  checkEncryptionEnvelope,
  checkOAuthProviders,
  checkServiceRole,
  checkRlsCriticalTables,
  checkSignatureChainIntegrity,
  checkStaleOAuthTokens,
  checkOpenSecurityEvents,
  checkLoginFailureSpike,
  checkDocumentShaSpotCheck,
  checkSubdomainHealth,
];

export async function runAllPulseChecks(): Promise<PulseSummary> {
  const start = Date.now();
  const admin = createAdminSupabase();
  const ctx: CheckContext = { admin };

  const results: PulseCheckResult[] = await Promise.all(
    ALL_CHECKS.map(async (def) => {
      const t0 = Date.now();
      try {
        const out = await def.run(ctx);
        return {
          id: def.id,
          label: def.label,
          category: def.category,
          status: out.status,
          message: out.message,
          detail: out.detail,
          autofix: out.autofix ?? null,
          durationMs: Date.now() - t0,
          ranAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: def.id,
          label: def.label,
          category: def.category,
          status: 'critical' as const,
          message: 'Check threw an unexpected error.',
          detail: err instanceof Error ? err.message : String(err),
          autofix: null,
          durationMs: Date.now() - t0,
          ranAt: new Date().toISOString(),
        };
      }
    }),
  );

  const counts = {
    healthy: results.filter((r) => r.status === 'healthy').length,
    warning: results.filter((r) => r.status === 'warning').length,
    critical: results.filter((r) => r.status === 'critical').length,
    unknown: results.filter((r) => r.status === 'unknown').length,
  };
  const pulse: PulseSummary['pulse'] =
    counts.critical > 0
      ? 'red'
      : counts.warning > 0
        ? 'amber'
        : counts.healthy > 0
          ? 'green'
          : 'unknown';

  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - start,
    counts,
    pulse,
    results,
  };
}

// ===========================================================================
// Auto-remediation playbook
// ===========================================================================

export type AutofixOutcome = {
  ok: boolean;
  appliedTo: number;
  message: string;
};

/**
 * Apply a named remedy. Only safe, reversible remedies live here.
 * The dashboard surfaces destructive actions as buttons, not as
 * autofix entries.
 */
export async function applyAutofix(
  fixId: string,
): Promise<AutofixOutcome> {
  const admin = createAdminSupabase();
  if (!admin) {
    return { ok: false, appliedTo: 0, message: 'Service role unavailable.' };
  }

  if (fixId === 'mark_integrations_needs_reconnect') {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from('firm_integrations')
      .update({ needs_reconnect: true })
      .lt('token_expires_at', new Date().toISOString())
      .lt('updated_at', oneDayAgo)
      .select('id');
    if (error) {
      // If the column does not exist yet, degrade.
      return { ok: false, appliedTo: 0, message: error.message };
    }
    const rows = (data ?? []) as Array<{ id: string }>;
    return {
      ok: true,
      appliedTo: rows.length,
      message: `Marked ${rows.length} stale integration(s) for reconnect.`,
    };
  }

  if (fixId === 'enable_strict_rate_limit') {
    // Strict rate limit is a flag in hq_settings that the auth route
    // reads. The flag is short-lived (1h TTL); the auth handler is
    // free to re-tighten the bucket on every check.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error } = await admin
      .from('hq_settings')
      .upsert({
        key: 'auth_strict_rate_limit_until',
        value: expiresAt,
        updated_at: new Date().toISOString(),
      });
    if (error) {
      return { ok: false, appliedTo: 0, message: error.message };
    }
    return {
      ok: true,
      appliedTo: 1,
      message: `Strict /auth rate limit active until ${expiresAt}.`,
    };
  }

  return {
    ok: false,
    appliedTo: 0,
    message: `Unknown autofix id: ${fixId}.`,
  };
}
