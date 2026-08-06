import { NextResponse, type NextRequest } from 'next/server';
import { claimHandoff, HANDOFF_COOKIE } from '@/lib/signing-handoff-queries';
import { HANDOFF_SESSION_MINUTES } from '@/lib/signing-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /sign/m/[handoff] - the URL inside the QR code.
 *
 * This is a route handler rather than a page because the first GET has
 * to do two things a React server component cannot: consume the token
 * and set a cookie on the response. Next 14 only permits a cookie write
 * from a route handler or a server action, so the arrival is handled
 * here and the pad itself is the page one segment down. The token is
 * therefore burned by the first HTTP request that carries it, with no
 * dependence on the phone running any JavaScript.
 *
 * Consume, then bind. claimHandoff stamps consumed_at with a conditional
 * update, records the scanning phone's IP and user agent for the dispute
 * record, and returns a fresh secret whose hash is stored on the row.
 * That secret goes back as an httpOnly cookie, so the same phone may
 * refresh, recover from a dropped connection or come back from a
 * backgrounded browser, while a different device presenting the same URL
 * is a stranger and is refused.
 *
 * A failed claim is NOT reported here. It redirects exactly like a
 * successful one and the pad page reads the row again and renders the
 * refusal, so a bound phone refreshing this URL (whose claim always
 * fails, the row being already consumed) lands on its own pad rather
 * than on an error, and a stranger sees only what the pad page shows.
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

  const claimed = await claimHandoff(params.handoff, ip, userAgent);

  const pad = new URL(`/sign/m/${encodeURIComponent(params.handoff)}/pad`, req.url);
  // 303, so a browser that arrived by any method continues with a GET.
  const res = NextResponse.redirect(pad, 303);

  if (claimed.ok) {
    res.cookies.set({
      name: HANDOFF_COOKIE,
      value: claimed.sessionSecret,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      // Site-wide, because the pad page and the submit route sit under
      // different paths and both have to prove this phone is the holder.
      path: '/',
      // The cookie cannot outlive the window it unlocks. The row's own
      // deadlines are still the authority; this only stops a dead secret
      // from sitting on the phone afterwards.
      maxAge: HANDOFF_SESSION_MINUTES * 60,
    });
  }

  return res;
}
