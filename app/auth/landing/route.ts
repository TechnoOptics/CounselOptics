import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { isDefaultConsumerLanding, resolveDefaultLanding } from '@/lib/landing';
import { sanitizeNext } from '@/lib/sign-in-next';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Resolve where an already-signed-in visitor to /sign-in belongs, and send
 * them there with a real HTTP redirect.
 *
 * app/sign-in/page.tsx has always made this decision, but it makes it inside
 * a React server component that Next renders behind the Suspense boundary
 * app/loading.tsx creates. By the time `redirect()` throws, the streamed
 * shell has already been flushed, so Next can no longer answer with a 307:
 * it answers 200 with HTML containing an aborted boundary
 * (`<!--$!--><template data-dgst="NEXT_REDIRECT;...">`), and the browser
 * throws React #419 while hydrating it. That is the crash logged against
 * /sign-in, /sign-in?timeout=1 and /sign-in?next=%2Fcounsel%2Fsettings.
 *
 * A route handler renders no React at all, so the redirect stays a redirect.
 * The landing logic itself is unchanged - same sanitiser, same
 * resolveDefaultLanding(), so firm owners still land in /counsel and
 * co-counsel guests still land on their matter.
 */
export async function GET(request: NextRequest) {
  const next = sanitizeNext(request.nextUrl.searchParams.get('next') ?? undefined);

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    // Only reachable if the session evaporated between the middleware check
    // and this request. `from=landing` tells the middleware not to bounce
    // back here, so a cookie race can never become a redirect loop.
    const back = new URL('/sign-in', request.url);
    back.searchParams.set('next', next);
    back.searchParams.set('from', 'landing');
    return NextResponse.redirect(back);
  }

  const target = isDefaultConsumerLanding(next)
    ? await resolveDefaultLanding()
    : next;
  return NextResponse.redirect(new URL(target, request.url));
}
