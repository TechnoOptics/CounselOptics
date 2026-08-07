import 'server-only';
import crypto from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';
import {
  projectSignerConsentMetadata,
  type SignerConsentPayload,
} from '@/lib/signer-view';
import { SIGNER_ALREADY_SIGNED_SENTENCE } from '@/lib/signer-retention';

/**
 * The one function that records a signature.
 *
 * It was the body of app/api/firm/sign/route.ts until a second device
 * needed to do the same thing. A signer can now finish on their phone
 * after starting on their laptop, and the two paths must not be able to
 * disagree about what a signature record contains: the same guards, the
 * same storage path, the same columns, the same audit event. Two copies
 * of this that drift is not an inconvenience, it is a compliance
 * problem, because the answer to "what does a signed row mean here"
 * would depend on which device happened to submit.
 *
 * So both routes call this, and neither has a write of its own.
 *
 * The signature row is found here, from a locator, rather than passed
 * in already loaded. The desktop holds the durable signer token; the
 * phone holds a consumed handoff that resolved to a signature id and
 * has no token at all, and must never be given one. Both are lookups
 * this function can do, and doing them here keeps the guards below on
 * the near side of every caller.
 */

export type SignatureSource = 'web' | 'mobile_handoff';

/**
 * How the signature row is found.
 *
 * 'id' is reachable only from a server that has already proved the
 * caller may act on that row. The phone route resolves it from a bound
 * handoff and never accepts one from a request body.
 */
export type SignatureLocator =
  | { kind: 'token'; token: string }
  | { kind: 'id'; signatureId: string };

export type RecordSignatureInput = {
  locator: SignatureLocator;
  /** PNG data URL from a canvas. */
  signatureDataUrl: string;
  typedName?: string | null;
  /** The UETA disclosure capture, when the submitting device holds it. */
  consent?: SignerConsentPayload | null;
  ip: string | null;
  userAgent: string | null;
  source: SignatureSource;
  /** The handoff this arrived on, when source is 'mobile_handoff'. */
  handoffId?: string | null;
};

/**
 * A refusal carries the status and the sentence the caller should send
 * back, so the two routes cannot answer the same refusal differently.
 */
export type RecordSignatureResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function recordSignature(
  input: RecordSignatureInput,
): Promise<RecordSignatureResult> {
  const dataUrl = input.signatureDataUrl;
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return { ok: false, status: 400, error: 'Missing or invalid fields.' };
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return {
      ok: false,
      status: 500,
      error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  // Find the signature row.
  //
  // The column list is written out rather than a select('*') because
  // this function runs on the phone path too. firm_signatures.token is
  // the durable signer credential, and access_code_hash is null for an
  // internal signer, so that token alone is enough to sign as them; a
  // select('*') pulled it into memory on a request that arrived from a
  // scanned code and had no business holding it. Nothing below reads
  // it, so it was never returned or logged, but the fix is to not
  // fetch it rather than to be careful with it afterwards.
  //
  // access_code_hash and access_code_verified_at are on this list
  // because the server-side gate below is the only thing enforcing the
  // one-time code. Dropping them from the list would silently pass
  // that gate on every request, so they are load-bearing, not
  // incidental. tests/signing-handoff-routes.test.ts pins both facts.
  const query = admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, signed_at, signer_email, access_code_hash, access_code_verified_at, response',
    );
  const { data: sigRow } =
    input.locator.kind === 'token'
      ? await query.eq('token', input.locator.token).maybeSingle()
      : await query.eq('id', input.locator.signatureId).maybeSingle();
  if (!sigRow) {
    return { ok: false, status: 404, error: 'Signing link not found.' };
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
  // Signed once, and once only.
  //
  // This is the first of two halves of that guarantee and it is the
  // cheap half: a row that already carries signed_at is refused before
  // anything is read or written. The expensive half is the conditional
  // claim further down, which is what holds when two requests get here
  // before either of them writes.
  //
  // The sentence is SIGNER_ALREADY_SIGNED_SENTENCE rather than a local
  // literal, because the terminal screen at /sign/[token] states the
  // same fact and the two must not drift. It says the document cannot
  // be signed again. It does NOT say the link is dead, expired or
  // deleted: the link keeps resolving on purpose, because it is the
  // signer's retention path under 15 USC 7001(a)(1), and lib/signer-
  // retention.ts is where how long it keeps resolving is decided.
  if (sig.signed_at) {
    return { ok: false, status: 410, error: SIGNER_ALREADY_SIGNED_SENTENCE };
  }
  // Enforce the one-time access-code gate SERVER-SIDE. The /sign page
  // renders a code gate before the signature pad, but that's only a
  // client affordance - without this check a forwarded/leaked link
  // could POST a signature directly and bypass the code entirely,
  // defeating the whole point of the dual link+OTP delivery (#5). When
  // a code was issued (access_code_hash set) it must have been verified
  // (access_code_verified_at set) first.
  //
  // The phone reaches this too. A handoff is minted only after the gate
  // is already satisfied on the laptop, so this should never fire on
  // that path, but a handoff must not become a way around the gate even
  // if the minting side is one day changed.
  if (sig.access_code_hash && !sig.access_code_verified_at) {
    return {
      ok: false,
      status: 403,
      error: 'Enter the access code from your email before signing.',
    };
  }
  // A signer who already declined or requested changes can't then sign
  // on the same link; the firm must send a fresh request.
  if (sig.response) {
    return {
      ok: false,
      status: 409,
      error: 'This signing link is on hold. Ask the firm for a new request.',
    };
  }

  // Pull the parent request to find the firm_id (used for the
  // storage path) and to update its rollup status afterwards.
  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('*')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  if (!reqRow) {
    return { ok: false, status: 404, error: 'Signing request not found.' };
  }
  const request = reqRow as {
    id: string;
    firm_id: string;
    document_id: string;
    status: 'draft' | 'sent' | 'partial' | 'completed' | 'canceled';
    document_sha256: string | null;
  };
  if (request.status === 'canceled') {
    return { ok: false, status: 410, error: 'Signing request was canceled.' };
  }
  // The same guarantee, one level up. The check above reads THIS
  // signature's own signed_at, which answers "has this person signed"
  // and not "is this instrument finished". A row added to a request
  // that already completed would pass it, and a signature landing on a
  // finished request means a second executed PDF and a second
  // document_sha256 for one instrument, which is the forked-chain
  // failure this repo already knows about from lib/esign-audit.ts.
  //
  // A completed request is one where every signature row carried
  // signed_at at the moment the rollup ran, so refusing here takes
  // nothing away from anybody who still had a turn.
  if (request.status === 'completed') {
    return { ok: false, status: 410, error: SIGNER_ALREADY_SIGNED_SENTENCE };
  }

  // Decode the PNG. The upload happens AFTER the claim below, not
  // before it, and the order is the point: the storage path is keyed on
  // the signature id and the upload is upsert, so a request that is
  // about to lose the claim would otherwise overwrite the winner's mark
  // with its own, and the executed copy would be stamped with an image
  // the audit chain does not describe.
  const base64 = dataUrl.split(',')[1] ?? '';
  const buffer = Buffer.from(base64, 'base64');
  const path = `${request.firm_id}/${request.id}/${sig.id}.png`;

  const ip = input.ip;
  const userAgent = input.userAgent;
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

  // Claim the row, conditionally.
  //
  // This is the second half of "signed once, and once only", and the
  // half that survives two requests arriving together. The guard near
  // the top of this function reads signed_at and the write used to set
  // it unconditionally, which leaves the ordinary time-of-check to
  // time-of-use window between them: a signer with a pad open on a
  // laptop and the same pad open on a handed-off phone can submit
  // both, both read null, both pass, and both write. The result is two
  // 'signed' events chained off one predecessor, which
  // lib/esign-audit.ts's verifier reads as tampering, plus two rollups
  // and two completion renders of one instrument.
  //
  // `.is('signed_at', null)` moves the decision into the database,
  // where the two updates are serialised whatever this process
  // believes. `.select()` is what makes the outcome readable: without
  // it supabase-js sends Prefer: return=minimal and resolves with data
  // null however many rows it touched, so a loser would look exactly
  // like a winner.
  //
  // The error is checked. PostgREST resolves rather than throws, so the
  // previous unchecked await would have swallowed a failed write and
  // gone on to append a 'signed' event for a signature that was never
  // recorded.
  const { data: claimed, error: claimErr } = await admin
    .from('firm_signatures')
    .update({
      signed_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: userAgent,
      signature_image_path: path,
      audit_hash: auditHash,
      signer_name: input.typedName?.trim() || undefined,
    })
    .eq('id', sig.id)
    .is('signed_at', null)
    .select('id');
  if (claimErr) {
    return { ok: false, status: 500, error: claimErr.message };
  }
  if (!claimed || claimed.length === 0) {
    // Somebody else got here first. Same sentence as the guard above,
    // because it is the same fact.
    return { ok: false, status: 410, error: SIGNER_ALREADY_SIGNED_SENTENCE };
  }

  // Only the winner writes the image, so the bytes at this path are the
  // bytes the row and the audit event describe.
  const { error: uploadErr } = await admin.storage
    .from('firm-signatures')
    .upload(path, buffer, {
      contentType: 'image/png',
      upsert: true,
    });
  if (uploadErr) {
    // Release the claim rather than leave a row recorded as signed with
    // no mark behind it. Without this the signer reads a 500, cannot
    // retry because their own row is now claimed, and the executed copy
    // renders against a missing image.
    await admin
      .from('firm_signatures')
      .update({
        signed_at: null,
        ip_address: null,
        user_agent: null,
        signature_image_path: null,
        audit_hash: null,
      })
      .eq('id', sig.id);
    return { ok: false, status: 500, error: uploadErr.message };
  }

  // Append the signed event to the audit chain. Hash chains to the
  // most recent prior event for this request (request_created from
  // when the firm sent the link, plus any link_viewed events when
  // the signer opened the page). The UETA consent capture rides
  // along inside metadata so the chain proves the electronic-records
  // disclosure was affirmed BEFORE the intent-to-sign, and that the
  // signer was shown the document and said they had read it. The
  // projection is projectSignerConsentMetadata, unit-tested in
  // lib/signer-view.ts, because a key silently missing from this
  // object is a piece of evidence that quietly does not exist.
  //
  // capture_source is written on every path, including the ordinary
  // web one, so a reader never has to infer the device from the
  // absence of a key. handoff_id is present only when a handoff
  // carried it, and points at the row holding that handoff's scan
  // time, IP and user agent.
  await appendSignatureEvent(admin, {
    signingRequestId: request.id,
    signatureId: sig.id,
    eventType: 'signed',
    signerEmail: sig.signer_email,
    signerName: input.typedName?.trim() || null,
    ipAddress: ip,
    userAgent,
    documentSha256: request.document_sha256,
    metadata: {
      signature_image_path: path,
      audit_hash: auditHash,
      image_bytes: buffer.length,
      consent: projectSignerConsentMetadata(input.consent),
      capture_source: input.source,
      ...(input.handoffId ? { handoff_id: input.handoffId } : {}),
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

      // The employee who filed this, and the legal team, are told by the
      // module that owns the join. It answers whether a template submission
      // produced this request, and it is the only thing that knows where an
      // employee's copy of this document lives.
      //
      // In its OWN try, inside this one, on purpose. Everything below is a
      // notice to a different set of people about the same fact, and one
      // party failing to be told must never silence the other. The outcome
      // describes the RECORD, not the delivery: it stays 'backed' even if
      // nobody could be reached, because the question it answers for the
      // loop below is "where does this employee's link point", and that does
      // not change because an insert failed.
      const { notifySubmissionCompletion, signerNoticeRecipients } = await import(
        '@/lib/submission-completion'
      );
      let submissionBacked: { submittedBy: string } | null = null;
      try {
        const outcome = await notifySubmissionCompletion(admin, request.id);
        if (outcome.backed) submissionBacked = { submittedBy: outcome.submittedBy };
      } catch {
        /* the submission notice is best effort and does not take the rest with it */
      }

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
        //
        // The colleague who filed this, if anybody did, is not in this list:
        // the link below is the consumer inbox and they have already been
        // told on their own surface. See signerNoticeRecipients.
        await Promise.all(
          signerNoticeRecipients(Array.from(matchedIds), submissionBacked).map((userId) =>
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

  return { ok: true };
}
