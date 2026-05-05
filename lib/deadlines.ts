import { createAdminSupabase } from './supabase/admin';

export type {
  ClaimType,
  SuggestedDeadline,
} from './deadlines-data';
export { suggestSOL } from './deadlines-data';

/**
 * Cron-driven sweep that fires notifications when a deadline is
 * 90 / 30 / 7 days out. Idempotent - the alerted_* flags prevent
 * duplicate notifications across cron runs.
 *
 * Pure-function helpers (the SOL lookup table, suggestSOL, the
 * ClaimType / SuggestedDeadline types) live in
 * lib/deadlines-data.ts and are safe to import from client
 * components.
 */
export async function sweepDeadlineAlerts(): Promise<{
  scanned: number;
  fired: number;
}> {
  const admin = createAdminSupabase();
  if (!admin) return { scanned: 0, fired: 0 };

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const { data } = await admin
    .from('case_deadlines')
    .select(
      'id, case_id, firm_id, user_id, kind, title, due_at, alerted_90, alerted_30, alerted_7',
    )
    .is('completed_at', null)
    .lte('due_at', new Date(now + 95 * day).toISOString())
    .gt('due_at', new Date(now).toISOString());
  const rows = (data ?? []) as Array<{
    id: string;
    case_id: string;
    firm_id: string | null;
    user_id: string | null;
    kind: string;
    title: string;
    due_at: string;
    alerted_90: boolean;
    alerted_30: boolean;
    alerted_7: boolean;
  }>;

  let fired = 0;
  for (const r of rows) {
    const daysOut = Math.ceil((Date.parse(r.due_at) - now) / day);
    let bucket: '90' | '30' | '7' | null = null;
    if (daysOut <= 7 && !r.alerted_7) bucket = '7';
    else if (daysOut <= 30 && !r.alerted_30) bucket = '30';
    else if (daysOut <= 90 && !r.alerted_90) bucket = '90';
    if (!bucket) continue;

    const flagPatch = {
      ...(bucket === '7' ? { alerted_7: true } : {}),
      ...(bucket === '30' ? { alerted_30: true } : {}),
      ...(bucket === '90' ? { alerted_90: true } : {}),
    };
    await admin.from('case_deadlines').update(flagPatch).eq('id', r.id);

    const { createNotification } = await import('./notifications');
    const targetUser = r.user_id;
    const title = `${bucket} day${bucket === '7' ? '' : 's'} until: ${r.title}`;
    const body = `Deadline due ${new Date(r.due_at).toLocaleString()}.`;
    if (targetUser) {
      await createNotification({
        userId: targetUser,
        type: 'case_hearing_reminder',
        title,
        body,
        link: `/cases/${r.case_id}`,
        caseId: r.case_id,
      });
    }
    if (r.firm_id) {
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id, role')
        .eq('firm_id', r.firm_id)
        .in('role', ['owner', 'admin', 'attorney', 'paralegal']);
      for (const m of (members ?? []) as Array<{ user_id: string }>) {
        await createNotification({
          userId: m.user_id,
          type: 'case_hearing_reminder',
          title,
          body,
          link: `/counsel/cases/${r.case_id}`,
          caseId: r.case_id,
        });
      }
    }
    fired += 1;
  }

  return { scanned: rows.length, fired };
}
