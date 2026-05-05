import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/documents
 *
 * Firm-scoped document list. Returns id, name, status, case_id,
 * tags, uploaded_at, due_at. Bytes are not returned; use the
 * dedicated download endpoint (next iteration) for the file body.
 */
export async function GET(req: NextRequest) {
  const verified = await verifyApiToken(req.headers.get('authorization'));
  if (!verified) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (!tokenHasScope(verified, 'read')) {
    return NextResponse.json({ error: 'read scope required' }, { status: 403 });
  }
  if (!verified.firmId) {
    return NextResponse.json({ error: 'Firm-scoped endpoint.' }, { status: 403 });
  }
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'misconfigured' }, { status: 500 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const caseId = url.searchParams.get('case_id');
  const status = url.searchParams.get('status');

  let q = admin
    .from('firm_documents')
    .select(
      'id, name, mime_type, file_size, status, status_updated_at, case_id, client_user_id, tags, due_at, uploaded_at',
      { count: 'exact' },
    )
    .eq('firm_id', verified.firmId)
    .order('uploaded_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (caseId) q = q.eq('case_id', caseId);
  if (status) q = q.eq('status', status);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    documents: data ?? [],
    pagination: { total: count ?? 0, limit, offset },
  });
}
