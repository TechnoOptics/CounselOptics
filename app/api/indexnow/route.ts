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
 * GET is the Vercel cron entry point, wired in vercel.json. Vercel
 * cron only ever issues a GET, so POST alone meant the cron could not
 * have called this route even if someone had added it; between that
 * and the missing vercel.json entry, IndexNow had never submitted a
 * single URL since it was built. GET carries no body and always pings
 * the cornerstone set.
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
  // Round-8 Spanish-language content set
  `${SITE_URL}/es`,
  `${SITE_URL}/es/que-es-advottic`,
  `${SITE_URL}/es/guias`,
  `${SITE_URL}/es/guias/mi-arrendador-me-esta-desalojando`,
  `${SITE_URL}/es/guias/ayuda-violencia-domestica`,
  `${SITE_URL}/es/plantillas`,
  `${SITE_URL}/es/plantillas/carta-de-demanda`,
  // Round-9: remaining Spanish guides + templates
  `${SITE_URL}/es/guias/me-demandaron-que-hago`,
  `${SITE_URL}/es/guias/cuanto-tiempo-tengo-para-demandar`,
  `${SITE_URL}/es/guias/me-demandan-por-deuda-de-tarjeta-de-credito`,
  `${SITE_URL}/es/plantillas/acuerdo-de-confidencialidad`,
  `${SITE_URL}/es/plantillas/carta-de-cese-y-desista`,
  `${SITE_URL}/es/plantillas/aviso-de-terminacion-de-arrendamiento`,
  `${SITE_URL}/es/plantillas/demanda-de-deposito-de-seguridad`,
];

/**
 * GET /api/indexnow - Vercel cron only.
 *
 * Same protection as the other four crons in vercel.json (see
 * app/api/cron/health/route.ts): fail closed with 503 when CRON_SECRET
 * is unset, so a misconfigured environment can never leave an outbound
 * ping endpoint open, then require `Authorization: Bearer <secret>`,
 * which Vercel attaches to every cron invocation. CRON_SECRET is set in
 * production.
 *
 * Deliberately does NOT accept INDEXNOW_TRIGGER_TOKEN: that token is
 * for the manual POST path, and a token in a query string ends up in
 * access logs. The cron uses a header.
 *
 * Schedule: weekly, Mondays 06:00 UTC (`0 6 * * 1` in vercel.json).
 * IndexNow is a "this URL changed" signal and CORNERSTONES is a
 * marketing surface that changes on the order of weeks, so a daily
 * ping would submit the same unchanged 75 URLs seven times a week.
 * That is the pattern IndexNow's own guidance calls out as abuse, and
 * it earns nothing: the fast path for a page that actually changed is
 * the manual POST, which a deploy or an editor can fire with the
 * exact URL. Weekly is the floor that keeps the pipeline alive and
 * proves it still works.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return new NextResponse('Server misconfigured: CRON_SECRET is not set', {
      status: 503,
    });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const urls = [...CORNERSTONES];
  const results = await pingIndexNow(urls);
  return NextResponse.json({ ok: true, urls_pinged: urls.length, results });
}

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
