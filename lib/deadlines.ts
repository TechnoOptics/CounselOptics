import { createAdminSupabase } from './supabase/admin';
import { formatDateNumeric, formatDateTimeNumeric } from './format';
import { expiryNoticeDue } from './intake-legal-fields';

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

    const { createNotification } = await import('./notifications');
    const targetUser = r.user_id;
    const title = `${bucket} day${bucket === '7' ? '' : 's'} until: ${r.title}`;
    const body = `Deadline due ${formatDateTimeNumeric(r.due_at)}.`;

    // Notify FIRST, flag only on success. Writing alerted_* before
    // notifying meant a transient createNotification failure (it returns
    // null and swallows DB errors) permanently dropped the reminder: the
    // next sweep saw the flag set and skipped the row forever - a silent
    // miss on a statute-of-limitations deadline. A per-row try/catch also
    // keeps one bad row from aborting the whole sweep.
    let hadRecipient = false;
    let notified = false;
    try {
      if (targetUser) {
        hadRecipient = true;
        const n = await createNotification({
          userId: targetUser,
          type: 'case_hearing_reminder',
          title,
          body,
          link: `/cases/${r.case_id}`,
          caseId: r.case_id,
        });
        if (n) notified = true;
      }
      if (r.firm_id) {
        const { data: members } = await admin
          .from('firm_members')
          .select('user_id, role')
          .eq('firm_id', r.firm_id)
          .in('role', ['owner', 'admin', 'attorney', 'paralegal']);
        for (const m of (members ?? []) as Array<{ user_id: string }>) {
          hadRecipient = true;
          const n = await createNotification({
            userId: m.user_id,
            type: 'case_hearing_reminder',
            title,
            body,
            link: `/counsel/cases/${r.case_id}`,
            caseId: r.case_id,
          });
          if (n) notified = true;
        }
      }
    } catch (err) {
      console.error('[deadlines] notification failed for', r.id, err);
    }

    // Flag the bucket only when we actually reached someone - OR when
    // there is genuinely no recipient to reach (so we don't reprocess a
    // recipient-less row every sweep). A row with recipients where every
    // send failed stays unflagged and is retried on the next run.
    if (notified || !hadRecipient) {
      await admin.from('case_deadlines').update(flagPatch).eq('id', r.id);
    }
    if (notified) fired += 1;
  }

  // --- Request / contract reminders ----------------------------------
  // Intakes carry an optional intake_answers.reminder_at (set from the
  // request detail). When it comes due we notify the requester + the
  // legal team once, then flag intake_answers.reminder_fired so it
  // never double-fires. No schema - same JSON pattern as the thread.
  let intakeScanned = 0;
  try {
    const { data: ir } = await admin
      .from('firm_matter_intakes')
      .select('id, firm_id, created_by, client_name, intake_answers')
      .not('intake_answers->>reminder_at', 'is', null)
      .limit(500);
    const intakes = (ir ?? []) as Array<{
      id: string;
      firm_id: string;
      created_by: string | null;
      client_name: string;
      intake_answers: Record<string, unknown> | null;
    }>;
    intakeScanned = intakes.length;
    const { createNotification } = await import('./notifications');
    for (const it of intakes) {
      const ans = (it.intake_answers ?? {}) as Record<string, unknown>;
      const at = Date.parse(String(ans.reminder_at ?? ''));
      if (Number.isNaN(at) || ans.reminder_fired === true) continue;
      if (at > now) continue; // not due yet
      await admin
        .from('firm_matter_intakes')
        .update({
          intake_answers: { ...ans, reminder_fired: true },
        })
        .eq('id', it.id);
      const title = `Reminder: ${it.client_name}`;
      const body = `This request/contract was flagged as due ${formatDateNumeric(at)}.`;
      if (it.created_by) {
        await createNotification({
          userId: it.created_by,
          type: 'system',
          title,
          body,
          link: `/portal/${it.id}`,
        });
      }
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id')
        .eq('firm_id', it.firm_id)
        .in('role', ['owner', 'admin', 'attorney', 'paralegal']);
      for (const m of (members ?? []) as Array<{ user_id: string }>) {
        await createNotification({
          userId: m.user_id,
          type: 'system',
          title,
          body,
          link: `/counsel/intake/${it.id}`,
        });
      }
      fired += 1;
    }
  } catch {
    /* reminder sweep is best-effort; never break the deadline cron */
  }

  // --- Contract expiry notices ----------------------------------------
  // The legal team asked, on the ticket, to be told before an agreement
  // expires. Columns, not intake_answers (lib/intake-legal-fields.ts says
  // why), which also means this select fails as a whole until
  // 20260903_intake_legal_fields_contract.sql is applied. PostgREST reports
  // that as an error rather than a throw, and there is nothing to sweep
  // before the columns exist, so an error here is a quiet skip.
  //
  // Legal team only. The flag is a legal-team tool and the requester is not
  // told, which is the owner's rule for everything in that block.
  let expiryScanned = 0;
  try {
    const { data: er, error: expiryErr } = await admin
      .from('firm_matter_intakes')
      .select('id, firm_id, client_name, expires_on, notify_on_expiry, expiry_notified_at')
      .eq('notify_on_expiry', true)
      .is('expiry_notified_at', null)
      .not('expires_on', 'is', null)
      .limit(500);
    const expiring = expiryErr
      ? []
      : ((er ?? []) as Array<{
          id: string;
          firm_id: string;
          client_name: string;
          expires_on: string | null;
          notify_on_expiry: boolean;
          expiry_notified_at: string | null;
        }>);
    expiryScanned = expiring.length;
    const { createNotification } = await import('./notifications');
    for (const it of expiring) {
      if (
        !expiryNoticeDue({
          expiresOn: it.expires_on,
          notifyOnExpiry: it.notify_on_expiry,
          notifiedAt: it.expiry_notified_at,
          now,
        })
      ) {
        continue;
      }
      // Stamp first, so two overlapping sweeps cannot both send. A stamp
      // that reached nobody is retried by nothing, which is the same trade
      // the reminder above makes.
      const { data: claimed } = await admin
        .from('firm_matter_intakes')
        .update({ expiry_notified_at: new Date(now).toISOString() })
        .eq('id', it.id)
        .is('expiry_notified_at', null)
        .select('id');
      if (!claimed || claimed.length === 0) continue;
      const title = `Contract expiring: ${it.client_name}`;
      const body = `This agreement is set to expire ${formatDateNumeric(
        Date.parse(String(it.expires_on)),
      )}.`;
      const { data: members } = await admin
        .from('firm_members')
        .select('user_id')
        .eq('firm_id', it.firm_id)
        .in('role', ['owner', 'admin', 'attorney', 'paralegal']);
      for (const m of (members ?? []) as Array<{ user_id: string }>) {
        await createNotification({
          userId: m.user_id,
          type: 'system',
          title,
          body,
          link: `/counsel/intake/${it.id}`,
        });
      }
      fired += 1;
    }
  } catch {
    /* expiry sweep is best-effort; never break the deadline cron */
  }

  return { scanned: rows.length + intakeScanned + expiryScanned, fired };
}
