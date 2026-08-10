import { NextResponse, type NextRequest } from 'next/server';
import {
  MARK_HANDOFF_COOKIE,
  storeMarkForHandoff,
} from '@/lib/mark-handoff-queries';
import { markHandoffRefusal } from '@/lib/mark-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/firm/mark
 *
 * The employee's phone handing its drawing back. Body:
 *   {
 *     handoffToken: string,     // the one in the address bar
 *     signatureDataUrl: string, // PNG data URL from the pad
 *     intentAffirmedAt?: string,
 *   }
 *
 * This endpoint files nothing and signs nothing. It stores one picture against
 * one handoff row, and the desk session, which is the authenticated party,
 * remains the only thing that can submit a document. That is the whole
 * difference between this and /api/firm/sign/mobile: the outside signer's
 * phone completes a signature because that signer has no other device in the
 * ceremony, and this phone must not, because the employee's desk is holding a
 * session that a photographed QR must never become a second copy of.
 *
 * There is deliberately no handoff id, no firm id, no user id and no template
 * id in that body, and none is read from it. The row is resolved from the
 * token in the address bar together with the httpOnly cookie issued to the
 * device that claimed it, so a body naming its own row would be ignored.
 *
 * Nothing here reads anything back to the caller. A phone that has posted its
 * mark cannot fetch it again, cannot see the form, and cannot see who the
 * employee is beyond the name already printed on the pad it was given.
 */
export async function POST(req: NextRequest) {
  let payload: {
    handoffToken?: string;
    signatureDataUrl?: string;
    intentAffirmedAt?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const handoffToken = String(payload.handoffToken ?? '').trim();
  if (!handoffToken) {
    return NextResponse.json(
      { error: 'Missing or invalid fields.' },
      { status: 400 },
    );
  }

  const result = await storeMarkForHandoff({
    rawToken: handoffToken,
    presentedSessionSecret: req.cookies.get(MARK_HANDOFF_COOKIE)?.value ?? null,
    signatureDataUrl: payload.signatureDataUrl,
    intentAffirmedAt: payload.intentAffirmedAt,
  });

  if (!result.ok) {
    // A used code, an expired one and a different device are one sentence, for
    // the same reason they are on the signer's phone: a stranger who
    // photographed a screen must not be able to tell them apart. A malformed
    // image is a different kind of problem and says so, because only the
    // bound phone can ever reach that branch.
    return 'state' in result
      ? NextResponse.json({ error: markHandoffRefusal(result.state) }, { status: 403 })
      : NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
