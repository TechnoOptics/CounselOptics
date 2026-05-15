/**
 * Shared crash-report noise filter.
 *
 * Three noise classes the HQ inbox should not surface by default:
 *
 *   1. "Script error." - the sanitized cross-origin script error a
 *      browser reports when a third-party script throws and CORS
 *      strips the stack. Not actionable.
 *   2. "__firefox__" - Firefox content-script injection from the
 *      browser's own internals or a user extension. Not our bug.
 *   3. "ResizeObserver loop limit exceeded" - a benign Chrome
 *      quirk where a ResizeObserver callback triggers another
 *      layout pass within the same frame. Not an actual crash.
 *
 * Audit W20 V3 CR-23: the HQ overview pill used to display the raw
 * `crashOpen` count (e.g. 49) while the crashes page filtered noise
 * and showed "Open (44) + 5 noise hidden." That mismatch left
 * operators asking "where did the 5 go?" Centralising the filter
 * here lets both surfaces compute the same default visible count.
 */

export const CRASH_NOISE_PATTERNS: readonly RegExp[] = [
  /^Script error\.?$/i,
  /__firefox__/,
  /ResizeObserver loop/i,
  // Safari iOS "Load failed" - fires from any cancelled image / fetch
  // when the user navigates away mid-load. Not actionable.
  /^Load failed$/i,
  // Browser/extension probes for legacy globals (e.g. window.__INITIAL_STATE__
  // from a content script, window.ethereum sniff from a wallet extension).
  // These surface as "undefined is not an object (evaluating 'window.XXX')"
  // and are noise relative to our app's own bugs.
  /undefined is not an object \(evaluating 'window\.[a-z_]+/i,
] as const;

export function isCrashNoise(message: string | null | undefined): boolean {
  const msg = message ?? '';
  return CRASH_NOISE_PATTERNS.some((re) => re.test(msg));
}
