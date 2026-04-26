import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same in-memory rate limit pattern as /api/bella, deliberately
// stricter since this endpoint is unauthed and longer-payload.
const RATE: Map<string, { count: number; reset: number }> = new Map();
const RATE_LIMIT = 8;
const WINDOW_MS = 60_000;
const MAX_DOC_CHARS = 30_000;

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
    return NextResponse.json(
      { error: 'Slow down - try again in a minute.' },
      { status: 429 },
    );
  }

  let payload: { document?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const document = typeof payload.document === 'string' ? payload.document.trim() : '';
  if (!document) {
    return NextResponse.json({ error: 'Paste the document text first.' }, { status: 400 });
  }
  if (document.length < 50) {
    return NextResponse.json(
      { error: 'That looks too short to be a real document. Paste the full text.' },
      { status: 400 },
    );
  }
  const trimmed = document.slice(0, MAX_DOC_CHARS);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          mode: 'doc-review',
          messages: [
            {
              role: 'user',
              content: `Please review the following document and follow the format you were given.\n\n---\n${trimmed}\n---`,
            },
          ],
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not finish review.';
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
