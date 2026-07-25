import { NextResponse } from 'next/server';
import {
  authenticatePartner,
  createPartnerTicket,
  listPartnerTickets,
  partnerRateLimit,
} from '@/lib/partner-tickets';

export const runtime = 'nodejs';

/**
 * Partner ticketing API (v1) — see docs/ZINPRO_INTEGRATION.md.
 *
 *   POST /api/partner/v1/tickets   create a ticket (JIT-provisions the employee)
 *   GET  /api/partner/v1/tickets   list tickets (?employeeEmail= to scope)
 *
 * Auth: `Authorization: Bearer adv_...` — a FIRM-scoped api_tokens token with
 * the `write` scope. All access is confined to that firm.
 */
export async function POST(req: Request) {
  const auth = await authenticatePartner(req.headers.get('authorization'));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!(await partnerRateLimit(auth.auth.firmId, 'ticket'))) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const b = (body ?? {}) as {
    employee?: { email?: string; name?: string; department?: string };
    subject?: string;
    description?: string;
    category?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    externalId?: string;
  };
  if (!b.employee?.email) {
    return NextResponse.json({ error: 'employee.email is required.' }, { status: 400 });
  }
  const res = await createPartnerTicket(auth.auth, {
    employee: { email: b.employee.email, name: b.employee.name, department: b.employee.department },
    subject: b.subject ?? '',
    description: b.description ?? '',
    category: b.category,
    priority: b.priority,
    externalId: b.externalId,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ticket: res.ticket }, { status: res.created ? 201 : 200 });
}

export async function GET(req: Request) {
  const auth = await authenticatePartner(req.headers.get('authorization'));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const res = await listPartnerTickets(auth.auth, {
    employeeEmail: url.searchParams.get('employeeEmail'),
    limit: Number(url.searchParams.get('limit') ?? 50) || 50,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ tickets: res.tickets });
}
