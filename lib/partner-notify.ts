import 'server-only';
import crypto from 'crypto';
import { createAdminSupabase } from './supabase/admin';
import { readPartnerConfig } from './partner-config-core';
import type { ThreadMessage } from './intake-thread';

type AdminSupabase = NonNullable<ReturnType<typeof createAdminSupabase>>;

/**
 * Event hub for the partner ticketing bridge (lib/partner-tickets.ts).
 * One entry point — partnerTicketEvent() — fans out to:
 *
 *   1. The legal team: in-app bell notification + email to every firm
 *      owner/admin (partner tickets arrive from an API, so nobody is
 *      watching a screen when they land — without this they are easy
 *      to miss).
 *   2. The employee: email when legal replies (they may never open the
 *      partner app again; email closes the loop even so).
 *   3. The partner backend: HMAC-SHA256-signed webhook POST so the
 *      partner app can update its UI / push-notify without polling.
 *
 * Everything here is best-effort and bounded: a dead webhook endpoint
 * or an unconfigured Resend key must never fail the ticket write that
 * triggered it. Callers just `await` — errors are swallowed.
 */

export type PartnerEvent =
  | 'ticket.created'
  | 'ticket.employee_replied'
  | 'ticket.legal_replied'
  | 'ticket.status_changed'
  | 'ticket.reminder';

type IntakeLite = {
  id: string;
  firm_id: string;
  status: string;
  matter_type: string | null;
  client_name: string | null;
  client_email: string | null;
  case_id: string | null;
  intake_answers: Record<string, unknown> | null;
};

const INTAKE_LITE_COLS =
  'id, firm_id, status, matter_type, client_name, client_email, case_id, intake_answers';

function partnerMeta(row: IntakeLite): Record<string, unknown> | null {
  const p = (row.intake_answers ?? {}).partner;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
}

function subjectOf(row: IntakeLite): string {
  const a = row.intake_answers ?? {};
  return String(a.subject ?? row.matter_type ?? 'Legal request').trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
}

/** Bell + email to every firm owner/admin. Best-effort per recipient. */
async function notifyLegalTeam(
  admin: AdminSupabase,
  firmId: string,
  args: { title: string; body: string; link: string; firmName?: string | null },
): Promise<void> {
  try {
    const { data: admins } = await admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', firmId)
      .in('role', ['owner', 'admin']);
    const rows = (admins ?? []) as Array<{ user_id: string }>;
    if (rows.length === 0) return;
    const { createNotification } = await import('./notifications');
    const { sendEmail } = await import('./email');
    const html = `<p>${escapeHtml(args.body)}</p><p><a href="${siteOrigin()}${args.link}">Open it in Counsel</a></p>`;
    for (const a of rows) {
      await createNotification({
        userId: a.user_id,
        type: 'system',
        title: args.title,
        body: args.body,
        link: args.link,
      }).catch(() => undefined);
      try {
        const { data: au } = await admin.auth.admin.getUserById(a.user_id);
        const to = au?.user?.email;
        if (to) {
          await sendEmail({
            to,
            subject: `${args.title} - Advottic`,
            fromName: args.firmName ?? undefined,
            html,
            text: `${args.body}\n\n${siteOrigin()}${args.link}`,
          });
        }
      } catch {
        /* per-recipient best-effort */
      }
    }
  } catch {
    /* notification fan-out is best-effort */
  }
}

/** Email the ticket's employee (partner.employeeEmail). */
async function emailEmployee(
  row: IntakeLite,
  args: { subject: string; body: string; firmName?: string | null },
): Promise<void> {
  try {
    const partner = partnerMeta(row);
    const to =
      String(partner?.employeeEmail ?? row.client_email ?? '').trim().toLowerCase();
    if (!to) return;
    const { sendEmail } = await import('./email');
    const portalLink = `${siteOrigin()}/portal/${row.id}`;
    await sendEmail({
      to,
      subject: args.subject,
      fromName: args.firmName ?? undefined,
      html: `<p>${escapeHtml(args.body)}</p><p>Read and reply in your company app, or on the web: <a href="${portalLink}">${portalLink}</a></p><p style="color:#777;font-size:12px;">Sign in with your work email to see every request you have filed.</p>`,
      text: `${args.body}\n\nRead and reply in your company app, or on the web: ${portalLink}`,
    });
  } catch {
    /* employee email is best-effort */
  }
}

/**
 * Signed webhook POST to the partner backend. Headers:
 *   X-Advottic-Event:     event name
 *   X-Advottic-Timestamp: unix seconds
 *   X-Advottic-Signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}`
 *                         keyed with the firm's webhook secret.
 * 10s bound so a dead endpoint can't hang the request that fired it.
 */
async function firePartnerWebhook(
  admin: AdminSupabase,
  row: IntakeLite,
  event: PartnerEvent,
  extra: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: firm } = await admin
      .from('firms')
      .select('metadata')
      .eq('id', row.firm_id)
      .maybeSingle();
    const config = readPartnerConfig(
      (firm as { metadata: Record<string, unknown> | null } | null)?.metadata,
    );
    if (!config.webhookUrl || !config.webhookSecret) return;
    const partner = partnerMeta(row);
    const payload = {
      event,
      at: new Date().toISOString(),
      ticket: {
        id: row.id,
        externalId: (partner?.externalId as string) ?? null,
        employeeEmail:
          (partner?.employeeEmail as string) ?? row.client_email ?? null,
        subject: subjectOf(row),
        status: row.status,
        caseId: row.case_id,
      },
      ...extra,
    };
    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(`${ts}.${body}`)
      .digest('hex');
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Advottic-Event': event,
        'X-Advottic-Timestamp': ts,
        'X-Advottic-Signature': signature,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* webhook delivery is best-effort; partner can always poll */
  }
}

/**
 * The one entry point. Loads the intake fresh (unless a row is passed),
 * confirms it is partner-born, then fans out per event:
 *
 *   ticket.created          → legal team bell + email
 *   ticket.employee_replied → legal team bell + email
 *   ticket.legal_replied    → employee email + partner webhook
 *   ticket.status_changed   → partner webhook (+ employee email when the
 *                             ticket reached a terminal state)
 *   ticket.reminder         → legal team bell + email (from the cron)
 */
export async function partnerTicketEvent(
  intakeIdOrRow: string | IntakeLite,
  event: PartnerEvent,
  opts?: {
    message?: ThreadMessage;
    firmName?: string | null;
    /**
     * Fire the outbound partner webhook but skip every bell + email. The
     * conversation surface (lib/intake-conversation.ts) sends its own
     * ticket-branded notifications, so it opts out here rather than having
     * people receive two emails for one reply.
     */
    webhookOnly?: boolean;
  },
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    if (!admin) return;

    let row: IntakeLite | null = null;
    if (typeof intakeIdOrRow === 'string') {
      const { data } = await admin
        .from('firm_matter_intakes')
        .select(INTAKE_LITE_COLS)
        .eq('id', intakeIdOrRow)
        .maybeSingle();
      row = (data as IntakeLite | null) ?? null;
    } else {
      row = intakeIdOrRow;
    }
    if (!row || !partnerMeta(row)) return; // not a partner ticket — nothing to do

    let firmName = opts?.firmName ?? null;
    if (!firmName) {
      const { data: firm } = await admin
        .from('firms')
        .select('name')
        .eq('id', row.firm_id)
        .maybeSingle();
      firmName = (firm as { name: string } | null)?.name ?? null;
    }

    const subject = subjectOf(row);
    const who = row.client_name || row.client_email || 'An employee';
    const link = `/counsel/intake/${row.id}`;

    const quiet = opts?.webhookOnly === true;

    switch (event) {
      case 'ticket.created':
        if (quiet) break;
        await notifyLegalTeam(admin, row.firm_id, {
          title: 'New legal request from the company app',
          body: `${who} filed "${subject}" from the partner app.`,
          link,
          firmName,
        });
        break;
      case 'ticket.employee_replied':
        if (quiet) break;
        await notifyLegalTeam(admin, row.firm_id, {
          title: `${who} replied to a request`,
          body:
            opts?.message?.text && opts.message.text.length > 0
              ? `On "${subject}": ${opts.message.text.slice(0, 140)}${opts.message.text.length > 140 ? '…' : ''}`
              : `New reply on "${subject}".`,
          link,
          firmName,
        });
        break;
      case 'ticket.legal_replied':
        if (!quiet) {
          await emailEmployee(row, {
            subject: `Legal replied to your request: ${subject}`,
            body:
              opts?.message?.text && opts.message.text.length > 0
                ? `${opts.message.name || 'The legal team'} replied: "${opts.message.text.slice(0, 200)}${opts.message.text.length > 200 ? '…' : ''}"`
                : 'The legal team replied to your request.',
            firmName,
          });
        }
        await firePartnerWebhook(admin, row, event, {
          message: opts?.message
            ? {
                id: opts.message.id,
                author: opts.message.name,
                role: opts.message.role,
                at: opts.message.at,
                text: opts.message.text,
              }
            : null,
        });
        break;
      case 'ticket.status_changed': {
        await firePartnerWebhook(admin, row, event, {});
        // Terminal states also close the loop with the employee directly.
        if (!quiet && (row.status === 'converted' || row.status === 'rejected')) {
          await emailEmployee(row, {
            subject:
              row.status === 'converted'
                ? `Your request became a matter: ${subject}`
                : `Update on your request: ${subject}`,
            body:
              row.status === 'converted'
                ? `The legal team opened a matter from your request "${subject}" and is now working on it.`
                : `The legal team closed your request "${subject}". Reach out to them if you believe this needs another look.`,
            firmName,
          });
        }
        break;
      }
      case 'ticket.reminder':
        await notifyLegalTeam(admin, row.firm_id, {
          title: 'A partner-app request is waiting on legal',
          body: `"${subject}" from ${who} has had no reply from the legal team yet.`,
          link,
          firmName,
        });
        break;
    }
  } catch {
    /* the event fan-out must never break the write that triggered it */
  }
}
