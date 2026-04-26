import { NextResponse, type NextRequest } from 'next/server';
import { streamBella, type BellaMessage } from '@/lib/bella';
import { getCase, listExhibits, getLatestReview } from '@/lib/storage';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Very simple in-memory rate limit per IP. Survives the lifetime of the
// serverless function instance, which is good enough as a basic guard.
const RATE: Map<string, { count: number; reset: number }> = new Map();
const RATE_LIMIT = 30; // requests
const WINDOW_MS = 60_000; // per minute

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = RATE.get(ip);
  if (!entry || entry.reset < now) {
    RATE.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const ip = ipFrom(req);
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Slow down - too many messages.' }, { status: 429 });
  }

  // Bella is available to logged-out visitors as a brand ambassador, but in
  // a strictly capped "public" mode: she can answer questions about what
  // the app does, pricing, and general legal information, but never reads
  // case content (no caseId), never runs any subscription-only feature on
  // the user's behalf, and is rate-limited the same way an authed user is.
  let isPublic = false;
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) {
      isPublic = true;
    }
  }

  let payload: { messages?: BellaMessage[]; caseId?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-20) : [];
  if (messages.length === 0 || !messages.some((m) => m.role === 'user')) {
    return NextResponse.json({ error: 'No user message provided.' }, { status: 400 });
  }

  // Sanitize messages
  const sanitized: BellaMessage[] = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 4000) : '',
    }))
    .filter((m) => m.content.length > 0);

  let caseContext: string | null = null;
  // Public-mode visitors don't get case context lookups - they can't have
  // any case attached to them.
  if (payload.caseId && !isPublic) {
    try {
      const c = await getCase(payload.caseId);
      if (c) {
        const [exhibits, review] = await Promise.all([
          listExhibits(c.id),
          getLatestReview(c.id),
        ]);
        const lines: string[] = [];
        lines.push(`Case title: ${c.title}`);
        lines.push(`Subject (${c.subjectType}): ${c.subjectName}`);
        lines.push(`Case type: ${c.caseType}`);
        lines.push(
          `Jurisdiction: ${[c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country].filter(Boolean).join(', ') || 'not specified'}`,
        );
        lines.push(`Posture: ${c.posture}`);
        if (c.description) lines.push(`Description: ${c.description.slice(0, 500)}`);
        if (exhibits.length) {
          lines.push(`Exhibits (${exhibits.length}):`);
          for (const e of exhibits.slice(0, 10)) {
            lines.push(`- ${e.label}: ${e.fileName}${e.description ? ' - ' + e.description : ''}`);
          }
        }
        if (review) {
          lines.push(`Latest review summary: ${review.summary.slice(0, 400)}`);
          lines.push(`Classification: ${review.classification.slice(0, 200)}`);
        }
        caseContext = lines.join('\n');
      }
    } catch {
      caseContext = null;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({ messages: sanitized, caseContext, isPublic })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bella ran into an error.';
        controller.enqueue(encoder.encode(`\n\n_${message}_`));
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
