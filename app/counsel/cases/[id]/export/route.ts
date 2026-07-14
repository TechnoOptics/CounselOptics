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
import { formatOccurred, KIND_LABEL, ROLE_LABEL, relevanceBand, type TimelineMedia } from '@/lib/timeline-types';
import { staticMapUrlServer } from '@/lib/maps';
import { canonicalOrg } from '@/lib/entity-normalize';
import { logCaseActivity } from '@/lib/case-activity-log';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Firm-native case export. The consumer /cases/[id]/export builds its packet
 * through the member-scoped storage layer, so for a FIRM matter - where the
 * firm member is not the case's row owner - it returned empty pages. This route
 * reads the whole matter through the firm admin path (exactly like the firm
 * evidence + timeline actions) and, crucially, exports ONLY the evidence the
 * user selected: the `ids` query param is a comma-separated list of timeline
 * event ids. With no selection we fall back to the full timeline. Each selected
 * item is embedded with its context (dates, people, source, forensic details)
 * into a court-ready evidentiary timeline exhibit.
 */

// Bound the work so a huge selection can't blow the 60s budget: cap how many
// files we download + hash, and don't inline anything above ~15 MB.
const MAX_DOWNLOADS = 150;
const MAX_INLINE_BYTES = 15 * 1024 * 1024;

function isJpegOrPng(buf: Buffer): boolean {
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) || // JPEG
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) // PNG
  );
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Authorize as EITHER a firm member of the matter's firm OR a case-scoped
  // co-counsel GUEST assigned to this matter. Guests get the SAME court-ready
  // export (view + export is their whole job) but can never reach a matter
  // they were not added to. Resolve firmId from whichever path authorizes.
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
    // Read the matter's firm first so we can bind the guest check to it.
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

  const bundle = await getFirmTimelineBundle(firmId, params.id);
  if (bundle.events.length === 0) {
    return NextResponse.json({ error: 'Add evidence before exporting.' }, { status: 400 });
  }

  // Record the download for the firm's activity stream. skipFirm so only an
  // outside co-counsel's download shows up, not the firm's own exports.
  void logCaseActivity({ caseId: params.id, action: 'export', skipFirm: true });

  // Selection: comma-separated event ids. An explicit selection is honoured
  // exactly. With NO selection, the packet defaults to only the RELEVANT items
  // (relevance band medium/high, plus unscored items) so the court is not
  // handed low-relevance noise; pass ?all=1 to include the entire matter.
  const url = new URL(req.url);
  const raw = url.searchParams.get('ids');
  const includeAll = url.searchParams.get('all') === '1';
  const selected = raw
    ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  let chosen = selected
    ? bundle.events.filter((e) => selected.has(e.id))
    : includeAll
      ? bundle.events
      : bundle.events.filter((e) => relevanceBand(e.aiExtracted.relevance_score) !== 'low');
  // Never emit an empty packet: if the relevance filter left nothing (e.g. an
  // unscored matter), fall back to the whole matter rather than erroring.
  if (!selected && !includeAll && chosen.length === 0) chosen = bundle.events;
  if (chosen.length === 0) {
    return NextResponse.json({ error: 'Select at least one item to export.' }, { status: 400 });
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  let downloads = 0;

  // Download a file from the exhibits bucket via admin, hash it, and keep the
  // bytes for embedding when it's a JPEG/PNG.
  async function loadExhibit(m: TimelineMedia): Promise<ExhibitFile> {
    const base: ExhibitFile = {
      name: m.name || 'file',
      mime: m.mime || '',
      sizeBytes: m.size || 0,
      sha256: '(not computed)',
      image: null,
    };
    if (m.size && m.size > MAX_INLINE_BYTES) {
      return { ...base, sha256: '(not computed — large file)' };
    }
    if (downloads >= MAX_DOWNLOADS) {
      return { ...base, sha256: '(not computed — export limit reached)' };
    }
    downloads++;
    try {
      const { data, error } = await admin!.storage.from('exhibits').download(m.path);
      if (error || !data) return { ...base, sha256: '(file unavailable)' };
      const buf = Buffer.from(await data.arrayBuffer());
      const sha256 = createHash('sha256').update(buf).digest('hex');
      const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      return {
        ...base,
        sizeBytes: buf.length || base.sizeBytes,
        sha256,
        image: isJpegOrPng(buf) ? buf : null,
        pdf: isPdf ? buf : null,
      };
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

  // ── Persons of interest: only those who appear in the chosen items.
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

  // ── Organizations of interest, aggregated from the chosen items' extraction.
  const orgMap = new Map<string, { name: string; count: number }>();
  for (const e of chosen) {
    for (const raw of e.aiExtracted.organizations ?? []) {
      // Drop non-party noise (Facebook, Amazon, Shop Pay, SAP Concur, etc.) and
      // merge surface forms of the same entity ("RE+GEN Nutrition LLC." and
      // "RE+GEN nutrition"; "Zinpro" and "Zinpro Corporation").
      const name = canonicalOrg(raw);
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

  // ── Case map: a themed static image of every geocoded location across the
  //    chosen items, framed to the pinged area. Gated on the Maps key.
  let caseMap: TimelineExhibitData['caseMap'] = null;
  const allPoints = chosen.flatMap((e) => e.aiExtracted.geo_points ?? []);
  if (allPoints.length) {
    const seen = new Set<string>();
    const uniq = allPoints.filter((p) => {
      const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const mapUrl = staticMapUrlServer(uniq.map((p) => ({ lat: p.lat, lng: p.lng })), { width: 640, height: 360, scale: 2 });
    if (mapUrl) {
      try {
        const r = await fetch(mapUrl, { cache: 'no-store' });
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
      (profile as { display_name?: string | null } | null)?.display_name || user.email || null,
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
