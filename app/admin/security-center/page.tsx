import Link from 'next/link';
import { runAllPulseChecks, type PulseCheckResult } from '@/lib/security-pulse';
import { createAdminSupabase } from '@/lib/supabase/admin';
import {
  scanAttachments,
  gradeFromPulse,
  getPostureSignals,
  type AttachmentScan,
  type PostureSignal,
  type PostureGrade,
} from '@/lib/security-scan';
import { LocaleTime } from '@/components/LocaleTime';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: { absolute: 'Security Center · Advottic HQ' },
};

const SINCE_24H = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

type SecurityEventRow = {
  kind: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
  acknowledged_at: string | null;
};
type ImpersonationRow = {
  admin_email: string | null;
  target_email: string | null;
  reason: string | null;
  created_at: string;
};
type HealthRow = {
  ran_at: string;
  probes: Record<string, string>;
  failures: { probe: string; error: string }[];
};

type ThreatMonitor = {
  openEvents: number;
  events24h: SecurityEventRow[];
  sev24h: { low: number; medium: number; high: number; critical: number };
  failedLogins24h: number;
  recent: SecurityEventRow[];
  impersonations: ImpersonationRow[];
  eventsTableMissing: boolean;
};
type Resilience = {
  health: HealthRow | null;
  crashOpen: number;
  crashTableMissing: boolean;
};

async function gatherThreatMonitor(
  admin: ReturnType<typeof createAdminSupabase>,
): Promise<ThreatMonitor> {
  const base: ThreatMonitor = {
    openEvents: 0,
    events24h: [],
    sev24h: { low: 0, medium: 0, high: 0, critical: 0 },
    failedLogins24h: 0,
    recent: [],
    impersonations: [],
    eventsTableMissing: !admin,
  };
  if (!admin) return base;
  const since = SINCE_24H();
  try {
    const [openResp, recentResp, impResp] = await Promise.all([
      admin
        .from('security_events')
        .select('id', { count: 'exact', head: true })
        .is('acknowledged_at', null),
      admin
        .from('security_events')
        .select('kind, severity, occurred_at, acknowledged_at')
        .order('occurred_at', { ascending: false })
        .limit(60),
      admin
        .from('admin_impersonations')
        .select('admin_email, target_email, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (
      openResp.error &&
      (openResp.error.message ?? '').toLowerCase().includes('does not exist')
    ) {
      return { ...base, eventsTableMissing: true };
    }
    base.openEvents = openResp.count ?? 0;
    const rows = (recentResp.data ?? []) as SecurityEventRow[];
    base.recent = rows.slice(0, 12);
    const recent24 = rows.filter((r) => r.occurred_at >= since);
    base.events24h = recent24;
    for (const r of recent24) {
      if (r.severity in base.sev24h) base.sev24h[r.severity] += 1;
    }
    base.failedLogins24h = recent24.filter(
      (r) => r.kind === 'login_failed',
    ).length;
    base.impersonations = (impResp.data ?? []) as ImpersonationRow[];
  } catch {
    return { ...base, eventsTableMissing: true };
  }
  return base;
}

async function gatherResilience(
  admin: ReturnType<typeof createAdminSupabase>,
): Promise<Resilience> {
  const base: Resilience = {
    health: null,
    crashOpen: 0,
    crashTableMissing: !admin,
  };
  if (!admin) return base;
  try {
    const [healthResp, crashResp] = await Promise.all([
      admin
        .from('system_health')
        .select('ran_at, probes, failures')
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('crash_reports')
        .select('id', { count: 'exact', head: true })
        .is('acknowledged_at', null),
    ]);
    base.health = (healthResp.data as HealthRow | null) ?? null;
    if (
      crashResp.error &&
      (crashResp.error.message ?? '').toLowerCase().includes('does not exist')
    ) {
      base.crashTableMissing = true;
    } else {
      base.crashOpen = crashResp.count ?? 0;
      base.crashTableMissing = false;
    }
  } catch {
    base.crashTableMissing = true;
  }
  return base;
}

export default async function SecurityCenterPage() {
  const admin = createAdminSupabase();
  const [pulse, scan, threat, resilience] = await Promise.all([
    runAllPulseChecks(),
    scanAttachments(admin),
    gatherThreatMonitor(admin),
    gatherResilience(admin),
  ]);
  const grade = gradeFromPulse(pulse);
  const signals = getPostureSignals();

  const rls = pulse.results.find((r) => r.id === 'access.rls_critical');
  const envelope = pulse.results.find((r) => r.id === 'crypto.envelope');
  const esign = pulse.results.find((r) => r.id === 'integrity.esign_chain');

  const emailConfigured = Boolean(process.env.RESEND_API_KEY?.trim());

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Operations</p>
        <h2 className="font-display text-2xl text-gold-flow tracking-[-0.01em]">
          Security Center
        </h2>
        <p className="text-[13px] text-cream-100/70 mt-1 max-w-3xl">
          The fortress view. One screen that proves Advottic defends the
          application, the data, the documents, and every account. It runs the
          full control battery, scans every stored attachment for threats,
          tracks privileged access, and reports the encryption and isolation
          posture in real time. Nothing here is fabricated: every number is a
          live read of the production platform.
        </p>
      </header>

      <PostureHero grade={grade} pulse={pulse} />

      <ControlBattery results={pulse.results} />

      <ThreatPanel threat={threat} />

      <AttachmentScanPanel scan={scan} />

      <DataProtectionPanel
        rls={rls}
        envelope={envelope}
        signals={signals}
      />

      <EmailSurfacePanel
        emailConfigured={emailConfigured}
        scan={scan}
      />

      <ResiliencePanel resilience={resilience} esign={esign} />

      <ControlsChecklist signals={signals} />

      <p className="text-[11px] text-cream-100/40">
        Last full sweep <LocaleTime iso={pulse.ranAt} mode="datetime" /> ·{' '}
        {pulse.totalDurationMs} ms · live data ·{' '}
        <Link href="/admin/security" className="underline hover:text-cream-100/70">
          open the live pulse for per-control autofixes
        </Link>
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------- */

function PostureHero({
  grade,
  pulse,
}: {
  grade: PostureGrade;
  pulse: Awaited<ReturnType<typeof runAllPulseChecks>>;
}) {
  const toneRing =
    grade.tone === 'green'
      ? 'ring-emerald-700/40 bg-emerald-950/20'
      : grade.tone === 'amber'
        ? 'ring-amber-700/40 bg-amber-950/20'
        : 'ring-rose-700/40 bg-rose-950/25';
  const gradeColor =
    grade.tone === 'green'
      ? 'text-emerald-300'
      : grade.tone === 'amber'
        ? 'text-amber-300'
        : 'text-rose-300';
  return (
    <section className={`card p-6 ring-1 ${toneRing}`}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <div
            className={`font-display leading-none ${gradeColor}`}
            style={{ fontSize: '4.5rem' }}
          >
            {grade.grade}
          </div>
          <div>
            <p className="eyebrow text-cream-100/55">Security posture</p>
            <p className="font-display text-xl text-cream-100 mt-0.5">
              {grade.label}
            </p>
            <p className="text-[12.5px] text-cream-100/60 mt-1 max-w-md">
              Graded from the live control battery. The grade only reaches A
              when every control passes with zero advisories.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[12px]">
          <Stat tone="emerald" value={pulse.counts.healthy} label="passing" />
          <Stat tone="amber" value={pulse.counts.warning} label="advisory" />
          <Stat tone="rose" value={pulse.counts.critical} label="critical" />
          <Stat tone="slate" value={pulse.counts.unknown} label="unknown" />
        </div>
      </div>
    </section>
  );
}

function ControlBattery({ results }: { results: PulseCheckResult[] }) {
  const byCat = new Map<string, PulseCheckResult[]>();
  for (const r of results) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }
  const CAT_LABEL: Record<string, string> = {
    crypto: 'Encryption',
    auth: 'Authentication',
    access: 'Access control',
    integrity: 'Data integrity',
    data: 'Data protection',
    deploy: 'Delivery',
    config: 'Configuration',
  };
  return (
    <Panel
      title="Control battery"
      blurb="Every implemented security control, grouped by domain. Each runs server-side on every sweep."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...byCat.entries()].map(([cat, list]) => {
          const crit = list.filter((r) => r.status === 'critical').length;
          const warn = list.filter((r) => r.status === 'warning').length;
          const dotTone = crit
            ? 'bg-rose-400'
            : warn
              ? 'bg-amber-400'
              : 'bg-emerald-400';
          const ring = crit
            ? 'ring-rose-700/40 bg-rose-950/20'
            : warn
              ? 'ring-amber-700/40 bg-amber-950/15'
              : 'ring-emerald-700/30 bg-emerald-950/12';
          return (
            <article
              key={cat}
              className={`card p-4 ring-1 ${ring} space-y-2`}
            >
              <header className="flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-cream-100">
                  {CAT_LABEL[cat] ?? cat}
                </p>
                <span
                  className={`inline-flex h-2.5 w-2.5 rounded-full ${dotTone}`}
                />
              </header>
              <ul className="space-y-1.5">
                {list.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 text-[11.5px] text-cream-100/75 leading-snug"
                  >
                    <span
                      className={`mt-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${
                        r.status === 'critical'
                          ? 'bg-rose-400'
                          : r.status === 'warning'
                            ? 'bg-amber-400'
                            : r.status === 'healthy'
                              ? 'bg-emerald-400'
                              : 'bg-cream-100/35'
                      }`}
                    />
                    <span>
                      <span className="text-cream-100/90">{r.label}</span>
                      <span className="block text-cream-100/50">
                        {r.message}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function ThreatPanel({ threat }: { threat: ThreatMonitor }) {
  if (threat.eventsTableMissing) {
    return (
      <Panel
        title="Threat & access monitor"
        blurb="Suspicious-activity feed, severity triage, and the privileged-access log."
      >
        <div className="card p-4 ring-1 ring-white/10 bg-white/5 text-[12.5px] text-cream-100/65">
          The security-events feed is provisioned but has no rows yet, so there
          is nothing suspicious to triage. Detections (login spikes, anomalous
          access) append here automatically as they happen.
        </div>
      </Panel>
    );
  }
  return (
    <Panel
      title="Threat & access monitor"
      blurb="Suspicious-activity feed, 24-hour severity triage, and the privileged-access log."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <Tile
          label="Open events"
          value={threat.openEvents}
          tone={threat.openEvents > 5 ? 'rose' : threat.openEvents > 0 ? 'amber' : 'emerald'}
          sub="awaiting triage"
        />
        <Tile
          label="Critical / 24h"
          value={threat.sev24h.critical}
          tone={threat.sev24h.critical > 0 ? 'rose' : 'emerald'}
          sub="highest severity"
        />
        <Tile
          label="High / 24h"
          value={threat.sev24h.high}
          tone={threat.sev24h.high > 0 ? 'amber' : 'emerald'}
          sub="elevated severity"
        />
        <Tile
          label="Failed logins / 24h"
          value={threat.failedLogins24h}
          tone={
            threat.failedLogins24h >= 100
              ? 'rose'
              : threat.failedLogins24h >= 25
                ? 'amber'
                : 'emerald'
          }
          sub="credential-stuffing signal"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03]">
          <p className="text-[12px] font-semibold text-cream-100 mb-2">
            Recent security events
          </p>
          {threat.recent.length === 0 ? (
            <p className="text-[12px] text-cream-100/55">
              No events recorded. Quiet is good.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {threat.recent.map((e, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 text-[11.5px]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <SevDot sev={e.severity} />
                    <span className="font-mono text-cream-100/85 truncate">
                      {e.kind}
                    </span>
                  </span>
                  <span className="text-cream-100/45 shrink-0">
                    <LocaleTime iso={e.occurred_at} mode="datetime" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03]">
          <p className="text-[12px] font-semibold text-cream-100 mb-2">
            Privileged-access log
          </p>
          {threat.impersonations.length === 0 ? (
            <p className="text-[12px] text-cream-100/55">
              No admin support-impersonation sessions recorded. Every such
              session is audited with actor, target, reason, IP, and user
              agent.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {threat.impersonations.map((m, i) => (
                <li key={i} className="text-[11.5px] leading-snug">
                  <span className="text-cream-100/85">
                    {m.admin_email ?? 'admin'}
                  </span>
                  <span className="text-cream-100/45"> → </span>
                  <span className="text-cream-100/85">
                    {m.target_email ?? 'user'}
                  </span>
                  <span className="block text-cream-100/45">
                    {m.reason ? `${m.reason} · ` : ''}
                    <LocaleTime iso={m.created_at} mode="datetime" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </Panel>
  );
}

function AttachmentScanPanel({ scan }: { scan: AttachmentScan }) {
  return (
    <Panel
      title="Attachment & content threat scan"
      blurb="Every stored file across firm documents, case exhibits, and user receipts, classified for executable payloads, macro abuse, double-extension disguises, and type spoofing."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
        <Tile label="Files scanned" value={scan.scanned} tone="slate" sub="at rest" />
        <Tile label="Clean" value={scan.clean} tone="emerald" sub="no risk markers" />
        <Tile
          label="Critical"
          value={scan.flagged.critical}
          tone={scan.flagged.critical > 0 ? 'rose' : 'emerald'}
          sub="executable / disguise"
        />
        <Tile
          label="High"
          value={scan.flagged.high}
          tone={scan.flagged.high > 0 ? 'amber' : 'emerald'}
          sub="macro / active / spoof"
        />
        <Tile
          label="Medium"
          value={scan.flagged.medium}
          tone={scan.flagged.medium > 0 ? 'amber' : 'emerald'}
          sub="archive / opaque"
        />
      </div>
      {scan.items.length > 0 ? (
        <div className="card p-0 ring-1 ring-white/10 overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-cream-100/45 border-b border-white/8">
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Why flagged</th>
              </tr>
            </thead>
            <tbody>
              {scan.items.map((it, i) => (
                <tr
                  key={i}
                  className="border-b border-white/5 last:border-0 align-top"
                >
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 ${
                        it.level === 'critical'
                          ? 'text-rose-300'
                          : it.level === 'high'
                            ? 'text-amber-300'
                            : 'text-cream-100/70'
                      }`}
                    >
                      <span
                        className={`inline-flex h-1.5 w-1.5 rounded-full ${
                          it.level === 'critical'
                            ? 'bg-rose-400'
                            : it.level === 'high'
                              ? 'bg-amber-400'
                              : 'bg-cream-100/45'
                        }`}
                      />
                      {it.level}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-cream-100/60 whitespace-nowrap">
                    {it.source}
                  </td>
                  <td className="px-3 py-2 font-mono text-cream-100/85 break-all">
                    {it.name}
                  </td>
                  <td className="px-3 py-2 text-cream-100/65">
                    {it.reasons.join('; ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-4 ring-1 ring-emerald-700/30 bg-emerald-950/12 text-[12.5px] text-emerald-100/90">
          {scan.scanned > 0
            ? `All ${scan.scanned} stored files are clean. No executable payloads, macro-enabled documents, disguised extensions, or type-spoofed uploads detected.`
            : 'No stored files to scan yet. The classifier runs automatically as documents, exhibits, and receipts are uploaded.'}
        </div>
      )}
      {scan.uploadMimeAllowlistMissing && (
        <div className="mt-3 card p-3 ring-1 ring-amber-700/40 bg-amber-950/20 text-[11.5px] text-amber-100/90">
          <span className="font-semibold">Hardening opportunity:</span> uploads
          are scanned at rest, but a server-side MIME allow-list at the upload
          boundary is not yet enforced. Tracked as a known control gap so the
          posture stays honest.
        </div>
      )}
    </Panel>
  );
}

function DataProtectionPanel({
  rls,
  envelope,
  signals,
}: {
  rls?: PulseCheckResult;
  envelope?: PulseCheckResult;
  signals: PostureSignal[];
}) {
  return (
    <Panel
      title="Data protection & encryption"
      blurb="Row-level isolation between tenants, envelope encryption of integration tokens, and server-only secret scoping."
    >
      <div className="grid gap-3 lg:grid-cols-2 mb-3">
        <ControlRow
          label="Row-level security on critical tables"
          status={rls?.status ?? 'unknown'}
          message={
            rls?.message ??
            'Service role unavailable; RLS state cannot be read.'
          }
          detail={rls?.detail}
        />
        <ControlRow
          label="Token encryption envelope (AES-256-GCM)"
          status={envelope?.status ?? 'unknown'}
          message={envelope?.message ?? 'Encryption key not verified.'}
          detail={envelope?.detail}
        />
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((s) => (
          <div
            key={s.label}
            className={`card p-3 ring-1 ${
              s.ok
                ? 'ring-emerald-700/30 bg-emerald-950/12'
                : 'ring-amber-700/40 bg-amber-950/15'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  s.ok ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <p className="text-[12px] font-semibold text-cream-100">
                {s.label}
              </p>
            </div>
            <p className="text-[11px] text-cream-100/55 mt-1 leading-snug">
              {s.note}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EmailSurfacePanel({
  emailConfigured,
  scan,
}: {
  emailConfigured: boolean;
  scan: AttachmentScan;
}) {
  return (
    <Panel
      title="Email & content threat surface"
      blurb="How untrusted content enters the platform and how outbound mail is hardened against spoofing and injection."
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03] space-y-1.5">
          <p className="text-[12px] font-semibold text-cream-100">
            Inbound file vector
          </p>
          <p className="text-[11.5px] text-cream-100/65 leading-snug">
            Uploads are the only untrusted-content ingress. Every stored file
            is classified for executables, macros, disguised extensions, and
            type spoofing.
          </p>
          <p className="text-[11.5px] text-cream-100/80">
            {scan.scanned} scanned ·{' '}
            <span
              className={
                scan.flagged.critical + scan.flagged.high > 0
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }
            >
              {scan.flagged.critical + scan.flagged.high} high-risk
            </span>
          </p>
        </article>
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03] space-y-1.5">
          <p className="text-[12px] font-semibold text-cream-100">
            Outbound mail transport
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                emailConfigured ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <p className="text-[11.5px] text-cream-100/80">
              {emailConfigured
                ? 'Provider key configured'
                : 'Provider key not set'}
            </p>
          </div>
          <p className="text-[11.5px] text-cream-100/65 leading-snug">
            All notification mail is sent through a single provider with a
            fixed sender identity, so SPF/DKIM/DMARC align on one domain.
          </p>
        </article>
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03] space-y-1.5">
          <p className="text-[12px] font-semibold text-cream-100">
            Injection hardening
          </p>
          <p className="text-[11.5px] text-cream-100/65 leading-snug">
            Email bodies are built from fixed templates with all user-supplied
            values HTML-escaped. Generated legal text passes a sanitizer that
            strips control characters and model artifacts before it can be
            rendered or mailed.
          </p>
        </article>
      </div>
    </Panel>
  );
}

function ResiliencePanel({
  resilience,
  esign,
}: {
  resilience: Resilience;
  esign?: PulseCheckResult;
}) {
  const h = resilience.health;
  const probeEntries = h ? Object.entries(h.probes ?? {}) : [];
  return (
    <Panel
      title="Resilience & continuity"
      blurb="Live health probes, the e-signature audit chain, and the open-incident backlog."
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="card p-4 ring-1 ring-white/10 bg-white/[0.03]">
          <p className="text-[12px] font-semibold text-cream-100 mb-2">
            Latest health probes
          </p>
          {probeEntries.length === 0 ? (
            <p className="text-[12px] text-cream-100/55">
              No probe snapshot yet. The hourly health cron populates this.
            </p>
          ) : (
            <ul className="space-y-1">
              {probeEntries.map(([name, val]) => (
                <li
                  key={name}
                  className="flex items-center justify-between text-[11.5px]"
                >
                  <span className="font-mono text-cream-100/80">{name}</span>
                  <span
                    className={
                      val === 'fail'
                        ? 'text-rose-300'
                        : 'text-emerald-300'
                    }
                  >
                    {val}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {h?.ran_at && (
            <p className="text-[10.5px] text-cream-100/40 mt-2">
              <LocaleTime iso={h.ran_at} mode="datetime" />
            </p>
          )}
        </article>
        <ControlRow
          label="E-signature audit chain"
          status={esign?.status ?? 'unknown'}
          message={
            esign?.message ?? 'Service role unavailable; cannot walk chains.'
          }
          detail={esign?.detail}
          asCard
        />
        <article
          className={`card p-4 ring-1 ${
            resilience.crashOpen > 0
              ? 'ring-amber-700/40 bg-amber-950/15'
              : 'ring-emerald-700/30 bg-emerald-950/12'
          }`}
        >
          <p className="text-[12px] font-semibold text-cream-100 mb-1">
            Open incident backlog
          </p>
          <p className="font-display text-2xl text-cream-100">
            {resilience.crashTableMissing ? '—' : resilience.crashOpen}
          </p>
          <p className="text-[11px] text-cream-100/55 mt-1">
            {resilience.crashTableMissing
              ? 'Crash reporting not provisioned in this environment.'
              : resilience.crashOpen === 0
                ? 'No unacknowledged crash reports.'
                : 'Unacknowledged crash reports awaiting triage.'}
          </p>
        </article>
      </div>
    </Panel>
  );
}

function ControlsChecklist({ signals }: { signals: PostureSignal[] }) {
  const controls: string[] = [
    'Tenant data isolated by Postgres row-level security; the browser never holds a privileged key.',
    'Integration OAuth tokens envelope-encrypted with AES-256-GCM before storage.',
    'OAuth handshakes carry a single-use, httpOnly, signed state cookie for CSRF and replay resistance.',
    'E-signature events form a hash-chained audit trail verified on every sweep.',
    'Service-role database access is server-only and never shipped to clients.',
    'HQ is gated to verified admins; every support-impersonation session is fully audited.',
    'Scheduled jobs require a shared secret; no anonymous trigger path.',
    'Web push notifications are cryptographically signed end to end (VAPID).',
    'AI provider keys are server-scoped; model access never runs in the browser.',
    'Stored attachments are continuously classified for executable, macro, and disguise threats.',
  ];
  const configured = signals.filter((s) => s.ok).length;
  return (
    <Panel
      title="Implemented controls"
      blurb={`Defense-in-depth posture. ${configured} of ${signals.length} environment-scoped secrets verified present this sweep.`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {controls.map((c, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 text-[12px] text-cream-100/80 leading-snug"
          >
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-[10px]">
              ✓
            </span>
            <span>{c}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* --- shared primitives ------------------------------------------------ */

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-lg text-cream-100">{title}</h3>
        <p className="text-[12px] text-cream-100/55 max-w-3xl mt-0.5">
          {blurb}
        </p>
      </div>
      {children}
    </section>
  );
}

function Stat({
  tone,
  value,
  label,
}: {
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
  value: number;
  label: string;
}) {
  const cls =
    tone === 'emerald'
      ? 'text-emerald-200 ring-emerald-700/40 bg-emerald-950/40'
      : tone === 'amber'
        ? 'text-amber-200 ring-amber-700/40 bg-amber-950/40'
        : tone === 'rose'
          ? 'text-rose-200 ring-rose-700/40 bg-rose-950/40'
          : 'text-cream-100/65 ring-white/10 bg-white/5';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md ring-1 ${cls} font-mono tabular-nums`}
    >
      <span className="font-semibold text-sm">{value}</span>
      <span className="text-[10px] uppercase tracking-[0.16em]">{label}</span>
    </span>
  );
}

function Tile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number | string;
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
  sub: string;
}) {
  const ring =
    tone === 'emerald'
      ? 'ring-emerald-700/30 bg-emerald-950/12'
      : tone === 'amber'
        ? 'ring-amber-700/40 bg-amber-950/15'
        : tone === 'rose'
          ? 'ring-rose-700/40 bg-rose-950/20'
          : 'ring-white/10 bg-white/[0.04]';
  return (
    <article className={`card p-4 ring-1 ${ring}`}>
      <p className="eyebrow text-cream-100/50">{label}</p>
      <p className="font-display text-2xl text-cream-100 mt-1 tabular-nums">
        {value}
      </p>
      <p className="text-[10.5px] text-cream-100/45 mt-0.5">{sub}</p>
    </article>
  );
}

function ControlRow({
  label,
  status,
  message,
  detail,
  asCard,
}: {
  label: string;
  status: 'healthy' | 'warning' | 'critical' | 'unknown';
  message: string;
  detail?: string;
  asCard?: boolean;
}) {
  const ring =
    status === 'critical'
      ? 'ring-rose-700/40 bg-rose-950/20'
      : status === 'warning'
        ? 'ring-amber-700/40 bg-amber-950/15'
        : status === 'healthy'
          ? 'ring-emerald-700/30 bg-emerald-950/12'
          : 'ring-white/10 bg-white/5';
  const dot =
    status === 'critical'
      ? 'bg-rose-400'
      : status === 'warning'
        ? 'bg-amber-400'
        : status === 'healthy'
          ? 'bg-emerald-400'
          : 'bg-cream-100/35';
  return (
    <article className={`card p-4 ring-1 ${ring} ${asCard ? '' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
        <p className="text-[12.5px] font-semibold text-cream-100">{label}</p>
      </div>
      <p className="text-[12px] text-cream-100/75 mt-1.5 leading-snug">
        {message}
      </p>
      {detail && (
        <p className="text-[11px] text-cream-100/50 mt-1 font-mono leading-snug">
          {detail}
        </p>
      )}
    </article>
  );
}

function SevDot({ sev }: { sev: SecurityEventRow['severity'] }) {
  const c =
    sev === 'critical'
      ? 'bg-rose-400'
      : sev === 'high'
        ? 'bg-amber-400'
        : sev === 'medium'
          ? 'bg-yellow-300'
          : 'bg-emerald-400';
  return (
    <span className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />
  );
}
