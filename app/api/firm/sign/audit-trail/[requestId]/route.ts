import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { verifySignatureChain } from '@/lib/esign-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/firm/sign/audit-trail/{requestId}
 *
 * Firm-member-gated audit trail for a signing request. Returns:
 *   - The chain verification result (ok / brokenAt + reason)
 *   - The full event log for the request
 *   - The document hash captured at request creation time
 *
 * Used by the firm-side signing-request detail page to render a
 * "DRAFT - NOT LEGALLY BINDING" companion that proves the integrity
 * of the signing flow even before the watermark drops.
 *
 * Caller must be a member of the firm that owns the request. RLS on
 * firm_signature_events enforces the same gate at the row level for
 * SELECTs, but the chain verification needs the service role to read
 * every event regardless of cache strangeness, so we explicitly check
 * membership here too.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: { requestId: string } },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const supabase = createServerSupabase();
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Service role not configured.' },
      { status: 500 },
    );
  }

  // Membership gate. supabase (user-scoped) goes through RLS on
  // firm_signing_requests, which is already member-gated.
  const { data: req } = await supabase
    .from('firm_signing_requests')
    .select(
      'id, firm_id, document_id, document_sha256, status, sent_at, completed_at',
    )
    .eq('id', ctx.params.requestId)
    .maybeSingle();
  if (!req) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const request = req as {
    id: string;
    firm_id: string;
    document_id: string;
    document_sha256: string | null;
    status: string;
    sent_at: string | null;
    completed_at: string | null;
  };

  const verification = await verifySignatureChain(admin, request.id);

  // Pull every event for the timeline. The chain verifier already
  // walked these but did not return them; we fetch one more time so
  // the response includes the timeline directly.
  const { data: events } = await admin
    .from('firm_signature_events')
    .select(
      'id, event_type, signer_email, signer_name, ip_address, user_agent, document_sha256, prev_event_hash, event_hash, metadata, created_at',
    )
    .eq('signing_request_id', request.id)
    .order('created_at', { ascending: true });

  // Per-signer rollup so the firm can read names + sign timestamps
  // without joining the events array client-side.
  const { data: sigs } = await admin
    .from('firm_signatures')
    .select('id, signer_email, signer_name, signed_at, audit_hash')
    .eq('signing_request_id', request.id)
    .order('signed_at', { ascending: true, nullsFirst: false });

  return NextResponse.json({
    request: {
      id: request.id,
      firm_id: request.firm_id,
      document_id: request.document_id,
      document_sha256: request.document_sha256,
      status: request.status,
      sent_at: request.sent_at,
      completed_at: request.completed_at,
    },
    chain: verification,
    events: events ?? [],
    signatures: sigs ?? [],
    disclaimer:
      'Technical audit trail only. Output PDFs remain watermarked "DRAFT - NOT LEGALLY BINDING" until an attorney has reviewed this implementation against UETA / E-SIGN requirements for the relying party\'s jurisdiction.',
  });
}
