import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Decoder - paste any court notice / legal document and get a calm,
// plain-English explanation: what it is, what it means for you, what
// you must DO, and the exact deadlines. Streams text; same transport
// contract as /api/bella.

const RATE = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const e = RATE.get(ip);
  if (!e || e.reset < now) {
    RATE.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  e.count += 1;
  return e.count <= 12;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: 'One at a time - give it a moment.' },
      { status: 429 },
    );
  }

  // Decoder is available to logged-out visitors too (a scary letter
  // shouldn't require an account first) but rate-limited the same.
  if (isSupabaseConfigured()) {
    await getCurrentUser().catch(() => null);
  }

  let body: { text?: string; today?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (text.length < 20) {
    return NextResponse.json(
      { error: 'Paste the document text (at least a sentence or two).' },
      { status: 400 },
    );
  }
  const today = (body.today || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const instruction = [
    `Today's date is ${today}.`,
    'A worried person has pasted a legal document or court notice.',
    'Decode it for them in calm, plain English. Use EXACTLY these',
    'markdown sections, in this order:',
    '',
    '## What this is',
    'One or two sentences naming the document type and who sent it.',
    '',
    '## What it means for you',
    'Plain consequences in 2-4 short sentences. No jargon.',
    '',
    '## What you must do',
    'A numbered list of concrete actions. If a response is required,',
    'say so first and unmistakably.',
    '',
    '## Deadlines',
    'A list of every date/deadline you can find, each as',
    '"- YYYY-MM-DD - <what is due>" and, when the deadline is',
    'relative ("within 30 days of service"), compute the date from',
    `${today} and label it "(estimated - confirm the trigger date)".`,
    'If none are stated, say "No explicit deadline found - do not',
    'assume there is none; confirm promptly."',
    '',
    '## Watch out for',
    'The 1-3 things people most often get wrong with this document.',
    '',
    'Rules: never invent facts not in the text. Do not give legal',
    'advice or strategy - explain and orient only. End with one',
    'line: "This is an explanation, not legal advice - if anything',
    'is unclear or the stakes are high, talk to a lawyer fast."',
    '',
    '--- DOCUMENT TEXT START ---',
    text.slice(0, 9000),
    '--- DOCUMENT TEXT END ---',
  ].join('\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          messages: [{ role: 'user', content: instruction }],
          isPublic: true,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const m = err instanceof Error ? err.message : 'Decoder error.';
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
