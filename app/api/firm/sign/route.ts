import { NextResponse, type NextRequest } from 'next/server';
import { recordSignature } from '@/lib/signature-write';
import { type SignerConsentPayload } from '@/lib/signer-view';

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
 *       documentPresented?: boolean,
 *       documentReviewedAt?: string,
 *       intentAffirmedAt?: string,
 *       uaSnapshot?: string | null,
 *       tzOffsetMinutes?: number,
 *     }
 *   }
 *
 * Everything after the body parse is lib/signature-write.ts, which is
 * also what the phone route calls. This route's job is now exactly the
 * part that is specific to it: reading the durable signer token out of
 * the request. The guards, the storage write, the columns and the
 * audit event are shared, so a signature made on a laptop and one made
 * on a phone are the same record made the same way.
 */
export async function POST(req: NextRequest) {
  let payload: {
    token?: string;
    signatureDataUrl?: string;
    typedName?: string | null;
    consent?: SignerConsentPayload;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const token = String(payload.token ?? '').trim();
  const dataUrl = String(payload.signatureDataUrl ?? '');
  if (!token) {
    return NextResponse.json({ error: 'Missing or invalid fields.' }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;

  const result = await recordSignature({
    locator: { kind: 'token', token },
    signatureDataUrl: dataUrl,
    typedName: payload.typedName ?? null,
    consent: payload.consent,
    ip,
    userAgent: req.headers.get('user-agent') ?? null,
    source: 'web',
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
