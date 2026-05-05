import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/firm/sign
 *
 * Public endpoint for the in-app sign flow. Body:
 *   {
 *     token: string,                  // from /sign/[token]
 *     signatureDataUrl: string,       // PNG data URL from canvas
 *     typedName?: string | null
 *   }
 *
 * On success: writes the signature image to the firm-signatures
 * bucket, fills firm_signatures.signed_at + ip + user_agent + audit
 * hash, and updates the parent request's status (sent -> partial or
 * completed depending on whether all signers are done).
 *
 * v1 disclaimer: the audit_hash is informational. Real UETA-compliant
 * signature work (identity attestation, hash chain across signers,
 * archival of unsigned + signed PDF, retention metadata) lands in a
 * follow-on session.
 */
export async function POST(req: NextRequest) {
  let payload: {
    token?: string;
    signatureDataUrl?: string;
    typedName?: string | null;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const token = String(payload.token ?? '').trim();
  const dataUrl = String(payload.signatureDataUrl ?? '');
  if (!token || !dataUrl.startsWith('data:image/png;base64,')) {
    return NextResponse.json({ error: 'Missing or invalid fields.' }, { status: 400 });
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }

  // Find the signature row.
  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  if (!sigRow) {
    return NextResponse.json({ error: 'Signing link not found.' }, { status: 404 });
  }
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signed_at: string | null;
    signer_email: string;
  };
  if (sig.signed_at) {
    return NextResponse.json(
      { error: 'This link has already been signed.' },
      { status: 410 },
    );
  }

  // Pull the parent request to find the firm_id (used for the
  // storage path) and to update its rollup status afterwards.
  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('*')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  if (!reqRow) {
    return NextResponse.json({ error: 'Signing request not found.' }, { status: 404 });
  }
  const request = reqRow as {
    id: string;
    firm_id: string;
    document_id: string;
    status: 'draft' | 'sent' | 'partial' | 'completed' | 'canceled';
    document_sha256: string | null;
  };
  if (request.status === 'canceled') {
    return NextResponse.json(
      { error: 'Signing request was canceled.' },
      { status: 410 },
    );
  }

  // Decode the PNG and upload to firm-signatures bucket.
  const base64 = dataUrl.split(',')[1] ?? '';
  const buffer = Buffer.from(base64, 'base64');
  const path = `${request.firm_id}/${request.id}/${sig.id}.png`;
  const { error: uploadErr } = await admin.storage
    .from('firm-signatures')
    .upload(path, buffer, {
      contentType: 'image/png',
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') ?? null;
  const auditHash = crypto
    .createHash('sha256')
    .update(
      [
        sig.id,
        request.id,
        sig.signer_email.toLowerCase(),
        ip ?? '',
        userAgent ?? '',
        new Date().toISOString(),
        buffer.length.toString(),
      ].join('|'),
    )
    .digest('hex');

  await admin
    .from('firm_signatures')
    .update({
      signed_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: userAgent,
      signature_image_path: path,
      audit_hash: auditHash,
      signer_name: payload.typedName?.trim() || undefined,
    })
    .eq('id', sig.id);

  // Append the signed event to the audit chain. Hash chains to the
  // most recent prior event for this request (request_created from
  // when the firm sent the link, plus any link_viewed events when
  // the signer opened the page).
  await appendSignatureEvent(admin, {
    signingRequestId: request.id,
    signatureId: sig.id,
    eventType: 'signed',
    signerEmail: sig.signer_email,
    signerName: payload.typedName?.trim() || null,
    ipAddress: ip,
    userAgent,
    documentSha256: request.document_sha256,
    metadata: {
      signature_image_path: path,
      audit_hash: auditHash,
      image_bytes: buffer.length,
    },
  });

  // Roll up parent request status.
  const { data: allSigs } = await admin
    .from('firm_signatures')
    .select('signed_at')
    .eq('signing_request_id', request.id);
  const total = allSigs?.length ?? 0;
  const signed = (allSigs ?? []).filter(
    (r) => Boolean((r as { signed_at: string | null }).signed_at),
  ).length;
  let nextStatus: 'partial' | 'completed' | 'sent';
  if (total === 0) nextStatus = 'sent';
  else if (signed >= total) nextStatus = 'completed';
  else nextStatus = 'partial';

  const updates: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === 'completed') updates.completed_at = new Date().toISOString();
  await admin.from('firm_signing_requests').update(updates).eq('id', request.id);

  // If everyone has signed, emit the closing 'completed' event so
  // the audit trail terminates cleanly.
  if (nextStatus === 'completed') {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      eventType: 'completed',
      documentSha256: request.document_sha256,
      metadata: { total_signers: total, signed: signed },
    });
  }

  return NextResponse.json({ ok: true });
}
