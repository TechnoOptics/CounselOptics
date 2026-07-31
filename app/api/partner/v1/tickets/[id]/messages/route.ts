import { NextResponse } from 'next/server';
import {
  authenticatePartner,
  partnerRateLimit,
  postPartnerTicketMessage,
} from '@/lib/partner-tickets';

export const runtime = 'nodejs';

/** POST /api/partner/v1/tickets/:id/messages: employee reply into the
 *  intake thread the legal team already works in. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticatePartner(req.headers.get('authorization'));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!(await partnerRateLimit(auth.auth.firmId, 'message'))) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const b = (body ?? {}) as { employeeEmail?: string; text?: string };
  if (!b.employeeEmail) return NextResponse.json({ error: 'employeeEmail is required.' }, { status: 400 });
  const res = await postPartnerTicketMessage(auth.auth, params.id, {
    employeeEmail: b.employeeEmail,
    text: b.text ?? '',
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ticket: res.ticket });
}
