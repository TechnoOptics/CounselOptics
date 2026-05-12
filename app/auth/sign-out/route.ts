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
  // Optional `next` form field lets the caller route post-sign-out to
  // a specific page. Used by the /sign-in?switch=1 "use a different
  // account" button so the chooser stays open across the sign-out.
  // Validation is strict: same-origin path only, no protocol-relative
  // URLs, no absolute URLs - same-origin redirects defeat open-redirect
  // abuse if someone posts a forged form.
  let nextPath = '/';
  try {
    const form = await request.formData();
    const raw = form.get('next');
    if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) {
      nextPath = raw;
    }
  } catch {
    // Body might be empty or non-form; fall through to default '/'.
  }
  const dest = new URL(request.url);
  dest.pathname = nextPath.split('?')[0] ?? '/';
  dest.search = nextPath.includes('?')
    ? '?' + nextPath.split('?').slice(1).join('?')
    : '';
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
