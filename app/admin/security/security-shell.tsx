'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PulseSummary,
  PulseCheckResult,
  PulseStatus,
} from '@/lib/security-pulse';

const POLL_INTERVAL_MS = 30_000;

/**
 * Live security-pulse dashboard. Renders one card per check with a
 * traffic-light dot, the latest message, and (when available) an
 * "Apply fix" button. Polls /api/admin/security-pulse every 30s and
 * exposes a "Run now" button for impatient operators.
 *
 * Pulse animation: the master pulse dot at the top breathes at a
 * cadence that maps to overall posture - green ~2.5s, amber ~1.5s,
 * red ~0.8s. It's a small visual anchor while the operator scans the
 * grid.
 */
export function SecurityPulseShell({ initial }: { initial: PulseSummary }) {
  const [summary, setSummary] = useState<PulseSummary>(initial);
  const [busy, setBusy] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/security-pulse', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as PulseSummary;
      if (!aliveRef.current) return;
      setSummary(next);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, []);

  const applyFix = useCallback(
    async (fixId: string) => {
      setFixingId(fixId);
      setError(null);
      try {
        const res = await fetch('/api/admin/security-pulse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          outcome: { ok: boolean; appliedTo: number; message: string };
          summary: PulseSummary;
        };
        if (!aliveRef.current) return;
        setSummary(body.summary);
        if (!body.outcome.ok) setError(body.outcome.message);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (aliveRef.current) setFixingId(null);
      }
    },
    [],
  );

  useEffect(() => {
    aliveRef.current = true;
    const id = setInterval(() => {
      refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return (
    <div className="space-y-6">
      <PulseHeader summary={summary} busy={busy} onRefresh={refresh} />
      {error && (
        <div className="card p-4 ring-1 ring-rose-700/40 bg-rose-950/30 text-[12.5px] text-rose-200">
          <p className="font-semibold mb-1">Pulse error</p>
          <p>{error}</p>
        </div>
      )}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summary.results.map((r) => (
          <PulseCard
            key={r.id}
            result={r}
            fixing={fixingId === r.autofix?.id}
            onApply={(id) => applyFix(id)}
          />
        ))}
      </section>
    </div>
  );
}

function PulseHeader({
  summary,
  busy,
  onRefresh,
}: {
  summary: PulseSummary;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [pulseDot, pulseLabel, pulseTone] = pulsePalette(summary.pulse);
  const animDuration =
    summary.pulse === 'red'
      ? '0.8s'
      : summary.pulse === 'amber'
        ? '1.5s'
        : summary.pulse === 'green'
          ? '2.5s'
          : '4s';
  return (
    <section className={`card p-5 ring-1 ${pulseTone}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-3 w-3">
            <span
              className={`animate-ping absolute inset-0 rounded-full opacity-75 ${pulseDot}`}
              style={{ animationDuration: animDuration }}
            />
            <span className={`relative inline-flex rounded-full h-3 w-3 ${pulseDot}`} />
          </span>
          <div>
            <p className="font-display text-lg text-cream-100">{pulseLabel}</p>
            <p className="text-[11.5px] text-cream-100/55">
              Last run {new Date(summary.ranAt).toLocaleTimeString()} ·{' '}
              {summary.totalDurationMs} ms · auto-refresh every 30s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <CountPill tone="emerald" value={summary.counts.healthy} label="healthy" />
          <CountPill tone="amber" value={summary.counts.warning} label="warn" />
          <CountPill tone="rose" value={summary.counts.critical} label="crit" />
          <CountPill tone="slate" value={summary.counts.unknown} label="unknown" />
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold tracking-tight ring-1 ring-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>
    </section>
  );
}

function PulseCard({
  result,
  fixing,
  onApply,
}: {
  result: PulseCheckResult;
  fixing: boolean;
  onApply: (id: string) => void;
}) {
  const [dot, _label, ring] = statusPalette(result.status);
  const animDuration =
    result.status === 'critical'
      ? '0.8s'
      : result.status === 'warning'
        ? '1.5s'
        : result.status === 'healthy'
          ? '2.8s'
          : '4s';
  return (
    <article className={`card p-4 ring-1 ${ring} space-y-2.5`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-semibold text-cream-100 leading-tight">
            {result.label}
          </p>
          <p className="eyebrow text-cream-100/55 mt-0.5">{result.category}</p>
        </div>
        <span className="relative inline-flex h-2.5 w-2.5 mt-1.5">
          <span
            className={`animate-ping absolute inset-0 rounded-full opacity-70 ${dot}`}
            style={{ animationDuration: animDuration }}
          />
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dot}`} />
        </span>
      </header>
      <p className="text-[12.5px] text-cream-100/85 leading-snug">
        {result.message}
      </p>
      {result.detail && (
        <p className="text-[11.5px] text-cream-100/55 leading-snug font-mono">
          {result.detail}
        </p>
      )}
      <footer className="flex items-center justify-between pt-1 text-[11px] text-cream-100/45">
        <span className="font-mono tabular-nums">{result.durationMs} ms</span>
        {result.autofix && (
          <button
            type="button"
            onClick={() => onApply(result.autofix!.id)}
            disabled={fixing}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-tight ring-1 transition-colors ${
              result.autofix.destructive
                ? 'ring-rose-700/40 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50'
                : 'ring-amber-700/40 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {fixing ? 'Applying…' : result.autofix.label}
          </button>
        )}
      </footer>
    </article>
  );
}

function CountPill({
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
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md ring-1 ${cls} font-mono tabular-nums`}
    >
      <span className="font-semibold">{value}</span>
      <span className="text-[10.5px] uppercase tracking-[0.16em]">{label}</span>
    </span>
  );
}

function statusPalette(s: PulseStatus): [string, string, string] {
  switch (s) {
    case 'healthy':
      return ['bg-emerald-400', 'Healthy', 'ring-emerald-700/30 bg-emerald-950/15'];
    case 'warning':
      return ['bg-amber-400', 'Warning', 'ring-amber-700/40 bg-amber-950/20'];
    case 'critical':
      return ['bg-rose-400', 'Critical', 'ring-rose-700/40 bg-rose-950/25'];
    default:
      return ['bg-cream-100/40', 'Unknown', 'ring-white/10 bg-white/5'];
  }
}

function pulsePalette(p: PulseSummary['pulse']): [string, string, string] {
  switch (p) {
    case 'green':
      return ['bg-emerald-400', 'All systems holding', 'ring-emerald-700/30 bg-emerald-950/15'];
    case 'amber':
      return ['bg-amber-400', 'Investigation recommended', 'ring-amber-700/40 bg-amber-950/20'];
    case 'red':
      return ['bg-rose-400', 'Critical issue detected', 'ring-rose-700/40 bg-rose-950/25'];
    default:
      return ['bg-cream-100/40', 'Pulse not yet established', 'ring-white/10 bg-white/5'];
  }
}
