import { NextResponse, type NextRequest } from 'next/server';
import { translateBatch } from '@/lib/i18n/translate';
import { isLocale } from '@/lib/i18n/locales';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Runtime translation endpoint (#14). The client auto-translate
 * provider posts the unique strings it needs rendered in the user's
 * locale; we return a { source: translated } map (served from the
 * ui_translations cache, machine-translating only the misses).
 *
 * Public (the sign page is unauthenticated) but rate-limited per IP,
 * and capped per request, so it can't be used to run up arbitrary
 * translation cost.
 */
export async function POST(req: NextRequest) {
  let body: { texts?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const locale = String(body.locale ?? '');
  if (!isLocale(locale)) {
    return NextResponse.json({ error: 'Unknown locale.' }, { status: 400 });
  }
  const texts = Array.isArray(body.texts)
    ? body.texts.filter((t): t is string => typeof t === 'string').slice(0, 200)
    : [];
  if (texts.length === 0) {
    return NextResponse.json({ map: {} });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'anon';
  const allowed = await checkRateLimit(`i18n:${ip}`, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many translation requests. Slow down a moment.' },
      { status: 429 },
    );
  }

  try {
    const map = await translateBatch(texts, locale);
    return NextResponse.json({ map });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Translation failed.' },
      { status: 502 },
    );
  }
}
