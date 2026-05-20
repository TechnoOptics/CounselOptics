import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calendar · Counsel' };

/**
 * /counsel/meetings used to be the OAuth integration setup surface
 * (connect Microsoft 365 + Zoom). It was merged into /counsel/calendar
 * in W20 so a firm sees one calendar surface instead of two. This
 * route is kept as a thin redirect so:
 *   - bookmarks, docs, and inbound emails still resolve
 *   - the OAuth callback (which still redirects to ?connected=...)
 *     forwards the toast querystring to the calendar page
 *
 * We could update the callback to send users straight to
 * /counsel/calendar, but keeping this shim removes the requirement
 * to also retouch every external link / email / doc that mentions
 * /counsel/meetings, and is one cheap server-side 307 either way.
 */
export default function MeetingsRedirectPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (typeof v === 'string') {
        qs.set(k, v);
      } else if (Array.isArray(v) && v[0]) {
        qs.set(k, v[0]);
      }
    }
  }
  const target = qs.toString()
    ? `/counsel/calendar?${qs.toString()}`
    : '/counsel/calendar';
  redirect(target);
}
