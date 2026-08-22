import { NextResponse, type NextRequest } from 'next/server';
import { streamBella, type BellaMessage } from '@/lib/bella';
import { getCase, listExhibits, getLatestReview } from '@/lib/storage';
import { isRealReview, isReviewStale } from '@/lib/composition';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// AI Opposing Counsel - a moot/practice cross-examination. Bella
// role-plays opposing counsel (and the judge) to pressure-test the
// litigant's answers before the real thing. Streams text; same
// transport contract as /api/bella.

const DIRECTIVE = [
  '=== ROLE-PLAY DIRECTIVE (highest priority) ===',
  'You are running a PRACTICE cross-examination so this self-',
  'represented litigant is ready for a real hearing. Stay in role:',
  '',
  'OPPOSING COUNSEL: ask ONE pointed, adversarial question at a',
  'time about THIS case - the kind the other side would actually',
  'ask. Probe weak spots, inconsistencies, missing evidence, and',
  'gaps between what they claim and what their exhibits prove.',
  '',
  'After each answer, break character briefly under a "COACH:" line',
  '(2-3 sentences): name one thing they did well, the single',
  'weakness an opponent would exploit, and a tighter way to say it.',
  'Then ask the next, slightly harder question as OPPOSING COUNSEL.',
  '',
  'Every ~4th turn, add a short "JUDGE:" interjection (a procedural',
  'or clarifying question a judge might pose).',
  '',
  'Hard rules: only use facts from the case context - never invent',
  'evidence, dates, parties, or rulings. This is practice, not a',
  'real proceeding, and not legal advice. Be tough but constructive',
  '- the goal is their confidence and clarity. Keep each turn',
  'short. Label speakers in CAPS (OPPOSING COUNSEL:, COACH:,',
  'JUDGE:). If asked to stop or to score, give a readiness score',
  '/100 with the top 3 strengths and top 3 things to fix.',
].join('\n');

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const allowed = await checkRateLimit(`opposing-counsel:${ip}`, {
    limit: 20,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Take a breath - too many rounds too fast.' },
      { status: 429 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage not configured.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to practice.' }, { status: 401 });
  }

  let body: { caseId?: string; messages?: BellaMessage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (!body.caseId) {
    return NextResponse.json({ error: 'Missing caseId.' }, { status: 400 });
  }

  const c = await getCase(body.caseId);
  if (!c) {
    return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  }
  const [exhibits, review] = await Promise.all([
    listExhibits(c.id),
    getLatestReview(c.id).catch(() => null),
  ]);

/**
 * The review is only handed to a model when it is real and still current.
 *
 * A demo placeholder reads like analysis, so a model given one treats its
 * invented findings as findings about this case. And the account of what
 * happened below is always the CURRENT text, so a review written against
 * wording the person has since replaced would put two different versions of
 * the same events in front of the model at once. Neither is worth the
 * paragraph it adds; the model has the account itself either way.
 *
 * Same rule, same reason, as isRealScan in lib/types.ts.
 */
  const usableReview =
    isRealReview(review) && !isReviewStale(review, c.descriptionHistory ?? [])
      ? review
      : null;

  const jurisdiction =
    [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
      .filter(Boolean)
      .join(', ') || 'not specified';
  const facts = [
    `Case: ${c.title}`,
    `Type: ${c.caseType} | Posture: ${c.posture} | Jurisdiction: ${jurisdiction}`,
    `Subject (${c.subjectType}): ${c.subjectName}`,
    c.description ? `Litigant's own account: ${c.description.slice(0, 900)}` : '',
    exhibits.length
      ? `Exhibits the litigant has:\n${exhibits
          .slice(0, 14)
          .map(
            (e) =>
              `- ${e.label} [${e.category || 'evidence'}]${
                e.description ? `: ${e.description}` : ''
              }`,
          )
          .join('\n')}`
      : 'Exhibits: none yet (a weakness to probe).',
    usableReview?.summary ? `Prior review summary: ${usableReview.summary.slice(0, 400)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const caseContext = `${DIRECTIVE}\n\n=== CASE FACTS ===\n${facts}`;

  const incoming = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
  const sanitized: BellaMessage[] = incoming
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 3000) : '',
    }))
    .filter((m) => m.content.length > 0);
  if (sanitized.length === 0) {
    sanitized.push({
      role: 'user',
      content:
        'Begin the practice cross-examination. Give one line of framing, then your first question as OPPOSING COUNSEL.',
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          messages: sanitized,
          caseContext,
          isPublic: false,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const m = err instanceof Error ? err.message : 'Sparring partner error.';
        controller.enqueue(encoder.encode(`\n\n_${m}_`));
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
