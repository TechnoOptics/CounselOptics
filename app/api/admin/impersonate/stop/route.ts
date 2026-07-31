import { NextResponse } from 'next/server';
import { stopActAs } from '@/lib/act-as';

/**
 * POST /api/admin/impersonate/stop
 *
 * Ends an "act as" overlay by deleting the `adv_act_as` cookie. The admin's own
 * Supabase session was never touched, so they are instantly back as themselves:
 * no sign-out, no effect on any other tab or user. Safe with no body/guard:
 * clearing the current browser's own overlay cookie can't harm anyone.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  stopActAs();
  return NextResponse.json({ ok: true });
}
