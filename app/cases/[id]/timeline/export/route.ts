import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { getTimelineBundle } from '@/lib/timeline-actions';
import {
  generateTimelineExhibitPdf,
  type TimelineExhibitData,
  type ExhibitFile,
  type ExhibitEntity,
} from '@/lib/pdf';
import { formatOccurred, KIND_LABEL, ROLE_LABEL, type TimelineMedia } from '@/lib/timeline-types';
import { staticMapUrlServer } from '@/lib/maps';
import { parseExhibitSheet } from '@/lib/exhibit-sheet';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Bound the work so a huge timeline can't blow the 60s budget: cap how many
// files we download + hash, and don't inline anything above ~15 MB.
const MAX_DOWNLOADS = 150;
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

function isJpegOrPng(buf: Buffer): boolean {
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // JPEG
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) // PNG
  );
}

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

  let downloads = 0;

  // Download a file from the member-scoped exhibits bucket, hash it, and keep
  // the bytes for embedding when it's a JPEG/PNG.
  async function loadExhibit(m: TimelineMedia): Promise<ExhibitFile> {
    const base: ExhibitFile = {
      name: m.name || 'file',
      mime: m.mime || '',
      sizeBytes: m.size || 0,
      sha256: '(not computed)',
      image: null,
    };
    if (m.size && m.size > MAX_INLINE_BYTES) {
      return { ...base, sha256: '(not computed: large file)' };
    }
    if (downloads >= MAX_DOWNLOADS) {
      return { ...base, sha256: '(not computed: export limit reached)' };
    }
    downloads++;
    try {
      const { data, error } = await supabase.storage.from('exhibits').download(m.path);
      if (error || !data) return { ...base, sha256: '(file unavailable)' };
      const buf = Buffer.from(await data.arrayBuffer());
      const sha256 = createHash('sha256').update(buf).digest('hex');
      // The same parser the firm export has always run, on bytes this route
      // already holds. Without it a .xlsx exhibit reached generateTimelineExhibitPdf
      // with `sheet` unset and got a bare card, while the firm export of the
      // same matter, through the same generator, printed the figures as a table.
      // It is bounded on every axis and fail-safe: any parse problem is null,
      // and the card then says the contents are not reproduced.
      const sheet = await parseExhibitSheet(buf, base.name, base.mime);
      return {
        ...base,
        sizeBytes: buf.length || base.sizeBytes,
        sha256,
        image: isJpegOrPng(buf) ? buf : null,
        sheet,
      };
    } catch {
      return { ...base, sha256: '(file unavailable)' };
    }
  }

  async function loadPhoto(path: string | null): Promise<Buffer | null> {
    if (!path || downloads >= MAX_DOWNLOADS) return null;
    downloads++;
    try {
      const { data, error } = await supabase.storage.from('exhibits').download(path);
      if (error || !data) return null;
      const buf = Buffer.from(await data.arrayBuffer());
      return isJpegOrPng(buf) ? buf : null;
    } catch {
      return null;
    }
  }

  const peopleById = new Map(bundle.people.map((p) => [p.id, p.displayName]));

  // ── Persons of interest (profiles + reference photos).
  const personEntities: ExhibitEntity[] = await Promise.all(
    bundle.people.map(async (p) => ({
      name: p.displayName,
      kind: 'person' as const,
      roleLabel: ROLE_LABEL[p.role] ?? 'Other',
      aliases: p.aliases,
      notes: p.notes,
      photo: await loadPhoto(p.avatarPath),
      appearances: bundle.events.filter((e) => e.people.includes(p.id)).length,
    })),
  );

  // ── Organizations of interest, aggregated from Bella's per-item extraction.
  const orgMap = new Map<string, { name: string; count: number }>();
  for (const e of bundle.events) {
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

  // ── Entries with embedded, hashed exhibits (sequential so the download cap
  //    and the 60s budget are respected).
  const entries: TimelineExhibitData['entries'] = [];
  for (let i = 0; i < bundle.events.length; i++) {
    const e = bundle.events[i];
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

  // ── General case map: a themed static image of every geocoded location,
  //    framed to the pinged area. Gated on the Maps key (null without it).
  let caseMap: TimelineExhibitData['caseMap'] = null;
  const allPoints = bundle.events.flatMap((e) => e.aiExtracted.geo_points ?? []);
  if (allPoints.length) {
    const seen = new Set<string>();
    const uniq = allPoints.filter((p) => {
      const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const url = staticMapUrlServer(uniq.map((p) => ({ lat: p.lat, lng: p.lng })), { width: 640, height: 360, scale: 2 });
    if (url) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          const places = [...new Set(uniq.filter((p) => p.source === 'place').map((p) => p.label))].slice(0, 12);
          caseMap = { image: Buffer.from(await r.arrayBuffer()), count: uniq.length, places };
        }
      } catch {
        /* map is best-effort */
      }
    }
  }

  const data: TimelineExhibitData = {
    caseTitle: c.title,
    caseRef: c.id.slice(0, 8).toUpperCase(),
    caseMap,
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
    entities: [...personEntities, ...orgEntities],
    entries,
  };

  const pdf = await generateTimelineExhibitPdf(data);
  const filename = `${c.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) || 'case'}-timeline-exhibit.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
