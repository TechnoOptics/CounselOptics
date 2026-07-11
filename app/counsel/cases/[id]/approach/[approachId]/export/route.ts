import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getFirmTimelineBundle } from '@/lib/firm-timeline-actions';
import {
  generateTimelineExhibitPdf,
  type TimelineExhibitData,
  type ExhibitFile,
  type ExhibitEntity,
} from '@/lib/pdf';
import type { ApproachArgument } from '@/lib/approach-ai';
import {
  formatOccurred,
  exhibitLabel,
  KIND_LABEL,
  ROLE_LABEL,
  type TimelineMedia,
} from '@/lib/timeline-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Approach packet export. Builds a court-ready PDF for ONE saved approach:
 * the assembled argument (thesis + argument + gaps) as the packet's opening
 * work-product narrative, followed by ONLY the evidence that approach marshals
 * - the exhibits Advottic cited when it assembled the argument - each embedded
 * with its context and a content hash. Mirrors the matter export's firm
 * admin-path + guest access model; differs only in WHAT it selects (the
 * approach's cited exhibits, not a manual selection) and the narrative (the
 * approach's own argument, not the matter narrative).
 */

const MAX_DOWNLOADS = 150;
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

function isJpegOrPng(buf: Buffer): boolean {
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
  );
}

/** The approach's argument, formatted as the packet's opening narrative. */
function approachNarrative(
  title: string,
  g: ApproachArgument,
): TimelineExhibitData['narrative'] {
  const summary = [`Approach: ${title}`.trim(), g.thesis?.trim()]
    .filter(Boolean)
    .join('\n\n');
  const conclusion = g.gaps.length
    ? `Gaps still to close:\n${g.gaps.map((x) => `• ${x}`).join('\n')}`
    : '';
  return {
    summary: summary || title,
    narrative: g.argument?.trim() || '',
    conclusion,
  };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string; approachId: string } },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Authorize as a firm member of the matter's firm OR a case-scoped co-counsel
  // guest assigned to this matter (same model as the matter export).
  const ctx = await getActiveFirmContext();
  let firmId: string | null = null;
  if (ctx) {
    firmId = ctx.firm.id;
    const supabase = createServerSupabase();
    const { data: member } = await supabase
      .from('firm_members')
      .select('id')
      .eq('firm_id', firmId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'No access to this firm.' }, { status: 403 });
  } else {
    const { guestCanReadCase } = await import('@/lib/counsel-guest');
    const { data: firmRow } = await admin
      .from('cases')
      .select('firm_id')
      .eq('id', params.id)
      .maybeSingle();
    const caseFirmId = (firmRow as { firm_id: string | null } | null)?.firm_id ?? null;
    if (!caseFirmId || !(await guestCanReadCase(params.id, caseFirmId))) {
      return NextResponse.json({ error: 'No access to this matter.' }, { status: 403 });
    }
    firmId = caseFirmId;
  }

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, title, subject_name, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  const c = caseRow as { id: string; title: string; subject_name: string | null; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Load the approach, scoped to this matter + firm.
  const { data: appRow } = await admin
    .from('case_approaches')
    .select('id, title, generated, firm_id, case_id')
    .eq('id', params.approachId)
    .eq('case_id', params.id)
    .maybeSingle();
  const approach = appRow as
    | { id: string; title: string; generated: ApproachArgument | null; firm_id: string | null; case_id: string }
    | null;
  if (!approach || approach.firm_id !== firmId) {
    return NextResponse.json({ error: 'Approach not found.' }, { status: 404 });
  }
  const g = approach.generated;
  if (!g) {
    return NextResponse.json(
      { error: 'Assemble this approach before exporting its packet.' },
      { status: 400 },
    );
  }

  const bundle = await getFirmTimelineBundle(firmId, params.id);

  // ── Select ONLY the evidence this approach marshals: items whose exhibit
  //    label was cited, plus a title match for items the model referenced by
  //    title (labelless). Preserves the matter's chronological order.
  const citedLabels = new Set(
    g.exhibits.map((e) => (e.exhibit ?? '').trim().toUpperCase()).filter(Boolean),
  );
  const citedTitles = new Set(
    g.exhibits
      .filter((e) => !e.exhibit)
      .map((e) => (e.title ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const chosen = bundle.events.filter((e) => {
    const label = exhibitLabel(e.aiExtracted.exhibit_no);
    if (label && citedLabels.has(label.toUpperCase())) return true;
    const title = (e.title ?? '').trim().toLowerCase();
    return !!title && citedTitles.has(title);
  });

  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  let downloads = 0;

  async function loadExhibit(m: TimelineMedia): Promise<ExhibitFile> {
    const base: ExhibitFile = {
      name: m.name || 'file',
      mime: m.mime || '',
      sizeBytes: m.size || 0,
      sha256: '(not computed)',
      image: null,
    };
    if (m.size && m.size > MAX_INLINE_BYTES) return { ...base, sha256: '(not computed — large file)' };
    if (downloads >= MAX_DOWNLOADS) return { ...base, sha256: '(not computed — export limit reached)' };
    downloads++;
    try {
      const { data, error } = await admin!.storage.from('exhibits').download(m.path);
      if (error || !data) return { ...base, sha256: '(file unavailable)' };
      const buf = Buffer.from(await data.arrayBuffer());
      const sha256 = createHash('sha256').update(buf).digest('hex');
      return { ...base, sizeBytes: buf.length || base.sizeBytes, sha256, image: isJpegOrPng(buf) ? buf : null };
    } catch {
      return { ...base, sha256: '(file unavailable)' };
    }
  }

  async function loadPhoto(path: string | null): Promise<Buffer | null> {
    if (!path || downloads >= MAX_DOWNLOADS) return null;
    downloads++;
    try {
      const { data, error } = await admin!.storage.from('exhibits').download(path);
      if (error || !data) return null;
      const buf = Buffer.from(await data.arrayBuffer());
      return isJpegOrPng(buf) ? buf : null;
    } catch {
      return null;
    }
  }

  const peopleById = new Map(bundle.people.map((p) => [p.id, p.displayName]));

  const chosenPersonIds = new Set(chosen.flatMap((e) => e.people));
  const personEntities: ExhibitEntity[] = await Promise.all(
    bundle.people
      .filter((p) => chosenPersonIds.has(p.id))
      .map(async (p) => ({
        name: p.displayName,
        kind: 'person' as const,
        roleLabel: ROLE_LABEL[p.role] ?? 'Other',
        aliases: p.aliases,
        notes: p.notes,
        photo: await loadPhoto(p.avatarPath),
        appearances: chosen.filter((e) => e.people.includes(p.id)).length,
      })),
  );

  const orgMap = new Map<string, { name: string; count: number }>();
  for (const e of chosen) {
    for (const raw of e.aiExtracted.organizations ?? []) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const cur = orgMap.get(key);
      if (cur) cur.count++;
      else orgMap.set(key, { name, count: 1 });
    }
  }
  const orgEntities: ExhibitEntity[] = [...orgMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((o) => ({
      name: o.name,
      kind: 'organization' as const,
      roleLabel: 'Organization',
      aliases: [],
      notes: `Referenced in ${o.count} item${o.count === 1 ? '' : 's'}`,
      photo: null,
      appearances: o.count,
    }));

  const entries: TimelineExhibitData['entries'] = [];
  for (let i = 0; i < chosen.length; i++) {
    const e = chosen[i];
    const exhibits = await Promise.all(e.media.map(loadExhibit));
    entries.push({
      index: i + 1,
      when: formatOccurred(e.occurredAt, e.occurredPrecision),
      kind: KIND_LABEL[e.kind],
      title: e.title,
      context: e.description,
      summary: e.aiSummary,
      sourceLabel: e.sourceLabel,
      people: e.people.map((id) => peopleById.get(id) ?? '').filter(Boolean),
      exhibits,
      coreDetails: e.aiExtracted.metadata ?? [],
    });
  }

  const data: TimelineExhibitData = {
    caseTitle: c.title,
    caseRef: c.id.slice(0, 8).toUpperCase(),
    caseMap: null,
    subjectName: c.subject_name,
    preparedBy:
      (profile as { display_name?: string | null } | null)?.display_name || user.email || null,
    generatedAt: new Date().toISOString(),
    narrative: approachNarrative(approach.title, g),
    entities: [...personEntities, ...orgEntities],
    entries,
  };

  const pdf = await generateTimelineExhibitPdf(data);
  const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const filename = `${slug(c.title) || 'matter'}-approach-${slug(approach.title) || 'packet'}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
