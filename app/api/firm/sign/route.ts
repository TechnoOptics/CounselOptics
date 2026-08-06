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
 *     typedName?: string | null,
 *     consent?: {                     // UETA disclosure capture
 *       electronicRecordsConsentedAt?: string,
 *       hardwareSoftwareConfirmedAt?: string,
 *       intentAffirmedAt?: string,
 *       uaSnapshot?: string | null,
 *       tzOffsetMinutes?: number,
 *     }
 *   }
 *
 * On success: writes the signature image to the firm-signatures
 * bucket, fills firm_signatures.signed_at + ip + user_agent + audit
 * hash, and updates the parent request's status (sent -> partial or
 * completed depending on whether all signers are done). The consent
 * payload is persisted in the audit chain metadata so a later
 * verifier can see the signer affirmed the electronic-records
 * disclosure separately from the intent-to-sign.
 */
export async function POST(req: NextRequest) {
  let payload: {
    token?: string;
    signatureDataUrl?: string;
    typedName?: string | null;
    consent?: {
      electronicRecordsConsentedAt?: string;
      hardwareSoftwareConfirmedAt?: string;
      intentAffirmedAt?: string;
      uaSnapshot?: string | null;
      tzOffsetMinutes?: number;
    };
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
    access_code_hash: string | null;
    access_code_verified_at: string | null;
    response: 'rejected' | 'changes_requested' | null;
  };
  if (sig.signed_at) {
    return NextResponse.json(
      { error: 'This link has already been signed.' },
      { status: 410 },
    );
  }
  // Enforce the one-time access-code gate SERVER-SIDE. The /sign page
  // renders a code gate before the signature pad, but that's only a
  // client affordance - without this check a forwarded/leaked link
  // could POST a signature directly and bypass the code entirely,
  // defeating the whole point of the dual link+OTP delivery (#5). When
  // a code was issued (access_code_hash set) it must have been verified
  // (access_code_verified_at set) first.
  if (sig.access_code_hash && !sig.access_code_verified_at) {
    return NextResponse.json(
      { error: 'Enter the access code from your email before signing.' },
      { status: 403 },
    );
  }
  // A signer who already declined or requested changes can't then sign
  // on the same link; the firm must send a fresh request.
  if (sig.response) {
    return NextResponse.json(
      { error: 'This signing link is on hold. Ask the firm for a new request.' },
      { status: 409 },
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
  // the signer opened the page). The UETA consent capture rides
  // along inside metadata so the chain proves the electronic-records
  // disclosure was affirmed BEFORE the intent-to-sign.
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
      consent: payload.consent
        ? {
            electronic_records_consented_at:
              payload.consent.electronicRecordsConsentedAt ?? null,
            hardware_software_confirmed_at:
              payload.consent.hardwareSoftwareConfirmedAt ?? null,
            intent_affirmed_at: payload.consent.intentAffirmedAt ?? null,
            ua_snapshot: payload.consent.uaSnapshot ?? null,
            tz_offset_minutes:
              typeof payload.consent.tzOffsetMinutes === 'number'
                ? payload.consent.tzOffsetMinutes
                : null,
          }
        : null,
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
  // the audit trail terminates cleanly, render the executed PDF
  // (stamps every signer's captured PNG onto the source document at
  // the recorded coordinates - see lib/signature-render.ts), and
  // notify every signer plus the firm member who created the
  // request that the doc is fully executed.
  if (nextStatus === 'completed') {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      eventType: 'completed',
      documentSha256: request.document_sha256,
      metadata: { total_signers: total, signed: signed },
    });

    // Render the executed PDF. Wrapped in try/catch so a renderer
    // failure (encrypted source PDF, missing PNG, storage hiccup)
    // doesn't break the completion happy path - the underlying
    // signature rows still hold the immutable PNGs, and the
    // renderer can be safely re-run later from an admin tool.
    //
    // The RETURNED failure is recorded too. Most of the ways this
    // render can fail (source PDF missing from storage, unparseable
    // PDF, upload rejected) return { ok: false } rather than throwing,
    // so the catch below never saw them: the request flipped to
    // completed, everyone was told the document was fully executed,
    // and nothing anywhere said why signed_file_path was empty. The
    // counsel surfaces now state the missing executed copy to the
    // reader; this is the same fact for the audit trail.
    //
    // Two of those failures append their own event, with metadata this
    // one does not have. shouldLogRenderFailure is what keeps the
    // chain from carrying two entries for one fact.
    try {
      const { renderFinalSignedPdf, shouldLogRenderFailure } = await import(
        '@/lib/signature-render'
      );
      const render = await renderFinalSignedPdf(admin, request.id);
      if (shouldLogRenderFailure(render)) {
        await appendSignatureEvent(admin, {
          signingRequestId: request.id,
          eventType: 'final_pdf_render_failed',
          documentSha256: request.document_sha256,
          metadata: { error: render.error },
        }).catch(() => {});
      }
    } catch (err) {
      // Best-effort surface to the audit chain so reviewers see why
      // there's no signed_file_path on the request row.
      await appendSignatureEvent(admin, {
        signingRequestId: request.id,
        eventType: 'final_pdf_render_failed',
        documentSha256: request.document_sha256,
        metadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => {});
    }

    try {
      const { createNotification } = await import('@/lib/notifications');
      // Pull the document name + the firm member who created the
      // request so we can populate the notification body cleanly.
      const { data: docRow } = await admin
        .from('firm_documents')
        .select('name')
        .eq('id', request.document_id)
        .maybeSingle();
      const docName =
        (docRow as { name?: string } | null)?.name ?? 'Document';
      const { data: reqRow2 } = await admin
        .from('firm_signing_requests')
        .select('requested_by')
        .eq('id', request.id)
        .maybeSingle();
      const requestedBy =
        (reqRow2 as { requested_by?: string } | null)?.requested_by ?? null;

      // Notify every signer that the document is fully executed.
      // Previously this called listUsers({page:1, perPage:200}) which
      // missed every user beyond row 200 in a multi-tenant project -
      // reviewer caught this. Look up the user ids by email directly
      // against the profiles table (with auth.users as a cold-start
      // fallback for OAuth users whose profile row hasn't been
      // written yet).
      const { data: allSignerRows } = await admin
        .from('firm_signatures')
        .select('signer_email')
        .eq('signing_request_id', request.id);
      const emails = Array.from(
        new Set(
          ((allSignerRows ?? []) as { signer_email: string }[])
            .map((r) => r.signer_email?.toLowerCase())
            .filter(Boolean),
        ),
      );
      if (emails.length > 0) {
        const { data: profileRows } = await admin
          .from('profiles')
          .select('id, email')
          .in('email', emails);
        const matchedIds = new Set<string>(
          ((profileRows ?? []) as { id: string; email: string | null }[])
            .map((p) => p.id)
            .filter(Boolean),
        );
        // Cold-start fallback for emails that didn't match a profile
        // row (rare but possible during OAuth onboarding).
        const matchedEmails = new Set(
          ((profileRows ?? []) as { email: string | null }[])
            .map((p) => p.email?.toLowerCase())
            .filter(Boolean),
        );
        const stillUnknown = emails.filter((e) => !matchedEmails.has(e));
        if (stillUnknown.length > 0) {
          const { data: authRows } = await admin
            .schema('auth')
            .from('users')
            .select('id, email')
            .in('email', stillUnknown);
          for (const row of (authRows ?? []) as { id: string }[]) {
            if (row.id) matchedIds.add(row.id);
          }
        }
        // Fan the completion notices out concurrently rather than one
        // sequential DB round-trip per signer. (Audit 2026-07-03, perf.)
        await Promise.all(
          Array.from(matchedIds).map((userId) =>
            createNotification({
              userId,
              type: 'signing_request_completed',
              title: `Fully executed: ${docName}`,
              body: 'All signers have completed their signatures.',
              link: '/inbox/documents',
            }),
          ),
        );
      }
      // Notify the firm member who initiated the request.
      if (requestedBy) {
        await createNotification({
          userId: requestedBy,
          type: 'signing_request_completed',
          title: `Fully executed: ${docName}`,
          body: 'All signers on the request you sent have completed.',
          link: '/counsel/signing',
        });
      }
    } catch {
      /* notifications are best-effort */
    }
  }

  return NextResponse.json({ ok: true });
}
