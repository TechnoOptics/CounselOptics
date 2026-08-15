import { NextResponse } from 'next/server';
import { zipSync } from 'fflate';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { firmSuspended } from '@/lib/firm-trials';
import { exhibitLabel, type TimelineMedia, type AiExtracted } from '@/lib/timeline-types';
import { logCaseActivity } from '@/lib/case-activity-log';
import { caseFileRefusal } from '@/lib/case-file';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Download the ORIGINAL evidence files (not the court packet). `ids` is a
 * comma-separated list of timeline event ids; every file on those events is
 * returned, each named with its exhibit number ("EX-1451 - statement.pdf").
 * One file downloads directly; several are bundled into a ZIP. Same
 * authorization model as the export route: a member of the matter's firm OR a
 * case-scoped co-counsel guest.
 *
 * DELIBERATELY EXEMPT from the organization access gate, exactly as
 * /api/firm/export is, and the exemption is load-bearing rather than an
 * oversight.
 *
 * The organization-wide export NAMES evidence files it does not carry:
 * case_timeline_events.media points into the `exhibits` bucket and the bytes
 * stay there, because base64 inflates an archive by about a third, evidence is
 * where the volume lives, and embedding it properly means a container format
 * hand-rolled under the no-new-dependencies rule. This route is therefore the
 * ONLY way a departing organization opens the timeline files its own export
 * lists. Gate it and that half of the export hands back an index to nothing.
 *
 * WHAT IT IS NOT: this route reads case_timeline_events and the `exhibits`
 * STORAGE BUCKET. It does not read the `public.exhibits` TABLE, which has a
 * storage_path column of its own and is served by /api/files/<id>. An earlier
 * version of this header claimed both, and lib/firm-access.ts repeated the
 * claim. The rows behind exhibits.storage_path are not reachable through here.
 *
 * What is NOT relaxed: everything below this comment. Signed in, a member of
 * the matter's firm or a guest scoped to that matter, and the matter has to
 * belong to that firm. The exemption says the access STATE does not close this
 * door; it says nothing about who may walk through it. Do not add a shortcut
 * here on the grounds that the route is already exempt.
 *
 * The exemption covers the firm's own members. A co-counsel GUEST under a
 * SUSPENSION is refused, in the guest branch below, for the reason written
 * there.
 *
 * Layer one does not reach this either way, twice over: a route handler
 * renders no layout, and lib/firm-access.ts lists the path in
 * RETRIEVAL_PATTERNS so that a future middleware or layout reaching for that
 * rule finds it written down instead of rediscovering it. That is also why
 * the guest check below cannot be left to the shell.
 *
 * It is READ-ONLY apart from the case_activity line, which is the record of
 * the retrieval and belongs with it.
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
    // The guest half of the exemption, narrowed exactly as the counsel shell
    // narrows it, and restated here because a ROUTE HANDLER RENDERS NO LAYOUT.
    // app/counsel/layout.tsx turns a suspended organization's co-counsel guest
    // away, and that redirect never runs for this file, so without this line a
    // guest keeps every evidence file by URL while the suspension holds. This
    // is the door suspension exists to close.
    //
    // It sits INSIDE the guest branch on purpose. The firm's own members keep
    // the exemption above in both states, because the export names files whose
    // bytes are not in it and this route is the only way an organization that
    // can no longer use the product opens them. A guest is the other case: a
    // lapse is a billing fact about the firm and no reason to take a matter
    // away from the attorney working it, while a suspension is the
    // abuse-response state, and an account the firm itself provisioned is a
    // channel that state is meant to close.
    //
    // It also sits AFTER guestCanReadCase, so a caller with no access to the
    // matter learns nothing about the organization's standing.
    //
    // firmSuspended throws on a read it could not complete, and that throw
    // must travel. "Could not determine" is not "not suspended", so do not
    // wrap this in a catch.
    if (await firmSuspended(caseFirmId)) {
      return NextResponse.json(
        { error: 'This matter is not available right now.' },
        { status: 403 },
      );
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

  // Original exhibit files, by URL. This is the door a closed case file most
  // needs shut: the page is gone but the bytes are addressable, and a route
  // handler renders no layout to stop anyone. Nothing is deleted by refusing -
  // the storage objects are untouched and open again with the case file.
  const caseFileClosed = await caseFileRefusal(params.id);
  if (caseFileClosed) {
    return NextResponse.json({ error: caseFileClosed.error }, { status: 403 });
  }

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
