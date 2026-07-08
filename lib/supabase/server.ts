import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { cookieDomainForHost } from './cookie-domain';

export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function createServerSupabase() {
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    );
  }
  const cookieStore = cookies();
  // Read the request host so cookie writes can promote Domain to
  // .advottic.com, sharing the auth session across hq./enterprise./www.
  const host = headers().get('host');
  const domain = cookieDomainForHost(host);
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({
              name,
              value,
              ...options,
              ...(domain ? { domain } : {}),
            });
          });
        } catch {
          // setAll runs during a Server Component render where cookies are
          // read-only; the middleware's session-refresh writes the cookies
          // for us, so swallowing here is safe.
        }
      },
    },
  });
}

/**
 * Result of a session read that keeps "no session" distinct from
 * "the read threw".
 *
 *  - `{ user: User | null }` - the read SUCCEEDED. `user` is the
 *    authenticated user, or `null` when the visitor is genuinely
 *    signed out (no/expired session). This is a definitive answer.
 *  - `{ error }` - the read THREW (corrupted cookie, Edge decode
 *    failure, transient Supabase/network hiccup). We do NOT know
 *    whether the visitor is signed in; callers must NOT treat this
 *    as a logout.
 *
 * Distinguishing the two matters because a transient read failure -
 * common during a Vercel deploy window when a client holds a stale
 * RSC/JS bundle - is otherwise indistinguishable from a real
 * sign-out, and evicting the user to /sign-in on a hiccup is the
 * "crashed the app and signed me out" symptom firms report.
 */
export type CurrentUserResult = { user: User | null } | { error: unknown };

/**
 * Reads the current session, preserving the success/error distinction.
 *
 * Prefer this over getCurrentUser() at auth chokepoints (route/layout
 * gates) where the caller decides between redirecting a genuinely
 * signed-out visitor and softly retrying a transient failure. When a
 * plain null-or-user is enough, getCurrentUser() remains fine.
 */
export async function getCurrentUserResult(): Promise<CurrentUserResult> {
  // Not configured is a definitive "no session", not an error: there
  // is no auth on this deployment, so the visitor is signed out.
  if (!isSupabaseConfigured()) return { user: null };
  try {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return { user };
  } catch (err) {
    // Surface the message to runtime logs without re-throwing.
    // eslint-disable-next-line no-console
    console.warn(
      '[server-supabase] session read threw; NOT treating as signed-out:',
      err instanceof Error ? err.message : err,
    );
    return { error: err };
  }
}

/** Returns the current authenticated user or null.
 *
 * Defensive try/catch: if Supabase's session-recovery throws (e.g.
 * `Invalid UTF-8 sequence` from a corrupted cookie or a malformed
 * refresh token), we treat the visitor as signed-out and let the
 * page render rather than 500'ing the whole route. The middleware
 * already does this; we now mirror it here so every server
 * component that calls getCurrentUser() is equally resilient.
 *
 * Without this guard, an Edge-runtime decode failure inside
 * `_recoverAndRefresh` cascades through every server component
 * that reads the user, producing a site-wide "Application error:
 * a server-side exception has occurred" page. May 2026 incident.
 *
 * NOTE: this collapses a thrown read to `null` (signed-out) for the
 * many callers that only need best-effort user resolution. Auth
 * chokepoints that must NOT sign a user out on a transient hiccup
 * should call getCurrentUserResult() and branch on the error case.
 */
export async function getCurrentUser() {
  const result = await getCurrentUserResult();
  return 'error' in result ? null : result.user;
}

/** Like getCurrentUser, but throws if no user - for server actions and protected routes. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Not signed in.');
  }
  return user;
}

/**
 * Returns true when the current authenticated user has profiles.is_admin = true.
 * Returns false in any other case (no user, no Supabase, or query failure).
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return false;
  return Boolean((data as { is_admin: boolean | null }).is_admin);
}
