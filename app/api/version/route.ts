import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

/**
 * Returns the current production build's git SHA. The client polls
 * this every ~90 seconds and shows a "New version" toast if the SHA
 * differs from the one it loaded with - lets users on the installed
 * PWA notice fresh deploys without a full app reinstall.
 *
 * No-cache headers are critical: a CDN-cached response would defeat
 * the whole point.
 */
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev';
  return NextResponse.json(
    { sha, ts: Date.now() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
