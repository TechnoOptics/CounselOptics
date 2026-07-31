import { NextResponse } from 'next/server';
import { zipSync } from 'fflate';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { exhibitLabel, type TimelineMedia, type AiExtracted } from '@/lib/timeline-types';
import { logCaseActivity } from '@/lib/case-activity-log';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Download the ORIGINAL evidence files (not the court packet). `ids` is a
 * comma-separated list of timeline event ids; every file on those events is
 * returned, each named with its exhibit number ("EX-1451 - statement.pdf").
 * One file downloads directly; several are bundled into a ZIP. Same
 * authorization model as the export route: a member of the matter's firm OR a
 * case-scoped co-counsel guest.
 */

const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

function safeName(s: string): string {
  return s.replace(/[^\w .()\-\u00C0-\uFFFF]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || 'file';
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

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
    .select('id, title, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  const c = caseRow as { id: string; title: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const url = new URL(req.url);
  const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_FILES);
  if (!ids.length) return NextResponse.json({ error: 'Select at least one item.' }, { status: 400 });

  const { data: rows } = await admin
    .from('case_timeline_events')
    .select('id, title, media, ai_extracted')
    .eq('case_id', params.id)
    .in('id', ids);
  const events = (rows ?? []) as { id: string; title: string; media: TimelineMedia[] | null; ai_extracted: AiExtracted | null }[];
  if (!events.length) return NextResponse.json({ error: 'Those items were not found.' }, { status: 404 });

  // Gather every file across the selected items, exhibit-labelled.
  const wanted: { path: string; mime: string; name: string }[] = [];
  for (const e of events) {
    const label = exhibitLabel(e.ai_extracted?.exhibit_no);
    for (const m of e.media ?? []) {
      if (!m?.path) continue;
      const base = safeName(m.name || e.title || 'file');
      wanted.push({ path: m.path, mime: m.mime || 'application/octet-stream', name: label ? `${label} - ${base}` : base });
      if (wanted.length >= MAX_FILES) break;
    }
    if (wanted.length >= MAX_FILES) break;
  }
  if (!wanted.length) return NextResponse.json({ error: 'Those items have no files attached.' }, { status: 404 });

  void logCaseActivity({ caseId: params.id, action: 'export', skipFirm: true });

  // Download from storage, respecting the total-size budget.
  const files: { name: string; mime: string; buf: Buffer }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const w of wanted) {
    try {
      const { data, error } = await admin.storage.from('exhibits').download(w.path);
      if (error || !data) continue;
      const buf = Buffer.from(await data.arrayBuffer());
      if (total + buf.length > MAX_TOTAL_BYTES) break;
      total += buf.length;
      // Dedupe archive entry names (two files can share a name).
      let name = w.name;
      for (let n = 2; seen.has(name); n++) {
        const dot = w.name.lastIndexOf('.');
        name = dot > 0 ? `${w.name.slice(0, dot)} (${n})${w.name.slice(dot)}` : `${w.name} (${n})`;
      }
      seen.add(name);
      files.push({ name, mime: w.mime, buf });
    } catch {
      // A missing file shouldn't abort the rest of the download.
    }
  }
  if (!files.length) return NextResponse.json({ error: 'The files could not be retrieved.' }, { status: 502 });

  // One file: serve it directly under its exhibit-numbered name.
  if (files.length === 1) {
    const f = files[0];
    return new NextResponse(new Uint8Array(f.buf), {
      status: 200,
      headers: {
        'Content-Type': f.mime,
        'Content-Disposition': `attachment; filename="${f.name.replace(/[^\w .()-]+/g, '_')}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Several: bundle into a ZIP (stored, not recompressed, since media is
  // already compressed and this keeps large selections inside the time budget).
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(f.buf), { level: 0 }];
  const zip = zipSync(entries);
  const slug = c.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'matter';
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-exhibits.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
