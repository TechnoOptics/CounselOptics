import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { readPartnerConfig } from '@/lib/partner-config-core';
import { partnerTicketEvent } from '@/lib/partner-notify';
import type { ThreadMessage } from '@/lib/intake-thread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/partner-reminders
 *
 * Hourly Vercel Cron. Finds partner-app tickets that are still waiting on
 * the legal team (open status, and the last word in the thread belongs to
 * the employee, or the thread is empty) past the firm's configured
 * remindAfterHours. Sends the legal team a bell + email nudge via
 * partnerTicketEvent('ticket.reminder').
 *
 * Idempotency: after nudging, partner.lastReminderAt is stamped on the
 * intake; a ticket is not re-nudged until another remindAfterHours has
 * passed, so a stale ticket produces at most one reminder per window,
 * not one per cron tick.
 *
 * Schedule via vercel.json: { "path": "/api/cron/partner-reminders",
 * "schedule": "0 * * * *" }. Auth: CRON_SECRET, same as the other crons.
 */

const OPEN_STATUSES = ['in_progress', 'conflict_check_passed', 'conflict_check_flagged', 'engaged'];

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (expected && got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  const { data } = await admin
    .from('firm_matter_intakes')
    .select('id, firm_id, status, created_at, updated_at, intake_answers')
    .in('status', OPEN_STATUSES)
    .not('intake_answers->partner', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500);

  const rows = (data ?? []) as Array<{
    id: string;
    firm_id: string;
    status: string;
    created_at: string;
    updated_at: string | null;
    intake_answers: Record<string, unknown> | null;
  }>;

  // Firm configs are fetched once per firm, not once per ticket.
  const configByFirm = new Map<string, { remindAfterHours: number }>();
  let reminded = 0;

  for (const row of rows) {
    let cfg = configByFirm.get(row.firm_id);
    if (!cfg) {
      const { data: firm } = await admin
        .from('firms')
        .select('metadata')
        .eq('id', row.firm_id)
        .maybeSingle();
      cfg = readPartnerConfig(
        (firm as { metadata: Record<string, unknown> | null } | null)?.metadata,
      );
      configByFirm.set(row.firm_id, cfg);
    }
    if (!cfg.remindAfterHours) continue; // 0 = reminders off for this firm
    const windowMs = cfg.remindAfterHours * 3_600_000;

    const answers = row.intake_answers ?? {};
    const thread = Array.isArray(answers.thread) ? (answers.thread as ThreadMessage[]) : [];
    const lastMessage = thread[thread.length - 1];
    // Waiting-on-legal = the employee spoke last (or never got a reply).
    if (lastMessage && lastMessage.role === 'legal') continue;

    const waitingSince = Date.parse(lastMessage?.at ?? row.created_at);
    if (Number.isNaN(waitingSince) || Date.now() - waitingSince < windowMs) continue;

    const partner = (answers.partner ?? {}) as Record<string, unknown>;
    const lastReminder = Date.parse(String(partner.lastReminderAt ?? ''));
    if (!Number.isNaN(lastReminder) && Date.now() - lastReminder < windowMs) continue;

    await partnerTicketEvent(row.id, 'ticket.reminder');
    await admin
      .from('firm_matter_intakes')
      .update({
        intake_answers: {
          ...answers,
          partner: { ...partner, lastReminderAt: new Date().toISOString() },
        },
      })
      .eq('id', row.id);
    reminded += 1;
  }

  return NextResponse.json({ ok: true, scanned: rows.length, reminded });
}
