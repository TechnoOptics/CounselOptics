import { createAdminSupabase } from './supabase/admin';

/**
 * Cross-instance rate limit, backed by the `rate_limits` table and the
 * `check_rate_limit()` SQL function (atomic increment within a sliding
 * window). Replaces the old per-instance in-memory maps, which never
 * actually capped a determined caller on serverless.
 *
 * Fail mode is per-bucket:
 *
 *  - Default (`failClosed` unset): fails OPEN. If the store is
 *    unreachable we allow the request rather than break a user-facing
 *    AI feature. A database hiccup should not become an outage.
 *  - Security buckets (`failClosed: true`): fail CLOSED on a store
 *    error. These are the brute-force / abuse surfaces (signing access
 *    codes, the reviewer login) where an attacker who can induce DB
 *    errors must NOT be handed an uncapped bypass. We still allow when
 *    the store is simply *not configured* (no service-role key, i.e.
 *    local dev), since that's a deploy-config state, not an attack, and
 *    failing closed there would break every dev sign-in.
 *
 * @param key   stable identifier for the bucket, e.g. `bella:<ip>`
 * @param opts  limit = max requests per window; windowSeconds = window;
 *              failClosed = deny on store error (security buckets)
 * @returns true if the request is allowed, false if it should be 429'd
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number; failClosed?: boolean },
): Promise<boolean> {
  const admin = createAdminSupabase();
  if (!admin) return true; // not configured (dev) → allow either way
  try {
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_limit: opts.limit,
      p_window_seconds: opts.windowSeconds,
    });
    if (error) {
      console.warn(
        `[rate-limit] store error on "${key}", ${opts.failClosed ? 'DENYING' : 'allowing'}:`,
        error.message,
      );
      return opts.failClosed ? false : true;
    }
    return data !== false;
  } catch (e) {
    console.warn(
      `[rate-limit] threw on "${key}", ${opts.failClosed ? 'DENYING' : 'allowing'}:`,
      e,
    );
    return opts.failClosed ? false : true;
  }
}
