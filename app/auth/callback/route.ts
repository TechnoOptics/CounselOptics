import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const oauthErrorDesc = url.searchParams.get('error_description');
  const nextParam = url.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/cases';

  if (oauthError) {
    const friendly =
      oauthErrorDesc?.replace(/\+/g, ' ') ||
      `Sign-in failed (${oauthError}). The provider may not be enabled in Supabase.`;
    return redirectWithError(request, next, friendly);
  }

  if (!code) {
    return redirectWithError(
      request,
      next,
      "Sign-in didn't complete - the OAuth provider returned no code. If you tried Google or Microsoft, that provider isn't enabled yet in Supabase. Use the email magic link below.",
    );
  }

  try {
    const supabase = createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectWithError(request, next, error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sign-in failed.';
    return redirectWithError(request, next, msg);
  }

  const dest = new URL(next, url.origin);
  return NextResponse.redirect(dest);
}

function redirectWithError(request: NextRequest, next: string, message: string) {
  const dest = new URL(request.url);
  dest.pathname = '/sign-in';
  dest.search = '';
  dest.searchParams.set('error', encodeURIComponent(message));
  dest.searchParams.set('next', next);
  return NextResponse.redirect(dest);
}
