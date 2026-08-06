import { NextResponse, type NextRequest } from 'next/server';
import { HANDOFF_COOKIE, loadBoundHandoff } from '@/lib/signing-handoff-queries';
import { handoffRefusalMessage } from '@/lib/signing-handoff';
import { recordSignature } from '@/lib/signature-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/firm/sign/mobile
 *
 * The phone half of the ceremony submits here. Body:
 *   {
 *     handoffToken: string,       // the one in the address bar
 *     signatureDataUrl: string,   // PNG data URL from the pad
 *     intentAffirmedAt?: string,
 *     tzOffsetMinutes?: number,
 *   }
 *
 * There is deliberately no signature id in that list, and none is read
 * from the body. The id comes from loadBoundHandoff, which will only
 * return one when the token is live, unconsumed by anyone else, inside
 * both windows, and presented together with the cookie issued to the
 * phone that claimed it. A body that named its own signature row would
 * turn a scanned code into a way to sign somebody else's document.
 *
 * The write itself is lib/signature-write.ts, the same function
 * /api/firm/sign calls, so a signature made here is the same record,
 * made the same way, with the same guards in front of it.
 */
export async function POST(req: NextRequest) {
  let payload: {
    handoffToken?: string;
    signatureDataUrl?: string;
    intentAffirmedAt?: string;
    tzOffsetMinutes?: number;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const handoffToken = String(payload.handoffToken ?? '').trim();
  if (!handoffToken) {
    return NextResponse.json({ error: 'Missing or invalid fields.' }, { status: 400 });
  }

  const cookie = req.cookies.get(HANDOFF_COOKIE)?.value ?? null;
  const bound = await loadBoundHandoff(handoffToken, cookie);
  if (!bound.ok) {
    // The same sentence the pad page shows, for the same reason: a used
    // code, an expired one and a different device must be impossible to
    // tell apart from out here.
    return NextResponse.json(
      { error: handoffRefusalMessage(bound.state) },
      { status: 403 },
    );
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent') ?? null;

  const result = await recordSignature({
    locator: { kind: 'id', signatureId: bound.signatureId },
    signatureDataUrl: String(payload.signatureDataUrl ?? ''),
    // The pad has no name field. Whatever the firm recorded for this
    // signer stays as it is rather than being overwritten from a phone.
    typedName: null,
    // Only what this device can honestly attest to. The disclosure
    // consent and the confirmation that the document was read happened
    // on the laptop, and the laptop's own submit never runs on this
    // path, so they are not asserted here rather than being copied
    // across as though the phone had collected them. documentPresented
    // is false because it is: the phone shows a pad, not the document.
    // Read beside capture_source in the audit metadata, which names the
    // mobile handoff, the pair says what actually happened.
    consent: {
      intentAffirmedAt: payload.intentAffirmedAt,
      uaSnapshot: userAgent,
      tzOffsetMinutes: payload.tzOffsetMinutes,
      documentPresented: false,
    },
    ip,
    userAgent,
    source: 'mobile_handoff',
    handoffId: bound.handoffId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
