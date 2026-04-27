import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Sign-out endpoint.
 *
 * Binds the supabase cookie adapter directly to the outgoing redirect
 * NextResponse so the auth-cookie clears (chunked sb-…-auth-token.0,
 * .1, .2…) actually ride along on the 303. Earlier we used the
 * default `cookies()` adapter on a separately-constructed redirect,
 * which was the same pattern that originally stranded sign-IN cookies
 * - the symmetric write path strands the sign-OUT clears, so the
 * browser keeps a half-valid session after delete-account.
 */
export async function POST(request: NextRequest) {
  const dest = new URL(request.url);
  dest.pathname = '/';
  dest.search = '';
  const response = NextResponse.redirect(dest, { status: 303 });

  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    try {
      await supabase.auth.signOut();
    } catch {
      // signOut throws if the user has already been deleted server-side
      // (e.g. /api/account/delete just ran). Either way we still want
      // to clear the cookies, so swallow the error.
    }
  }

  return response;
}
