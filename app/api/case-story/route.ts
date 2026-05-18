import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCase, listExhibits } from '@/lib/storage';
import { listCaseAuditEvents } from '@/lib/activity';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// "Case Story" - turns the structured case timeline into a clear,
// factual, chronological narrative the litigant can use as the spine
// of a written declaration / affidavit. Streams plain text, same
// transport contract as /api/bella.

const RATE = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const e = RATE.get(ip);
  if (!e || e.reset < now) {
    RATE.set(ip, { count: 1, reset: now + 60_000 });
    return true;
  }
  e.count += 1;
  return e.count <= 8; // narrative generation is heavier; cap tighter
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: 'Give it a moment - composing a story is heavy work.' },
      { status: 429 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage not configured.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to compose a story.' }, { status: 401 });
  }

  let body: { caseId?: string };
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

  const [exhibits, activity] = await Promise.all([
    listExhibits(c.id),
    listCaseAuditEvents(c.id, 80).catch(() => []),
  ]);

  // Build the chronological fact spine. Exhibits are anchored to their
  // incidentDate (when the event happened) when known, else upload time.
  type Beat = { at: number; label: string; line: string };
  const beats: Beat[] = [];
  beats.push({
    at: Date.parse(c.createdAt),
    label: 'Case opened',
    line: `Case file "${c.title}" opened for a ${c.caseType} matter (${c.posture}).`,
  });
  for (const e of exhibits) {
    const whenIso = e.incidentDate || e.uploadedAt;
    const t = Date.parse(whenIso);
    if (Number.isNaN(t)) continue;
    beats.push({
      at: t,
      label: e.label,
      line: `${e.label} [${e.category || 'evidence'}]: ${e.fileName}${
        e.description ? ` - ${e.description}` : ''
      }${e.source ? ` (source: ${e.source})` : ''}${
        e.incidentDate ? '' : ' (date approximate - upload time)'
      }`,
    });
  }
  if (c.hearingAt && !Number.isNaN(Date.parse(c.hearingAt))) {
    beats.push({
      at: Date.parse(c.hearingAt),
      label: 'Hearing',
      line: `Hearing scheduled${
        c.hearingLocation ? ` at ${c.hearingLocation}` : ''
      }${c.hearingNotes ? ` - ${c.hearingNotes}` : ''}.`,
    });
  }
  for (const a of activity) {
    if (/viewed|opened_case|search/i.test(a.eventType)) continue;
    const t = Date.parse(a.createdAt);
    if (Number.isNaN(t)) continue;
    beats.push({
      at: t,
      label: a.eventType.replace(/_/g, ' '),
      line: `${a.eventType.replace(/_/g, ' ')}${
        a.actorDisplayName ? ` by ${a.actorDisplayName}` : ''
      }.`,
    });
  }
  beats.sort((x, y) => x.at - y.at);

  const timeline = beats
    .map(
      (b) =>
        `${new Date(b.at).toISOString().slice(0, 10)} - ${b.line}`,
    )
    .join('\n');

  const jurisdiction =
    [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
      .filter(Boolean)
      .join(', ') || 'not specified';

  const caseContext = [
    `Case: ${c.title}`,
    `Type: ${c.caseType} | Posture: ${c.posture} | Jurisdiction: ${jurisdiction}`,
    `Subject (${c.subjectType}): ${c.subjectName}`,
    c.description ? `User's own summary: ${c.description.slice(0, 800)}` : '',
    '',
    'CHRONOLOGICAL FACT TIMELINE (each line is a dated, sourced beat):',
    timeline,
  ]
    .filter(Boolean)
    .join('\n');

  const instruction = [
    'Compose a clear, factual, first-person CHRONOLOGICAL NARRATIVE of',
    'this case that a self-represented litigant could use as the spine',
    'of a written declaration / affidavit.',
    '',
    'Rules:',
    '- Use ONLY facts present in the timeline and the user summary. Do',
    '  not invent events, dates, names, or legal conclusions.',
    '- Numbered paragraphs, one event per paragraph, strict date order.',
    '- Plain English, calm and neutral. No adjectives that argue the',
    '  case; let the facts speak.',
    '- Reference each supporting item by its exhibit label in (parentheses).',
    '- Where a date is approximate, say "on or about".',
    '- End with a short section "Evidence gaps to strengthen" listing',
    '  the 2-4 specific missing pieces that would most help.',
    '- Begin with: "DRAFT - review every line for accuracy before use."',
    'This is an organizational draft, not legal advice.',
  ].join('\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          messages: [{ role: 'user', content: instruction }],
          caseContext,
          isPublic: false,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const m = err instanceof Error ? err.message : 'Story composer error.';
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
