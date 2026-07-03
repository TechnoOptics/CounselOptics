import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Voice-first Case Capture - the user just tells their story (spoken
// or typed) and the model structures it into the fields the proven
// createCaseAction needs. It never invents facts; unknown fields are
// left for the user to fill on the review screen.

const CASE_TYPES = [
  'Civil dispute',
  'Employment issue',
  'Landlord/tenant issue',
  'Contract dispute',
  'Family matter',
  'Criminal allegation',
  'Harassment/threats',
  'Property damage',
  'Fraud/scam',
  'Business dispute',
  'Other',
];
const SUBJECT_TYPES = ['person', 'business', 'matter', 'state', 'entity'];

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured())
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const allowed = await checkRateLimit(`intake:${user.id}`, { limit: 8, windowSeconds: 60 });
  if (!allowed)
    return NextResponse.json({ error: 'One at a time, please.' }, { status: 429 });

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (text.length < 25)
    return NextResponse.json(
      { error: 'Tell us a little more about what happened.' },
      { status: 400 },
    );

  const prompt = [
    'A person described their legal situation in their own words.',
    'Structure it into a case draft. Reply with ONLY strict minified',
    'JSON, no prose, no code fence:',
    '{"title":"short memorable case title (<=60 chars)","caseType":',
    `one of ${JSON.stringify(CASE_TYPES)},"posture":"claimant" if`,
    'they are bringing/initiating the matter else "defendant",',
    `"subjectType":one of ${JSON.stringify(SUBJECT_TYPES)} (the`,
    'person/entity at the centre of the dispute),"subjectName":"who',
    'or what the case is about","country":"","state":"","city":"",',
    '"description":"a clean, neutral, first-person 3-6 sentence',
    'summary of what happened, in their voice, facts only"}',
    '',
    'Rules: use ONLY what they said. If a field is not stated, use',
    'an empty string "" (do not guess country/location). Never',
    'invent names, dates, or claims. This is organizational only.',
    '',
    '--- THEIR WORDS START ---',
    text.slice(0, 7000),
    '--- THEIR WORDS END ---',
  ].join('\n');

  let raw = '';
  try {
    for await (const chunk of streamBella({
      messages: [{ role: 'user', content: prompt }],
      isPublic: false,
    })) {
      raw += chunk;
      if (raw.length > 9000) break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not structure that.' },
      { status: 502 },
    );
  }

  const s = raw.indexOf('{');
  const en = raw.lastIndexOf('}');
  let p: Record<string, unknown> | null = null;
  if (s >= 0 && en > s) {
    try {
      p = JSON.parse(raw.slice(s, en + 1));
    } catch {
      p = null;
    }
  }
  if (!p)
    return NextResponse.json(
      { error: 'Could not structure that cleanly - try again or add detail.' },
      { status: 502 },
    );

  const str = (k: string, max: number) =>
    String(p?.[k] ?? '').slice(0, max).trim();
  const caseTypeRaw = str('caseType', 40);
  const subjRaw = str('subjectType', 20).toLowerCase();

  return NextResponse.json({
    title: str('title', 60),
    caseType: CASE_TYPES.includes(caseTypeRaw) ? caseTypeRaw : 'Other',
    posture: str('posture', 12) === 'defendant' ? 'defendant' : 'claimant',
    subjectType: SUBJECT_TYPES.includes(subjRaw) ? subjRaw : 'person',
    subjectName: str('subjectName', 120),
    country: str('country', 60),
    state: str('state', 60),
    city: str('city', 60),
    description: str('description', 1200),
  });
}
