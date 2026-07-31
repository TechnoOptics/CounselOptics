import { NextResponse } from 'next/server';
import { authenticatePartner, getPartnerTicket } from '@/lib/partner-tickets';

export const runtime = 'nodejs';

/** GET /api/partner/v1/tickets/:id: one ticket incl. the full thread. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authenticatePartner(req.headers.get('authorization'));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const res = await getPartnerTicket(auth.auth, params.id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ticket: res.ticket });
}
