import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/cases
 *
 * List cases scoped to the bearer token. A user-token returns the
 * user's cases; a firm-token returns the firm's matter list.
 * Pagination via ?limit=50&offset=0; cap at 200.
 *
 * Auth: Authorization: Bearer adv_<token> with scope=read.
 */
export async function GET(req: NextRequest) {
  const verified = await verifyApiToken(req.headers.get('authorization'));
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!tokenHasScope(verified, 'read')) {
    return NextResponse.json(
      { error: 'Token missing read scope.' },
      { status: 403 },
    );
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: 'Server misconfigured.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get('limit') ?? 50)),
  );
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

  let query = admin
    .from('cases')
    .select(
      'id, title, subject_name, subject_type, case_type, posture, status, jurisdiction, hearing_at, created_at, updated_at',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (verified.firmId) {
    query = query.eq('firm_id', verified.firmId);
  } else if (verified.userId) {
    query = query.eq('user_id', verified.userId);
  } else {
    return NextResponse.json(
      { error: 'Token has neither firm nor user binding.' },
      { status: 403 },
    );
  }

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    cases: data ?? [],
    pagination: { total: count ?? 0, limit, offset },
  });
}
