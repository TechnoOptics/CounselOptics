import { NextResponse } from 'next/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { exhibitLabel, type AiExtracted } from '@/lib/timeline-types';
import { readEvidenceFolderRegistry, canSeeEvidenceFolder } from '@/lib/evidence-folders';

export const runtime = 'nodejs';

/**
 * Lightweight, matter-scoped search index for the case-wide smart search in
 * the guest shell header (and any other type-ahead over this matter). Returns
 * compact docs — titles, exhibit labels, people, places, organizations, and
 * folder names — never file contents or signed URLs, so it is safe to hold
 * client-side for instant suggestions. Same authorization model as the
 * evidence download/export routes: a member of the matter's firm OR a
 * case-scoped co-counsel guest.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
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
    .select('id, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  const c = caseRow as { id: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const [{ data: rows }, folderRegistry] = await Promise.all([
    admin
      .from('case_timeline_events')
      .select('id, title, kind, ai_extracted')
      .eq('case_id', params.id)
      .order('created_at', { ascending: false })
      .limit(2000),
    readEvidenceFolderRegistry(admin, params.id),
  ]);

  const docs = ((rows ?? []) as { id: string; title: string; kind: string; ai_extracted: AiExtracted | null }[])
    .filter((r) => !r.ai_extracted?.excluded)
    .map((r) => {
      const ext = r.ai_extracted ?? {};
      return {
        id: r.id,
        title: r.title,
        kind: r.kind,
        exhibit: exhibitLabel(ext.exhibit_no) ?? null,
        people: ext.detected_people ?? [],
        places: ext.locations ?? [],
        orgs: ext.organizations ?? [],
        // Another user's PRIVATE folders never leave the server.
        folders: (ext.collections ?? []).filter((f) =>
          canSeeEvidenceFolder(folderRegistry[f], user.id),
        ),
      };
    });

  return NextResponse.json(
    { docs },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
