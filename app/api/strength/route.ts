import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCase, listExhibits } from '@/lib/storage';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Evidence Strength Heatmap - asks the model to name the elements a
// case of this kind typically must establish, then rate how well the
// litigant's actual exhibits support each, with the single most
// useful thing to add next. Returns strict JSON (collected from the
// streaming transport) so the UI can draw a real heatmap.

type Element = {
  name: string;
  strength: 'strong' | 'some' | 'thin' | 'missing';
  why: string;
  supportedBy: string[];
  addNext: string;
};

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const allowed = await checkRateLimit(`strength:${user.id}`, { limit: 6, windowSeconds: 60 });
  if (!allowed)
    return NextResponse.json(
      { error: 'Give the analysis a moment between runs.' },
      { status: 429 },
    );

  let body: { caseId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  if (!body.caseId)
    return NextResponse.json({ error: 'Missing caseId.' }, { status: 400 });

  const c = await getCase(body.caseId);
  if (!c) return NextResponse.json({ error: 'Case not found.' }, { status: 404 });
  const exhibits = await listExhibits(c.id);

  const jurisdiction =
    [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
      .filter(Boolean)
      .join(', ') || 'not specified';
  const exhibitList = exhibits.length
    ? exhibits
        .map(
          (e) =>
            `- "${e.label}" [${e.category || 'evidence'}]${
              e.description ? `: ${e.description}` : ''
            }${e.incidentDate ? ` (dated ${e.incidentDate.slice(0, 10)})` : ''}`,
        )
        .join('\n')
    : '(no exhibits uploaded yet)';

  const prompt = [
    'You are an evidence-readiness analyst helping a self-represented',
    'litigant see where their proof is strong and where it is thin.',
    '',
    `Case: ${c.title}`,
    `Type: ${c.caseType} | Posture: ${c.posture} | Jurisdiction: ${jurisdiction}`,
    `Subject (${c.subjectType}): ${c.subjectName}`,
    c.description ? `Their account: ${c.description.slice(0, 900)}` : '',
    '',
    'Their exhibits:',
    exhibitList,
    '',
    'Identify the 4 to 7 ELEMENTS a case of this kind typically must',
    'establish (general practice - jurisdictions vary). For each,',
    'judge how well THEIR LISTED EXHIBITS support it. Reply with',
    'ONLY strict minified JSON, no prose, no code fence:',
    '{"overall":<0-100 readiness>,"summary":"<=200 chars plain',
    'English","elements":[{"name":"...","strength":"strong|some|',
    'thin|missing","why":"<=160 chars, reference exhibits by their',
    'quoted label","supportedBy":["exact exhibit labels"],"addNext":',
    '"the single most useful piece of evidence to add, <=120 chars"}]}',
    '',
    'Rules: use only the listed exhibits - do not assume unlisted',
    'proof. Be honest; "missing" is fine and useful. This is an',
    'organizational aid, not legal advice.',
  ]
    .filter(Boolean)
    .join('\n');

  let raw = '';
  try {
    for await (const chunk of streamBella({
      messages: [{ role: 'user', content: prompt }],
      isPublic: false,
    })) {
      raw += chunk;
      if (raw.length > 16000) break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Analysis failed.' },
      { status: 502 },
    );
  }

  // Extract the JSON object even if the model wrapped it.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let parsed: { overall?: number; summary?: string; elements?: Element[] } | null =
    null;
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !Array.isArray(parsed.elements)) {
    return NextResponse.json(
      { error: 'Could not analyze cleanly - try again in a moment.' },
      { status: 502 },
    );
  }

  const okStrength = new Set(['strong', 'some', 'thin', 'missing']);
  const elements: Element[] = parsed.elements
    .filter((el) => el && typeof el.name === 'string')
    .slice(0, 8)
    .map((el) => ({
      name: String(el.name).slice(0, 120),
      strength: okStrength.has(el.strength) ? el.strength : 'thin',
      why: String(el.why || '').slice(0, 220),
      supportedBy: Array.isArray(el.supportedBy)
        ? el.supportedBy.map((s) => String(s).slice(0, 80)).slice(0, 6)
        : [],
      addNext: String(el.addNext || '').slice(0, 160),
    }));

  const overall =
    typeof parsed.overall === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.overall)))
      : Math.round(
          (elements.reduce(
            (a, e) =>
              a +
              ({ strong: 100, some: 65, thin: 35, missing: 5 }[e.strength] ??
                35),
            0,
          ) /
            Math.max(1, elements.length)),
        );

  return NextResponse.json({
    overall,
    summary: String(parsed.summary || '').slice(0, 240),
    elements,
    exhibitCount: exhibits.length,
  });
}
