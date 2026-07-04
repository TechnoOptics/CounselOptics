import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The War Room and the Action Center had the same job, so they're now
 * one surface under the Action Center name. This route is kept only so
 * old links, bookmarks, and the sitemap don't 404 - it forwards to the
 * consolidated cockpit.
 */
export default function WarRoomRedirect() {
  redirect('/action-center');
}
