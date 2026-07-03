import { NextResponse, type NextRequest } from 'next/server';
import { pingIndexNow } from '@/lib/indexnow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/indexnow
 *
 * Manual + cron-driven trigger for IndexNow. Fires the canonical
 * cornerstone URLs at Bing/Yandex/Seznam so the brand pages get
 * re-crawled within minutes instead of weeks.
 *
 * Auth: query string `?token=<INDEXNOW_TRIGGER_TOKEN>` matched
 * against the env var of the same name. We don't want any random
 * caller to be able to spam our IndexNow quota.
 *
 * Body (optional JSON): { urls?: string[] }. If omitted we ping the
 * standard cornerstone set (home, what-is-advottic, pricing, about,
 * llms.txt, llms-full.txt, sitemap.xml).
 *
 * Wire it to a daily Vercel cron (vercel.json) once the route is
 * shipped; until then any GitHub Action or local curl that knows the
 * token can trigger a manual re-index.
 */
const SITE_URL = 'https://advottic.com';

const CORNERSTONES: ReadonlyArray<string> = [
  `${SITE_URL}/`,
  `${SITE_URL}/what-is-advottic`,
  `${SITE_URL}/pricing`,
  `${SITE_URL}/about`,
  `${SITE_URL}/security`,
  `${SITE_URL}/enterprise`,
  `${SITE_URL}/find-counsel`,
  `${SITE_URL}/review-my-document`,
  `${SITE_URL}/public-defender`,
  `${SITE_URL}/safe`,
  `${SITE_URL}/gift`,
  `${SITE_URL}/llms.txt`,
  `${SITE_URL}/llms-full.txt`,
  `${SITE_URL}/sitemap.xml`,
  // Round-2 brand pages. Re-pinging these on each manual trigger
  // keeps the freshness signal high without changing the trigger
  // protocol.
  `${SITE_URL}/glossary`,
  `${SITE_URL}/glossary/bella`,
  `${SITE_URL}/glossary/safe-witness`,
  `${SITE_URL}/glossary/advottic-counsel`,
  `${SITE_URL}/glossary/advottic-review`,
  `${SITE_URL}/glossary/techno-optics`,
  `${SITE_URL}/changelog`,
  `${SITE_URL}/feed.xml`,
  `${SITE_URL}/atom.xml`,
  `${SITE_URL}/sitemap-images.xml`,
  // Round-3 brand entities
  `${SITE_URL}/glossary/action-center`,
  `${SITE_URL}/glossary/decoder`,
  `${SITE_URL}/glossary/war-room`,
  `${SITE_URL}/glossary/deadline-radar`,
  `${SITE_URL}/glossary/advottic-aid`,
  `${SITE_URL}/glossary/iolta`,
  // Round-4 high-intent guides
  `${SITE_URL}/guides`,
  `${SITE_URL}/guides/i-was-served-with-a-lawsuit`,
  `${SITE_URL}/guides/how-long-do-i-have-to-sue`,
  `${SITE_URL}/guides/my-landlord-is-evicting-me`,
  `${SITE_URL}/guides/im-being-sued-for-credit-card-debt`,
  `${SITE_URL}/guides/i-need-help-domestic-violence`,
  // Round-5 templates library
  `${SITE_URL}/templates`,
  `${SITE_URL}/templates/demand-letter`,
  `${SITE_URL}/templates/nda`,
  `${SITE_URL}/templates/cease-and-desist`,
  `${SITE_URL}/templates/lease-termination-notice`,
  `${SITE_URL}/templates/security-deposit-demand`,
  // Round-5 interactive tool + press release
  `${SITE_URL}/tools`,
  `${SITE_URL}/tools/statute-of-limitations`,
  `${SITE_URL}/tools/court-deadline-calculator`,
  `${SITE_URL}/tools/security-deposit-deduction-checker`,
  `${SITE_URL}/press/2026-06-08-templates-open-source`,
  // Round-6 compounders: embed, data catalog, founder
  `${SITE_URL}/tools/statute-of-limitations/embed`,
  `${SITE_URL}/open-data`,
  `${SITE_URL}/open-data/statute-of-limitations.json`,
  `${SITE_URL}/open-data/templates.json`,
  `${SITE_URL}/people/abel-muchai`,
  // New consumer-side comparison pages (highest commercial intent SERPs)
  `${SITE_URL}/compare/legalzoom`,
  `${SITE_URL}/compare/rocket-lawyer`,
  // Round-7 national comparison asset + open dataset
  `${SITE_URL}/resources/small-claims-rankings`,
  `${SITE_URL}/open-data/small-claims.json`,
  `${SITE_URL}/press/2026-07-03-small-claims-rankings`,
];

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const expected = process.env.INDEXNOW_TRIGGER_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: 'INDEXNOW_TRIGGER_TOKEN not configured.' },
      { status: 503 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  let body: { urls?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const urls =
    Array.isArray(body.urls) && body.urls.length > 0
      ? body.urls.filter((u) => typeof u === 'string')
      : [...CORNERSTONES];
  const results = await pingIndexNow(urls);
  return NextResponse.json({ ok: true, urls_pinged: urls.length, results });
}
