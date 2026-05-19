import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getTemplate, cleanLegalText } from '@/lib/legal-templates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE = new Map<string, { n: number; t: number }>();
function limited(k: string): boolean {
  const now = Date.now();
  const e = RATE.get(k);
  if (!e || e.t < now) {
    RATE.set(k, { n: 1, t: now + 60_000 });
    return false;
  }
  e.n += 1;
  return e.n > 6;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  if (limited(user.id)) {
    return NextResponse.json(
      { error: 'One document at a time - try again in a moment.' },
      { status: 429 },
    );
  }
  const ctx = await getActiveFirmContext();
  if (!ctx) {
    return NextResponse.json(
      { error: 'No active firm.' },
      { status: 403 },
    );
  }

  let body: { templateId?: string; params?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const tpl = getTemplate(String(body.templateId ?? ''));
  if (!tpl) {
    return NextResponse.json({ error: 'Unknown template.' }, { status: 400 });
  }
  const params = body.params ?? {};
  const brandName =
    String(
      (ctx.firm.metadata as Record<string, unknown> | null)?.brandName ??
        '',
    ).trim() || ctx.firm.name;

  const given = Object.entries(params)
    .map(([k, v]) => `- ${k}: ${String(v).slice(0, 1500)}`)
    .filter((l) => l.split(': ')[1]?.trim())
    .join('\n');

  const prompt = [
    `You are senior in-house counsel at "${ctx.firm.name}". Draft a`,
    `complete, ready-to-review ${tpl.name} as the firm's own work`,
    `product. This is organizational drafting support, not legal`,
    `advice to a consumer.`,
    '',
    `Governing law / jurisdiction context: ${
      params.jurisdiction ||
      ctx.firm.jurisdictions.join(', ') ||
      'use a sensible US default and state the assumption in a recital'
    }.`,
    ctx.firm.jurisdictions.length
      ? `The firm operates in: ${ctx.firm.jurisdictions.join(', ')}.`
      : '',
    '',
    'Provided details:',
    given || '(none beyond the parties; use clear defined placeholders only where a real value is genuinely unknown, e.g. "[Effective Date]")',
    '',
    'HARD REQUIREMENTS for the output:',
    '1. Output ONLY the document body. No preface, no greeting, no',
    '   closing remarks, no explanation of what you did.',
    '2. Never use an em-dash or en-dash. Use commas, colons, or',
    '   separate sentences. Never use markdown (** ## ` >), bullets',
    '   with asterisks, or emoji. Use a clean numbered/sectioned',
    '   legal structure with a Title, recitals, defined terms,',
    '   numbered Sections, and a signature block.',
    '3. Use the real party names provided. Do not invent facts.',
    '4. Plain, formal, professional legal English. No AI phrasing,',
    '   no "as an AI", no hedging boilerplate about being a model.',
    '5. End with a signature block (lines for each party: name,',
    '   title, signature, date).',
  ]
    .filter(Boolean)
    .join('\n');

  let raw = '';
  try {
    for await (const chunk of streamBella({
      mode: 'authed',
      messages: [{ role: 'user', content: prompt }],
      firmContext: {
        firmName: ctx.firm.name,
        jurisdictions: ctx.firm.jurisdictions,
        practiceAreas: ctx.firm.practiceAreas,
        role: ctx.membership.role,
      },
    })) {
      raw += chunk;
      if (raw.length > 24_000) break;
    }
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Could not draft the document.',
      },
      { status: 502 },
    );
  }

  const document = cleanLegalText(raw);
  if (document.length < 200) {
    return NextResponse.json(
      { error: 'The draft came back too short - try again with more detail.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    document,
    title: tpl.name,
    brandName,
    firmName: ctx.firm.name,
    logoUrl: ctx.firm.logoUrl ?? null,
    accent: ctx.firm.accentColor,
    generatedAt: new Date().toISOString(),
  });
}
