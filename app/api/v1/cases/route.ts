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

  // The cases table stores jurisdiction in three columns
  // (country, state, city), not as a single `jurisdiction`
  // column - selecting `jurisdiction` here used to 500 the request
  // which left the watch's refreshSummary stuck on "Syncing your
  // cases..." with no error surfaced. Select the real columns and
  // synthesize a human-readable `jurisdiction` string for API
  // consumers below.
  let query = admin
    .from('cases')
    .select(
      'id, title, subject_name, subject_type, case_type, posture, status, jurisdiction_country, jurisdiction_state, jurisdiction_city, hearing_at, created_at, updated_at',
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

  type Row = {
    id: string;
    title: string;
    subject_name: string;
    subject_type: string;
    case_type: string;
    posture: string;
    status: string;
    jurisdiction_country: string | null;
    jurisdiction_state: string | null;
    jurisdiction_city: string | null;
    hearing_at: string | null;
    created_at: string;
    updated_at: string;
  };
  // Reconstruct `jurisdiction` (the field old API consumers + the
  // wear app's mapAndSave both look for) from the three columns.
  // City + state + country, comma-joined, blanks stripped.
  const cases = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    subject_name: r.subject_name,
    subject_type: r.subject_type,
    case_type: r.case_type,
    posture: r.posture,
    status: r.status,
    jurisdiction: [
      r.jurisdiction_city,
      r.jurisdiction_state,
      r.jurisdiction_country,
    ]
      .filter(Boolean)
      .join(', '),
    jurisdiction_country: r.jurisdiction_country,
    jurisdiction_state: r.jurisdiction_state,
    jurisdiction_city: r.jurisdiction_city,
    hearing_at: r.hearing_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({
    cases,
    pagination: { total: count ?? 0, limit, offset },
  });
}
