import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/signing-requests
 *
 * Firm-scoped signing request list. Each row includes signer count
 * and completion percentage so dashboards can render progress bars
 * without N+1ing into firm_signatures.
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

  const { data: reqsRaw, count } = await admin
    .from('firm_signing_requests')
    .select(
      'id, document_id, status, message, sent_at, completed_at, document_sha256, created_at',
      { count: 'exact' },
    )
    .eq('firm_id', verified.firmId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const reqs = (reqsRaw ?? []) as Array<{
    id: string;
    document_id: string;
    status: string;
    message: string | null;
    sent_at: string | null;
    completed_at: string | null;
    document_sha256: string | null;
    created_at: string;
  }>;
  if (reqs.length === 0) {
    return NextResponse.json({ signing_requests: [], pagination: { total: 0, limit, offset } });
  }

  // Pull signer counts in one batch.
  const reqIds = reqs.map((r) => r.id);
  const { data: sigsRaw } = await admin
    .from('firm_signatures')
    .select('signing_request_id, signed_at')
    .in('signing_request_id', reqIds);
  const counts = new Map<string, { total: number; signed: number }>();
  for (const s of (sigsRaw ?? []) as Array<{
    signing_request_id: string;
    signed_at: string | null;
  }>) {
    const c = counts.get(s.signing_request_id) ?? { total: 0, signed: 0 };
    c.total += 1;
    if (s.signed_at) c.signed += 1;
    counts.set(s.signing_request_id, c);
  }

  return NextResponse.json({
    signing_requests: reqs.map((r) => {
      const c = counts.get(r.id) ?? { total: 0, signed: 0 };
      return {
        ...r,
        signer_count: c.total,
        signed_count: c.signed,
        progress: c.total === 0 ? 0 : Math.round((c.signed / c.total) * 100),
      };
    }),
    pagination: { total: count ?? 0, limit, offset },
  });
}
