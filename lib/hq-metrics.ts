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
 * How many runs a probe has failed in a row, counting back from the
 * newest. `history` is newest first.
 *
 * The health page showed the latest run and a 24-hour pass rate. On a
 * once-a-day cron those two readouts cannot tell a probe that blipped
 * once from a probe that has been down for a month: both paint one rose
 * tile. The bella probe failed 25 of the 30 daily runs to 2026-08-06 on
 * the same unpaid-credit error and nothing on the page said so.
 *
 * `skipped` is not a measurement. An unconfigured probe neither adds to
 * the streak nor clears it, the same way summarizeProbeUptime leaves
 * skipped out of the denominator instead of scoring it as down.
 */
export function consecutiveFailures(history: ReadonlyArray<string>): number {
  let streak = 0;
  for (const status of history) {
    if (status === 'fail') streak += 1;
    else if (status !== 'skipped') break;
  }
  return streak;
}

/**
 * Minimum gap between two health digest emails.
 *
 * This has to stay shorter than the cron period, and that is the whole
 * point of the constant. The throttle was a full 24 hours measured from
 * the previous send, against a cron that fires once every 24 hours, so
 * whether the operator heard about a failure came down to whether today's
 * run landed later in the minute than yesterday's send. Vercel jitters the
 * 07:00 trigger by up to about 90 seconds, so roughly half the time it did
 * not. Production to 2026-08-06: every suppressed run sat between 86302
 * and 86400 seconds after the previous send, never more, and the
 * suppressions fell on alternating days.
 *
 * Twelve hours leaves the daily digest an enormous margin while still
 * collapsing a burst: a Vercel retry, or someone hitting the endpoint by
 * hand after reading the page, does not mail a second copy.
 */
export const HEALTH_DIGEST_MIN_GAP_MS = 12 * 60 * 60 * 1000;

export type HealthDigestDecision = 'send' | 'throttled' | 'nothing-to-report';

/**
 * Whether a health-check run should mail its digest, and if not, why not.
 *
 * The reason is returned rather than a bare boolean so the cron response
 * can say which of the two silences this was. "Throttled" and "nothing to
 * report" look identical from outside the process, and telling them apart
 * from the outside is what cost a month of unnoticed probe failures.
 */
export function healthDigestDecision(input: {
  hasFailures: boolean;
  unacknowledgedCrashes: number;
  /** ISO timestamp of the most recent digest, or null if none was ever sent. */
  lastEmailSentAt: string | null;
  now: number;
}): HealthDigestDecision {
  if (!input.hasFailures && input.unacknowledgedCrashes === 0) {
    return 'nothing-to-report';
  }
  if (input.lastEmailSentAt === null) return 'send';
  const last = Date.parse(input.lastEmailSentAt);
  // An unreadable timestamp must not be able to mute the alert channel.
  if (Number.isNaN(last)) return 'send';
  return input.now - last >= HEALTH_DIGEST_MIN_GAP_MS ? 'send' : 'throttled';
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
