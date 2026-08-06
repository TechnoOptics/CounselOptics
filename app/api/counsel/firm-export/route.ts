import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The old organization-export path, kept as a redirect to /api/firm/export.
 *
 * There is one organization export and it lives at /api/firm/export: owner and
 * admin only through lib/firm-authz.ts, audited on every call, paged so a
 * large organization gets all of its rows rather than the first thousand, and
 * exempt from the access gate so an export_only organization can still take
 * its copy. Leaving this path serving its own second implementation would mean
 * the archive most organizations actually download was the unaudited one, so
 * the guarantees would be true only of a route nobody used.
 *
 * A 308 keeps the method and every existing link and bookmark working. The
 * query string comes along: /api/firm/export takes an optional ?firmId=, and
 * building the target from a path alone would quietly drop it and export the
 * caller's active organization instead of the one they asked for.
 */
export function GET(req: Request) {
  const target = new URL('/api/firm/export', req.url);
  target.search = new URL(req.url).search;
  return NextResponse.redirect(target, 308);
}
