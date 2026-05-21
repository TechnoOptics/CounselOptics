import { createServerClient } from '@supabase/ssr';
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
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    // Surface the message to runtime logs without re-throwing.
    // eslint-disable-next-line no-console
    console.warn(
      '[server-supabase] getCurrentUser failed; treating as signed-out:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
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
