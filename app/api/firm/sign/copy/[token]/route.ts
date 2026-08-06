import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';
import {
  SIGNER_COPY_REFUSAL_COPY,
  parseSignerDownloadPermission,
  resolveSignerCopyAccess,
} from '@/lib/signer-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/firm/sign/copy/[token]
 *
 * The signer's copy of what they signed. E-SIGN at 15 USC 7001(a)(1)
 * conditions the validity of an electronic record on the person bound
 * by it being able to retain it, so this exists by default and the
 * firm turns it off per request rather than opting in.
 *
 * This IS the gate. The /sign page hides the download link when the
 * firm has turned it off, but hiding is not a gate: the token is the
 * only credential on this surface and anyone holding the link can call
 * this route directly. So the same decision runs here, over the row,
 * before a byte is read. The decision itself is
 * resolveSignerCopyAccess in lib/signer-view.ts, unit-tested there.
 *
 * The bytes are streamed through this route rather than answered with
 * a redirect to a storage signature, so no storage URL is handed out
 * on the download path at all.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = String(params.token ?? '').trim();
  if (!token) return refuse(404, 'This link is not valid.');

  const admin = createAdminSupabase();
  if (!admin) return refuse(500, 'The document store is not reachable.');

  const { data: sigRow } = await admin
    .from('firm_signatures')
    .select(
      'id, signing_request_id, signer_email, signed_at, access_code_hash, access_code_verified_at',
    )
    .eq('token', token)
    .maybeSingle();
  if (!sigRow) return refuse(404, 'This link is not valid.');
  const sig = sigRow as {
    id: string;
    signing_request_id: string;
    signer_email: string | null;
    signed_at: string | null;
    access_code_hash: string | null;
    access_code_verified_at: string | null;
  };

  const { data: reqRow } = await admin
    .from('firm_signing_requests')
    .select('*')
    .eq('id', sig.signing_request_id)
    .maybeSingle();
  if (!reqRow) return refuse(404, 'This link is not valid.');
  const request = reqRow as {
    id: string;
    document_id: string;
    status: string;
    document_sha256?: string | null;
    signed_file_path?: string | null;
    signer_can_download?: boolean | null;
  };

  const { data: docRow } = await admin
    .from('firm_documents')
    .select('name, file_path, signable_file_path')
    .eq('id', request.document_id)
    .maybeSingle();
  const doc = docRow as {
    name?: string | null;
    file_path?: string | null;
    signable_file_path?: string | null;
  } | null;

  const access = resolveSignerCopyAccess({
    downloadPermitted: parseSignerDownloadPermission(request.signer_can_download),
    signedAt: sig.signed_at,
    requestStatus: request.status,
    accessCodeRequired: Boolean(sig.access_code_hash),
    accessVerifiedAt: sig.access_code_verified_at,
    signedFilePath: request.signed_file_path ?? null,
    sourceFilePath: doc?.signable_file_path || doc?.file_path || null,
  });
  if (!access.allowed) {
    // 403 for a refusal we mean; 404 for a link that should not be
    // teaching anyone anything about the request behind it.
    const status = access.reason === 'code-required' ? 404 : 403;
    return refuse(status, SIGNER_COPY_REFUSAL_COPY[access.reason]);
  }

  const { data: blob, error } = await admin.storage
    .from('firm-documents')
    .download(access.path);
  if (error || !blob) {
    return refuse(404, SIGNER_COPY_REFUSAL_COPY.unavailable);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const base = sanitizeFilename(doc?.name ?? 'document');
  const filename =
    access.kind === 'executed' ? `${base} (executed).pdf` : `${base}.pdf`;

  // Record the retrieval in the chain. Retrieval of an executed
  // instrument is exactly the kind of thing this chain is kept to
  // evidence, and link_viewed is already written from this same
  // unauthenticated surface, so the precedent is set. Best-effort:
  // appendSignatureEvent swallows insert failures by design, so a
  // rejected write costs the event and not the download.
  try {
    await appendSignatureEvent(admin, {
      signingRequestId: request.id,
      signatureId: sig.id,
      eventType: 'copy_downloaded',
      signerEmail: sig.signer_email,
      documentSha256: request.document_sha256 ?? null,
      ipAddress:
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        null,
      userAgent: req.headers.get('user-agent') ?? null,
      metadata: { kind: access.kind, path: access.path, bytes: bytes.length },
    });
  } catch {
    /* never block a signer's own copy on audit logging */
  }

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Nothing here belongs in a shared cache, and the signer's own
      // browser should re-ask so a revoked permission takes effect.
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Refusals come back as plain text, not JSON, because the only client
 * is a link the signer clicked: whatever this returns is what they
 * read. The wording is the calm wording from SIGNER_COPY_REFUSAL_COPY.
 */
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

/** Keep a firm's document name usable as a filename without rewriting it. */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/\.pdf$/i, '')
    .split('')
    .map((ch) => (isReservedFilenameChar(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 80) || 'document';
}

/** Path separators, the Windows-reserved set, and control bytes. */
function isReservedFilenameChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 32 || code === 127) return true;
  return '\\/:*?"<>|'.includes(ch);
}
