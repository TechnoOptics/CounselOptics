import { NextResponse, type NextRequest } from 'next/server';
import { claimMarkHandoff, MARK_HANDOFF_COOKIE } from '@/lib/mark-handoff-queries';
import { HANDOFF_SESSION_MINUTES } from '@/lib/signing-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /sign/mark/[handoff] - the URL inside the employee's QR code.
 *
 * Under /sign and NOT under /portal, deliberately. The Hub shell redirects
 * anyone without a session, and this phone has none and must never be given
 * one: the code is a way to hand back a picture, not a way to move the
 * employee's session onto another device.
 *
 * A route handler rather than a page for the same reason
 * app/sign/m/[handoff]/route.ts is one: the first GET has to consume the token
 * and set a cookie, and Next 14 only permits a cookie write from a route
 * handler or a server action. So the token is burned by the first HTTP request
 * that carries it, with no dependence on the phone running any JavaScript, and
 * the pad is the page one segment down.
 *
 * A failed claim is not reported here. It redirects exactly like a successful
 * one, so a bound phone refreshing this URL (whose claim always fails, the row
 * being already consumed) lands on its own pad rather than an error, and a
 * stranger sees only what the pad page shows.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { handoff: string } },
) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') ?? null;

  const claimed = await claimMarkHandoff(params.handoff, ip, userAgent);

  const pad = new URL(
    `/sign/mark/${encodeURIComponent(params.handoff)}/pad`,
    req.url,
  );
  // 303, so a browser that arrived by any method continues with a GET.
  const res = NextResponse.redirect(pad, 303);

  if (claimed.ok) {
    res.cookies.set({
      name: MARK_HANDOFF_COOKIE,
      value: claimed.sessionSecret,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      // Site-wide, because the pad page and the submit route sit under
      // different paths and both have to prove this phone is the holder.
      path: '/',
      // The cookie cannot outlive the window it unlocks. The row's own
      // deadlines are still the authority; this only stops a dead secret from
      // sitting on the phone afterwards.
      maxAge: HANDOFF_SESSION_MINUTES * 60,
    });
  }

  return res;
}
