import { NextResponse, type NextRequest } from 'next/server';
import { bellaGenerate } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext, isFirmSubscriptionActive } from '@/lib/firm-storage';
import { getTemplate, cleanLegalText } from '@/lib/legal-templates';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const allowed = await checkRateLimit(`counsel-draft-template:${user.id}`, {
    limit: 6,
    windowSeconds: 60,
  });
  if (!allowed) {
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
  if (!(await isFirmSubscriptionActive(ctx.firm))) {
    return NextResponse.json(
      { error: "This firm's subscription is inactive. Ask the firm owner to update billing." },
      { status: 402 },
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

  const system = [
    `You are senior in-house counsel at "${ctx.firm.name}", drafting`,
    'the firm\'s own work product. Output ONLY the complete document',
    'text: a Title, recitals, defined terms, numbered Sections, and a',
    'signature block. No preface, no commentary, no questions, no',
    'closing remarks. Never use an em-dash or en-dash (use commas,',
    'colons, or separate sentences). No markdown, no asterisks, no',
    'emoji, no "as an AI" phrasing. Formal, professional legal',
    'English. Do not call any tools or save anything - just write the',
    'document in full.',
  ].join('\n');

  let raw = '';
  try {
    raw = await bellaGenerate({ system, prompt, maxTokens: 6000 });
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
    letterheadUrl: ctx.firm.letterheadUrl ?? null,
    accent: ctx.firm.accentColor,
    generatedAt: new Date().toISOString(),
  });
}
