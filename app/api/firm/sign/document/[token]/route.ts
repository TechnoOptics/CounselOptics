import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';
import { getSignatureByToken } from '@/lib/firm-storage';
import {
  SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY,
  SIGNER_DOCUMENT_REFUSAL_COPY,
  classifyDocumentRequestPurpose,
  resolveDocumentSizeAcceptance,
  resolveDocumentSizeRefusal,
  resolveSignerDocumentAccess,
  resolveSignerDocumentDelivery,
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
 *
 * Two decisions run, not one, and they answer different questions.
 * resolveSignerDocumentAccess asks whether this token may see this
 * document at all. resolveSignerDocumentDelivery then asks whether the
 * firm's per-request download decision withholds it FROM THIS REQUEST,
 * which is a narrower question on purpose: the rasteriser cannot draw a
 * page without the file, so refusing the signing page's own fetch would
 * mean nobody could read what they are being asked to sign. The
 * permission therefore closes the browser-viewer path and leaves the
 * render path open. The reasoning, and what it does not achieve, is
 * written out beside the function.
 */
export async function GET(
  req: NextRequest,
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

  // The firm's decision, enforced here rather than only on the button
  // that offers the file. Fetch Metadata is what separates the signing
  // page's own render fetch from a browser pointed at this URL; the
  // headers are set by the browser and cannot be written by page
  // script. A request that states nothing is served, because the
  // signer on an older Safari has to be able to read the document.
  const purpose = classifyDocumentRequestPurpose({
    secFetchDest: req.headers.get('sec-fetch-dest'),
    secFetchMode: req.headers.get('sec-fetch-mode'),
  });
  const delivery = resolveSignerDocumentDelivery({
    downloadPermitted: request.signerCanDownload,
    purpose,
  });
  if (!delivery.serve) {
    return refuse(403, SIGNER_DOCUMENT_DELIVERY_REFUSAL_COPY[delivery.reason]);
  }

  const admin = createAdminSupabase();
  if (!admin) return refuse(500, SIGNER_DOCUMENT_REFUSAL_COPY.unavailable);

  // Asked of the storage metadata BEFORE the bytes are pulled, which
  // is the only order in which the ceiling means anything here.
  // Downloading first and measuring after left a 500 MB stored file
  // entirely resident in the function before the refusal was written,
  // which is the thing the check was supposed to prevent. If storage
  // will not answer the question, the download below still measures
  // what arrived, so the ceiling holds either way; only the saving
  // is lost.
  const probe = await admin.storage.from('firm-documents').info(access.path);
  if (probe.data) {
    const probed = resolveDocumentSizeAcceptance(probe.data.size);
    if (probed !== 'ok') {
      const refusal = resolveDocumentSizeRefusal(probed);
      return refuse(refusal.status, refusal.message);
    }
  }

  const { data: blob, error } = await admin.storage
    .from('firm-documents')
    .download(access.path);
  if (error || !blob) {
    return refuse(404, SIGNER_DOCUMENT_REFUSAL_COPY.unavailable);
  }

  // Size is checked here as well as in the browser, and the two
  // refusals are the same table (lib/signer-view.ts) read from both
  // ends. They used to agree by accident and disagree in effect: an
  // empty stored file came back as 413, which the page read as "too
  // large", so a signer whose firm had uploaded a zero-byte document
  // was told the opposite of what had happened.
  const size = resolveDocumentSizeAcceptance(blob.size);
  if (size !== 'ok') {
    const refusal = resolveDocumentSizeRefusal(size);
    return refuse(refusal.status, refusal.message);
  }

  // The recipient pulled the file itself, and the people waiting on this
  // document are entitled to know that.
  //
  // Only the 'navigate' purpose is recorded. That is a browser pointed AT
  // this URL, which lands in its own PDF viewer with Save and Print on it,
  // and it is the request a person makes when they want the file rather
  // than the page. The signing page's own render fetch is 'render' and is
  // not a download by anyone's reading; 'unstated' is deliberately left out
  // too, because it covers Safari before 16.4 and a number of in-app
  // webviews doing exactly that render fetch, and reporting one of those to
  // a firm as "they downloaded it" would be an invented fact about a real
  // person. This therefore under-reports on purpose. The purpose is carried
  // on the event so a reader can see which question was answered.
  //
  // Written here rather than earlier so the event describes bytes that were
  // actually served: every refusal above returns before this line. Wrapped,
  // awaited and ignored, in the same spirit as appendSignatureEvent itself,
  // because a document must never fail to arrive over an audit write.
  if (purpose === 'navigate') {
    try {
      await appendSignatureEvent(admin, {
        signingRequestId: request.id,
        signatureId: signature.id,
        eventType: 'document_downloaded',
        signerEmail: signature.signerEmail,
        ipAddress:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          req.headers.get('x-real-ip') ||
          null,
        userAgent: req.headers.get('user-agent') ?? null,
        documentSha256:
          (request as { documentSha256?: string | null }).documentSha256 ?? null,
        metadata: { purpose, bytes: blob.size, path: access.path },
      });
    } catch {
      /* never fail a document delivery on audit logging */
    }
  }

  // The body is a stream over bytes this function already holds:
  // storage.download() materialises the whole file, so this saves the
  // copy into the response and nothing more. The size probe above is
  // what keeps a file past the ceiling from being materialised at all.
  return new NextResponse(blob.stream() as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(blob.size),
      // No filename, and never an attachment. This is the render
      // source, not the signer's copy: retention after signing goes
      // through the copy route, and the firm's download permission is
      // enforced on both, in the delivery check above and in
      // resolveSignerCopyAccess there.
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      // The body now depends on what the client said it wanted these
      // bytes for. Nothing should be caching a no-store response, but
      // an intermediary that does must not reuse a render answer for a
      // navigation.
      'Vary': 'Sec-Fetch-Dest, Sec-Fetch-Mode',
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
