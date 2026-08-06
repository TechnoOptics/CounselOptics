import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getSignatureByToken } from '@/lib/firm-storage';
import {
  SIGNER_DOCUMENT_REFUSAL_COPY,
  resolveDocumentSizeAcceptance,
  resolveSignerDocumentAccess,
} from '@/lib/signer-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/firm/sign/document/[token]
 *
 * The bytes of the document the signer is being asked to sign, served
 * from this origin.
 *
 * Why a route at all, when a signed storage URL already existed. The
 * signer page rasterises the PDF itself now, so the browser needs the
 * file rather than a viewer pointed at it, and everything the
 * rasteriser touches has to be same-origin: this page is
 * unauthenticated, its URL carries a live signing credential, and a
 * cross-origin fetch would put that document behind somebody else's
 * CORS policy and outside our own connect-src. Serving it here keeps
 * the storage signature where it was already being minted, on the
 * server, and means it never reaches the browser at all. The signing
 * token stays in the path rather than a query string, so it is not in
 * a Referer, a proxy log line, or a shared link's visible tail.
 *
 * This IS the gate. Anyone holding the link can call this route
 * directly, so the decision runs over the row before a byte is read,
 * and it is the same function the page calls
 * (resolveSignerDocumentAccess in lib/signer-view.ts, unit-tested
 * there) so the two cannot disagree.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = String(params.token ?? '').trim();
  if (!token) return refuse(404, 'This link is not valid.');

  const data = await getSignatureByToken(token);
  if (!data) return refuse(404, 'This link is not valid.');
  const { signature, request, document } = data;

  const access = resolveSignerDocumentAccess({
    accessCodeRequired: signature.accessCodeRequired,
    accessVerifiedAt: signature.accessVerifiedAt,
    requestStatus: request.status,
    signedAt: signature.signedAt,
    signerResponse: signature.response,
    sourceFilePath: document.signableFilePath || document.filePath || null,
  });
  if (!access.allowed) {
    // 404 for anything that should not teach a link-holder about the
    // request behind it; 403 for a refusal we mean the signer to read.
    const status = access.reason === 'code-required' ? 404 : 403;
    return refuse(status, SIGNER_DOCUMENT_REFUSAL_COPY[access.reason]);
  }

  const admin = createAdminSupabase();
  if (!admin) return refuse(500, SIGNER_DOCUMENT_REFUSAL_COPY.unavailable);

  const { data: blob, error } = await admin.storage
    .from('firm-documents')
    .download(access.path);
  if (error || !blob) {
    return refuse(404, SIGNER_DOCUMENT_REFUSAL_COPY.unavailable);
  }

  // Size is checked here as well as in the browser. The browser's
  // check is what produces a readable message; this one is what stops
  // a serverless function pulling a file it has no business buffering.
  const size = resolveDocumentSizeAcceptance(blob.size);
  if (size !== 'ok') {
    return refuse(
      413,
      size === 'empty'
        ? SIGNER_DOCUMENT_REFUSAL_COPY.unavailable
        : 'This document is too large to open on this page. The firm can send you a copy.',
    );
  }

  // Streamed rather than buffered, so a large agreement does not sit
  // in the function's heap on its way to the reader.
  return new NextResponse(blob.stream() as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(blob.size),
      // No filename. This is the render source, not the signer's copy:
      // retention after signing goes through the copy route, which is
      // where the firm's download permission is enforced.
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      // Whole-file responses only. Range requests would need the
      // storage layer to support them end to end, and pdf.js falls
      // back to a single fetch when they are refused.
      'Accept-Ranges': 'none',
    },
  });
}

/** Refusals come back as plain text: the only client is a link the
 *  signer may have clicked, so whatever this returns is what they read. */
function refuse(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
