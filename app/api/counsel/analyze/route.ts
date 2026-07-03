import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext, isFirmSubscriptionActive } from '@/lib/firm-storage';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 24_000;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const allowed = await checkRateLimit(`counsel-analyze:${user.id}`, {
    limit: 8,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'One analysis at a time - try again shortly.' },
      { status: 429 },
    );
  }
  const ctx = await getActiveFirmContext();
  if (ctx && !(await isFirmSubscriptionActive(ctx.firm))) {
    return NextResponse.json(
      { error: "This firm's subscription is inactive. Ask the firm owner to update billing." },
      { status: 402 },
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (text.length < 50) {
    return NextResponse.json(
      { error: 'Paste the full document so the analysis is meaningful.' },
      { status: 400 },
    );
  }
  const states =
    ctx?.firm.jurisdictions.join(', ') || 'the stated governing jurisdiction';

  const prompt = [
    'You are senior in-house counsel reviewing a document for the',
    'firm. Analyze it for the team. Be concrete and cite the clause',
    'or section you are referring to.',
    '',
    `Apply the law of the document's governing jurisdiction; if none`,
    `is stated, analyze under ${states} and say which you assumed and`,
    'note the country. Explain how it applies to THIS firm/party.',
    '',
    'Use these exact section headings in this order, plain text only:',
    '',
    'WHAT THIS DOCUMENT IS',
    '  One short paragraph in plain English.',
    '',
    'WHAT IT MEANS, CLAUSE BY CLAUSE',
    '  The material obligations, rights, money, term, termination,',
    '  liability, IP, confidentiality, dispute resolution - what each',
    '  actually does in practice.',
    '',
    'GOVERNING LAW AND HOW IT APPLIES',
    '  The governing law/state/country and how that law affects the',
    'key clauses for this firm specifically.',
    '',
    'BIAS RATING',
    '  State which party the document favors and a lean score from 0',
    'to 100 where 0 means it heavily favors our side and 100 means it',
    'heavily favors the counterparty (50 is balanced). Give the score',
    'as "Lean: NN/100 - favors <party>" then 2 to 4 sentences of why.',
    '',
    'HIDDEN CONSEQUENCES AND RED FLAGS',
    '  Clauses with non-obvious downside: auto-renewal, unilateral',
    '  changes, uncapped liability, indemnity, assignment, IP grabs,',
    '  exclusivity, fee-shifting, venue/arbitration traps. Explain the',
    '  real-world consequence of each.',
    '',
    'RECOMMENDED CHANGES',
    '  Specific redline-style edits, most important first, with the',
    '  reason and suggested replacement language where useful.',
    '',
    'Rules: never use an em-dash or en-dash; use commas or colons.',
    'No markdown, no emoji, no AI preamble or sign-off. This is',
    'analysis for licensed counsel, not advice to a consumer.',
    '',
    '--- DOCUMENT START ---',
    text.slice(0, MAX),
    '--- DOCUMENT END ---',
  ].join('\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          mode: 'authed',
          messages: [{ role: 'user', content: prompt }],
          firmContext: ctx
            ? {
                firmName: ctx.firm.name,
                jurisdictions: ctx.firm.jurisdictions,
                practiceAreas: ctx.firm.practiceAreas,
                role: ctx.membership.role,
              }
            : undefined,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `\n\n${err instanceof Error ? err.message : 'Analysis failed.'}`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
