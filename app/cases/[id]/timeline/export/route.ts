import { NextResponse } from 'next/server';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { getTimelineBundle } from '@/lib/timeline-actions';
import { generateTimelineExhibitPdf, type TimelineExhibitData } from '@/lib/pdf';
import { formatOccurred, KIND_LABEL } from '@/lib/timeline-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const supabase = createServerSupabase();
  // RLS: non-members get no row.
  const { data: caseRow } = await supabase
    .from('cases')
    .select('id, title, subject_name')
    .eq('id', params.id)
    .maybeSingle();
  if (!caseRow) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const c = caseRow as { id: string; title: string; subject_name: string | null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const bundle = await getTimelineBundle(params.id);
  if (bundle.events.length === 0) {
    return NextResponse.json({ error: 'Add timeline entries before exporting.' }, { status: 400 });
  }

  const peopleById = new Map(bundle.people.map((p) => [p.id, p.displayName]));

  const data: TimelineExhibitData = {
    caseTitle: c.title,
    subjectName: c.subject_name,
    preparedBy:
      (profile as { display_name?: string | null } | null)?.display_name ||
      user.email ||
      null,
    generatedAt: new Date().toISOString(),
    narrative: bundle.narrative
      ? {
          summary: bundle.narrative.summary,
          narrative: bundle.narrative.narrative,
          conclusion: bundle.narrative.conclusion,
        }
      : null,
    people: bundle.people.map((p) => ({ name: p.displayName, role: p.role })),
    entries: bundle.events.map((e, i) => ({
      index: i + 1,
      when: formatOccurred(e.occurredAt, e.occurredPrecision),
      kind: KIND_LABEL[e.kind],
      title: e.title,
      context: e.description,
      summary: e.aiSummary,
      people: e.people.map((id) => peopleById.get(id) ?? '').filter(Boolean),
      media: e.media.map((m) => m.name),
    })),
  };

  const pdf = await generateTimelineExhibitPdf(data);
  const filename = `${c.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'case'}-timeline.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
