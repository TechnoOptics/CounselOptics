import { createAdminSupabase } from './supabase/admin';

/**
 * Cross-instance rate limit, backed by the `rate_limits` table and the
 * `check_rate_limit()` SQL function (atomic increment within a sliding
 * window). Replaces the old per-instance in-memory maps, which never
 * actually capped a determined caller on serverless.
 *
 * Fails OPEN: if the store is unreachable we allow the request rather
 * than break a user-facing AI feature. Abuse protection should never
 * turn a database hiccup into an outage.
 *
 * @param key   stable identifier for the bucket, e.g. `bella:<ip>`
 * @param opts  limit = max requests per window; windowSeconds = window
 * @returns true if the request is allowed, false if it should be 429'd
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const admin = createAdminSupabase();
  if (!admin) return true; // no store configured → allow
  try {
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_limit: opts.limit,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) {
      console.warn('[rate-limit] store error, allowing request:', error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.warn('[rate-limit] threw, allowing request:', e);
    return true;
  }
}
