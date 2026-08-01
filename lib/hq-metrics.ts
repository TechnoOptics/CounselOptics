import { isCrashNoise } from './crash-noise';

/**
 * The arithmetic behind the HQ numbers that were contradicting each other on
 * 2026-08-01. Pure functions, no Supabase, so both the counting and the
 * labelling can be tested and so every surface derives its figure the same way.
 *
 * lib/crash-noise.ts was created for exactly this reason at a smaller scale
 * (49 vs 44) and centralised only the noise *predicate*. The counts stayed
 * per-page, and at 500-row scale they diverged again.
 */

export type OpenCrashSummary = {
  /** Unacknowledged reports worth an operator's attention. */
  open: number;
  /** Unacknowledged reports suppressed as known browser/extension noise. */
  noise: number;
  /** Every unacknowledged report, the exact database total. */
  total: number;
  /** True when the sample was capped, so a page must say "showing N of M". */
  truncated: boolean;
};

/**
 * Reconcile a (possibly capped) sample of unacknowledged crash rows against
 * the exact row count.
 *
 * Three HQ surfaces read the same table and printed 492, 500 and 710. The
 * first two were the 500-row `.limit()` presented as a count; only the
 * `count: 'exact'` on the Security Center was the truth. Passing the exact
 * total alongside the sample means a page can show the honest backlog and
 * still say how much of it it actually inspected.
 */
export function summarizeOpenCrashes(
  sample: ReadonlyArray<{ message: string | null }>,
  exactTotal: number,
): OpenCrashSummary {
  const noiseInSample = sample.filter((r) => isCrashNoise(r.message)).length;
  const truncated = exactTotal > sample.length;
  // Outside the sample we have not read the messages, so we cannot claim any
  // of it is noise. Counting it as signal is the direction that never
  // under-reports a backlog.
  const noise = noiseInSample;
  return {
    // Floored: the sample and the count query run concurrently against a
    // table an operator may be acknowledging rows in, so the count can come
    // back smaller than the sample. Never print a negative backlog.
    open: Math.max(0, exactTotal - noise),
    noise,
    total: exactTotal,
    truncated,
  };
}

export type ProbeUptime = {
  /** Probe results that passed across every run in the window. */
  passedProbes: number;
  /** Probe results that actually ran (`skipped` is not a result). */
  totalProbes: number;
  /** passedProbes / totalProbes, or null when nothing ran. */
  ratio: number | null;
  /** Runs in which every probe passed. Kept for the "N/M all-pass" sub-label. */
  passedRuns: number;
  totalRuns: number;
};

/**
 * Availability measured over probe results rather than over perfect runs.
 *
 * The HQ tile read "24H UPTIME 0.0%" while four of five probes were green,
 * because it counted only runs in which *every* probe passed and the cron
 * fires once a day: one run, one failing dependency, 0/1. That is not uptime.
 * Counting probe results gives 4/5 = 80%, and `passedRuns`/`totalRuns` stays
 * available for a sub-label that says plainly what it is.
 *
 * `skipped` (an unconfigured probe) leaves the denominator rather than
 * counting as a failure: nothing was measured, so nothing was down.
 */
export function summarizeProbeUptime(
  runs: ReadonlyArray<{ probes: Record<string, string> | null }>,
): ProbeUptime {
  let passedProbes = 0;
  let totalProbes = 0;
  let passedRuns = 0;
  for (const run of runs) {
    const values = Object.values(run.probes ?? {}).filter((v) => v !== 'skipped');
    if (values.length === 0) continue;
    totalProbes += values.length;
    const passed = values.filter((v) => v === 'pass').length;
    passedProbes += passed;
    if (passed === values.length) passedRuns += 1;
  }
  return {
    passedProbes,
    totalProbes,
    ratio: totalProbes > 0 ? passedProbes / totalProbes : null,
    passedRuns,
    totalRuns: runs.length,
  };
}

/**
 * The single rule for collapsing a set of security controls into one
 * indicator.
 *
 * The Security Center's domain cards used to count only `critical` and
 * `warning` and paint everything else emerald, so the "Access control" card -
 * whose one control was `unknown` because `hq_check_rls()` is not installed -
 * rendered green. An operator scanning the battery saw all clear and moved
 * on. That is the exact failure the four-state control tier was written to
 * remove, re-created one level up.
 *
 * Order is severity, then honesty: critical > warning > unknown > healthy.
 * An empty set is `unknown`, because nothing was checked.
 */
export function rollupStatus(
  controls: ReadonlyArray<{ status: 'healthy' | 'warning' | 'critical' | 'unknown' }>,
): 'healthy' | 'warning' | 'critical' | 'unknown' {
  if (controls.length === 0) return 'unknown';
  if (controls.some((c) => c.status === 'critical')) return 'critical';
  if (controls.some((c) => c.status === 'warning')) return 'warning';
  if (controls.some((c) => c.status === 'unknown')) return 'unknown';
  return 'healthy';
}
