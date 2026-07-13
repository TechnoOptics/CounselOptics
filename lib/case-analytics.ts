import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiExtracted, TimelineMedia } from './timeline-types';
import type { MapPoint } from '@/app/cases/[id]/timeline/case-map';

/**
 * Read-only analytics over a matter's evidence (case_timeline_events). Powers
 * the live Evidence dashboard on the counsel case page. Firm reads go through
 * the admin client because is_case_member RLS is not firm-aware (see the firm
 * evidence intake notes); the caller supplies an already-scoped admin client.
 *
 * One select of the small set of columns we aggregate, folded in JS. A matter
 * tops out in the low thousands of items, so this stays well inside the page's
 * function budget without a pile of GROUP BY round-trips.
 */

export type NameCount = { name: string; n: number };

export type CaseEvidenceAnalytics = {
  total: number;
  status: { done: number; running: number; error: number; skipped: number; pending: number };
  analyzedPct: number;
  types: { images: number; videos: number; emails: number; pdfs: number; documents: number; other: number };
  totalBytes: number;
  duplicates: number;
  onTimeline: number;
  relevance: { scored: number; avg: number | null; high: number; medium: number; low: number };
  confidence: { high: number; medium: number; low: number };
  folders: NameCount[];
  docTypes: NameCount[];
  entities: { people: number; organizations: number; locations: number };
  dated: number;
  earliest: string | null;
  latest: string | null;
  byYear: { year: string; n: number; avgRelevance: number | null }[];
  mapPoints: MapPoint[];
};

type Row = {
  ai_status: string | null;
  media: TimelineMedia[] | null;
  ai_extracted: AiExtracted | null;
  title: string | null;
  occurred_at: string | null;
};

function topCounts(map: Map<string, number>, limit?: number): NameCount[] {
  const out = [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

export async function getCaseEvidenceAnalytics(
  admin: SupabaseClient,
  caseId: string,
): Promise<CaseEvidenceAnalytics> {
  const empty: CaseEvidenceAnalytics = {
    total: 0,
    status: { done: 0, running: 0, error: 0, skipped: 0, pending: 0 },
    analyzedPct: 0,
    types: { images: 0, videos: 0, emails: 0, pdfs: 0, documents: 0, other: 0 },
    totalBytes: 0,
    duplicates: 0,
    onTimeline: 0,
    relevance: { scored: 0, avg: null, high: 0, medium: 0, low: 0 },
    confidence: { high: 0, medium: 0, low: 0 },
    folders: [],
    docTypes: [],
    entities: { people: 0, organizations: 0, locations: 0 },
    dated: 0,
    earliest: null,
    latest: null,
    byYear: [],
    mapPoints: [],
  };

  const { data, error } = await admin
    .from('case_timeline_events')
    .select('ai_status, media, ai_extracted, title, occurred_at')
    .eq('case_id', caseId);
  if (error || !data || data.length === 0) return empty;

  const rows = data as Row[];
  const a = { ...empty, status: { ...empty.status }, types: { ...empty.types }, entities: { ...empty.entities } };
  const folders = new Map<string, number>();
  const docTypes = new Map<string, number>();
  const people = new Set<string>();
  const orgs = new Set<string>();
  const places = new Set<string>();
  const years = new Map<string, { n: number; relSum: number; relScored: number }>();
  const mapPts: MapPoint[] = [];
  let relSum = 0;

  const addAll = (set: Set<string>, arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) {
      const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
      if (s) set.add(s);
    }
  };

  a.total = rows.length;
  for (const r of rows) {
    const st = r.ai_status ?? 'pending';
    if (st === 'done') a.status.done++;
    else if (st === 'running') a.status.running++;
    else if (st === 'error') a.status.error++;
    else if (st === 'skipped') a.status.skipped++;
    else a.status.pending++;

    const m = Array.isArray(r.media) && r.media.length > 0 ? r.media[0] : null;
    const mime = (m?.mime ?? '').toLowerCase();
    if (m?.size) a.totalBytes += Number(m.size) || 0;
    if (!m) a.types.other++;
    else if (mime.startsWith('image/')) a.types.images++;
    else if (mime.startsWith('video/')) a.types.videos++;
    else if (mime === 'message/rfc822') a.types.emails++;
    else if (mime === 'application/pdf') a.types.pdfs++;
    else if (mime.startsWith('application/') || mime.startsWith('text/')) a.types.documents++;
    else a.types.other++;

    const ex = r.ai_extracted ?? null;
    if (!ex) continue;
    if (ex.duplicate_of) a.duplicates++;
    if (ex.on_timeline) a.onTimeline++;

    const folder = (ex.folder ?? '').trim() || 'Unfiled';
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
    const dt = (ex.document_type ?? '').trim();
    if (dt) docTypes.set(dt, (docTypes.get(dt) ?? 0) + 1);

    if (typeof ex.relevance_score === 'number' && Number.isFinite(ex.relevance_score)) {
      a.relevance.scored++;
      relSum += ex.relevance_score;
      if (ex.relevance_score >= 67) a.relevance.high++;
      else if (ex.relevance_score >= 34) a.relevance.medium++;
      else a.relevance.low++;
    }
    if (ex.confidence === 'high') a.confidence.high++;
    else if (ex.confidence === 'medium') a.confidence.medium++;
    else if (ex.confidence === 'low') a.confidence.low++;

    addAll(people, ex.detected_people);
    addAll(orgs, ex.organizations);
    addAll(places, ex.locations);

    // Geocoded pins for the dashboard case map (moved here from the evidence
    // list). Each pin carries the owning event's time, people, and relevance so
    // the map's breadcrumb slider and de-emphasis work unchanged.
    if (Array.isArray(ex.geo_points)) {
      const when = r.occurred_at ?? ex.suggested_occurred_at ?? null;
      const evPeople = Array.isArray(ex.detected_people) ? ex.detected_people.slice(0, 6) : [];
      for (const p of ex.geo_points) {
        if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
        mapPts.push({
          lat: p.lat,
          lng: p.lng,
          label: p.label ?? '',
          source: p.source === 'gps' ? 'gps' : 'place',
          time: when,
          when: when ? when.slice(0, 10) : undefined,
          people: evPeople,
          title: r.title ?? undefined,
          relevance: typeof ex.relevance_score === 'number' ? ex.relevance_score : undefined,
        });
      }
    }

    const occ = ex.suggested_occurred_at ?? '';
    const ymd = /^(\d{4})-\d{2}-\d{2}/.exec(occ);
    if (ymd) {
      a.dated++;
      const iso = occ.slice(0, 10);
      if (!a.earliest || iso < a.earliest) a.earliest = iso;
      if (!a.latest || iso > a.latest) a.latest = iso;
      const prev = years.get(ymd[1]) ?? { n: 0, relSum: 0, relScored: 0 };
      const scored = typeof ex.relevance_score === 'number' && Number.isFinite(ex.relevance_score);
      years.set(ymd[1], {
        n: prev.n + 1,
        relSum: prev.relSum + (scored ? (ex.relevance_score as number) : 0),
        relScored: prev.relScored + (scored ? 1 : 0),
      });
    }
  }

  a.analyzedPct = a.total > 0 ? Math.round((a.status.done / a.total) * 1000) / 10 : 0;
  a.relevance.avg = a.relevance.scored > 0 ? Math.round((relSum / a.relevance.scored) * 10) / 10 : null;
  a.entities = { people: people.size, organizations: orgs.size, locations: places.size };
  a.folders = topCounts(folders);
  a.docTypes = topCounts(docTypes, 10);
  a.byYear = [...years.entries()]
    .map(([year, v]) => ({
      year,
      n: v.n,
      avgRelevance: v.relScored > 0 ? Math.round(v.relSum / v.relScored) : null,
    }))
    .sort((x, y) => x.year.localeCompare(y.year));
  a.mapPoints = mapPts;
  return a;
}
