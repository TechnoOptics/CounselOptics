import 'server-only';

import { revalidatePath } from 'next/cache';
import { createAdminSupabase } from './supabase/admin';
import { createNotification } from './notifications';
import { sendEmail, buildIntakeActivityEmailHtml } from './email';
import { portalStatusLabel } from './portal-status';
import { intakeTitle } from './intake-request';
import { emailOptedOutUserIds } from './notify-prefs';
import { displayRequest } from './ticket-numbers';
import {
  type IntakeAttachment,
  type IntakeMessage,
  type IntakePerson,
  type MessageVisibility,
} from './intake-conversation-types';

/**
 * Shared server internals for the intake conversation: loading people,
 * inserting a message row, and fanning out ticket-branded notifications.
 *
 * Deliberately NOT a `'use server'` module: every export in one of those
 * becomes a callable HTTP endpoint, and these functions write messages and
 * send mail without checking who the caller is. They are for trusted server
 * callers only (the conversation actions, the partner API), each of which
 * does its own authorization first.
 */

export type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

export const BUCKET = 'firm-documents';

export type IntakeRow = {
  id: string;
  firm_id: string;
  created_by: string | null;
  client_name: string | null;
  client_email: string | null;
  matter_type: string | null;
  status: string;
  assigned_to: string | null;
  intake_answers: Record<string, unknown> | null;
  /**
   * The firm's allocated reference, or null for every request filed before
   * 20260817_request_number.sql. Null is permanent for those: see refFor.
   */
  request_number: string | null;
};

export const INTAKE_COLS =
  'id, firm_id, created_by, client_name, client_email, matter_type, status, assigned_to, intake_answers, request_number';

/** Display name + avatar for a set of user ids, firm members and employees alike. */
export async function hydratePeople(
  admin: Admin,
  userIds: string[],
): Promise<Map<string, IntakePerson>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, IntakePerson>();
  if (ids.length === 0) return out;

  const [profiles, members, employees] = await Promise.all([
    admin.from('profiles').select('id, display_name, avatar_url').in('id', ids),
    admin.from('firm_members').select('user_id, display_name, role').in('user_id', ids),
    admin.from('firm_employees').select('user_id, display_name, email').in('user_id', ids),
  ]);

  const memberBy = new Map(
    ((members.data ?? []) as { user_id: string; display_name: string | null; role: string }[]).map(
      (m) => [m.user_id, m] as const,
    ),
  );
  const employeeBy = new Map(
    ((employees.data ?? []) as {
      user_id: string | null;
      display_name: string | null;
      email: string | null;
    }[])
      .filter((e) => e.user_id)
      .map((e) => [e.user_id as string, e] as const),
  );
  const profileBy = new Map(
    (
      (profiles.data ?? []) as {
        id: string;
        display_name: string | null;
        avatar_url: string | null;
      }[]
    ).map((p) => [p.id, p] as const),
  );

  for (const id of ids) {
    const m = memberBy.get(id);
    const e = employeeBy.get(id);
    const p = profileBy.get(id);
    const name =
      (m?.display_name ?? '').trim() ||
      (e?.display_name ?? '').trim() ||
      (p?.display_name ?? '').trim() ||
      (e?.email ?? '').split('@')[0] ||
      'Someone';
    out.set(id, {
      userId: id,
      name,
      avatarUrl: p?.avatar_url ?? null,
      side: m ? 'legal' : 'employee',
      role: m?.role ?? null,
    });
  }
  return out;
}

export function rowToMessage(r: Record<string, unknown>): IntakeMessage {
  return {
    id: String(r.id),
    intakeId: String(r.intake_id),
    authorUserId: (r.author_user_id as string | null) ?? null,
    authorName: String(r.author_name ?? 'Someone'),
    authorRole: (r.author_role as IntakeMessage['authorRole']) ?? 'employee',
    visibility: (r.visibility as MessageVisibility) ?? 'shared',
    body: String(r.body ?? ''),
    attachments: Array.isArray(r.attachments) ? (r.attachments as IntakeAttachment[]) : [],
    mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
    kind: (r.kind as 'message' | 'event') ?? 'message',
    eventType: (r.event_type as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

/** Firm brand for emails: the firm's own name unless it's still the default. */
export async function firmBrand(
  admin: Admin,
  firmId: string,
): Promise<{ name: string; logoUrl: string | null }> {
  const { data } = await admin
    .from('firms')
    .select('name, logo_url, metadata')
    .eq('id', firmId)
    .maybeSingle();
  const row =
    (data as {
      name: string | null;
      logo_url: string | null;
      metadata: Record<string, unknown> | null;
    } | null) ?? null;
  const rawBrand = String((row?.metadata ?? {}).brandName ?? '').trim();
  const isDefault = /^advottic(\s|$)/i.test(rawBrand);
  const name = (rawBrand && !isDefault ? rawBrand : '') || (row?.name ?? '').trim() || 'Advottic';
  return { name, logoUrl: row?.logo_url ?? null };
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://advottic.com').trim().replace(/\/+$/, '');
}

/** One rule for what a request is called; see lib/intake-request.ts. */
export function ticketTitle(intake: IntakeRow): string {
  return intakeTitle(intake);
}

/**
 * What one legal request is called, everywhere. Three forms, in order.
 *
 * 1. A PARTNER'S OWN EXTERNAL ID, when the request came from a partner system.
 *    That is the partner's record key, not ours; their system quotes it and
 *    expects it back, so it keeps winning even now that we can allocate a
 *    number of our own for the same request.
 * 2. THE FIRM'S ALLOCATED NUMBER, e.g. 'ZT0001000'. Per firm, sequential and
 *    immutable once written (lib/ticket-allocator.ts).
 * 3. THE DERIVED REFERENCE, 'REQ-4F2A9C', for every request filed before the
 *    allocator existed. Those are never backfilled, so this is not a
 *    transitional case that goes away: it is what those requests are called
 *    for the rest of their lives, because that is what was emailed out.
 *
 * Takes the three fields it actually reads rather than a whole IntakeRow, so
 * the employee's own request page can show the same reference the notifications
 * use without selecting columns it has no use for. A second copy of this rule
 * is how the portal and the email would come to call one request two different
 * things.
 */
export function refFor(
  intake: Pick<IntakeRow, 'id' | 'intake_answers' | 'request_number'>,
): string {
  const answers = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const partner = (answers.partner ?? null) as { externalId?: string | null } | null;
  return (
    (partner?.externalId ?? '').trim() ||
    displayRequest({ requestNumber: intake.request_number, id: intake.id })
  );
}

export function revalidateIntake(intakeId: string): void {
  revalidatePath(`/counsel/intake/${intakeId}`);
  revalidatePath('/counsel/inbox');
  revalidatePath(`/portal/${intakeId}`);
  revalidatePath('/portal');
}

/** Insert one message row. Shared by every posting path. */
export async function insertIntakeMessage(input: {
  admin: Admin;
  intake: IntakeRow;
  authorUserId: string | null;
  authorName: string;
  authorRole: IntakeMessage['authorRole'];
  visibility: MessageVisibility;
  body: string;
  attachments?: IntakeAttachment[];
  mentions?: string[];
  kind?: 'message' | 'event';
  eventType?: string | null;
}): Promise<IntakeMessage | null> {
  const { data, error } = await input.admin
    .from('firm_intake_messages')
    .insert({
      intake_id: input.intake.id,
      firm_id: input.intake.firm_id,
      author_user_id: input.authorUserId,
      author_name: input.authorName,
      author_role: input.authorRole,
      visibility: input.visibility,
      body: input.body,
      attachments: input.attachments ?? [],
      mentions: input.mentions ?? [],
      kind: input.kind ?? 'message',
      event_type: input.eventType ?? null,
    })
    .select('*')
    .single();
  if (error || !data) return null;
  await input.admin
    .from('firm_matter_intakes')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.intake.id);
  return rowToMessage(data as Record<string, unknown>);
}

/**
 * Notify the right people about one piece of ticket activity: bell, push,
 * and a ticket-branded email that deep-links to the exact message.
 *
 * The visibility rule is absolute: an internal note never reaches the
 * requester, by any channel.
 */
export async function notifyIntakeActivity(input: {
  admin: Admin;
  intake: IntakeRow;
  message: IntakeMessage;
  actor: IntakePerson;
  eyebrow: string;
  headline: (recipientIsRequester: boolean) => string;
  ctaLabel?: string;
}): Promise<void> {
  const { admin, intake, message, actor } = input;
  try {
    const brand = await firmBrand(admin, intake.firm_id);
    const site = siteUrl();
    const ref = refFor(intake);
    const title = ticketTitle(intake);
    const isInternal = message.visibility === 'internal';

    const { data: memberRows } = await admin
      .from('firm_members')
      .select('user_id, role')
      .eq('firm_id', intake.firm_id);
    const members = (memberRows ?? []) as { user_id: string; role: string }[];
    const legalIds = new Set(
      members
        .filter((m) => ['owner', 'admin', 'attorney', 'paralegal'].includes(m.role))
        .map((m) => m.user_id),
    );
    if (intake.assigned_to) legalIds.add(intake.assigned_to);

    const { data: partRows } = await admin
      .from('firm_intake_participants')
      .select('user_id')
      .eq('intake_id', intake.id);
    const participantIds = ((partRows ?? []) as { user_id: string }[]).map((p) => p.user_id);

    const memberIdSet = new Set(members.map((m) => m.user_id));
    const recipients = new Set<string>();

    if (isInternal) {
      // Legal team only, plus any invited person who is themselves firm-side.
      for (const id of legalIds) recipients.add(id);
      for (const id of participantIds) if (memberIdSet.has(id)) recipients.add(id);
    } else if (message.authorRole === 'legal') {
      if (intake.created_by) recipients.add(intake.created_by);
      for (const id of participantIds) recipients.add(id);
      if (intake.assigned_to) recipients.add(intake.assigned_to);
    } else {
      for (const id of legalIds) recipients.add(id);
      for (const id of participantIds) recipients.add(id);
    }
    for (const id of message.mentions) {
      // A mention can't widen visibility: internal notes stay firm-side.
      if (isInternal && !memberIdSet.has(id)) continue;
      recipients.add(id);
    }
    recipients.delete(actor.userId);
    if (recipients.size === 0) return;

    const preview =
      message.body.trim().length > 0
        ? message.body.trim()
        : message.attachments.length > 0
          ? `Shared ${message.attachments.length} file${message.attachments.length === 1 ? '' : 's'}.`
          : '';

    const emails = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailBy = new Map((emails.data?.users ?? []).map((u) => [u.id, u.email ?? null] as const));

    // Who has turned email off in the Hub. The bell below still fires for
    // them; only the mail is held back. See lib/notify-prefs.ts.
    const emailOff = await emailOptedOutUserIds(admin, [...recipients]);

    // The status line is built per recipient, not once for everybody.
    // `intake.status` is the firm's internal vocabulary: an employee was
    // being emailed "conflict check passed" or "converted", which is exactly
    // what lib/portal-status.ts exists to translate away. The in-app fix
    // landed and the email path was missed. Firm-side readers keep the real
    // status because that is the word they work in.
    const metaFor = (onCounselSide: boolean) => [
      { label: 'Reference', value: ref },
      {
        label: 'Status',
        value: onCounselSide
          ? intake.status.replace(/_/g, ' ')
          : portalStatusLabel(intake.status),
      },
    ];

    await Promise.allSettled(
      [...recipients].map(async (userId) => {
        const isRequester = userId === intake.created_by;
        const mentioned = message.mentions.includes(userId);
        const onCounselSide = memberIdSet.has(userId);
        const path = `${onCounselSide ? '/counsel/intake' : '/portal'}/${intake.id}#m-${message.id}`;
        const link = `${site}${path}`;
        const headline = mentioned
          ? `${actor.name} mentioned you on ${ref}`
          : input.headline(isRequester);

        await createNotification({
          userId,
          type: 'system',
          title: mentioned ? `${actor.name} mentioned you` : input.eyebrow,
          body: `${title}: ${preview.slice(0, 140)}${preview.length > 140 ? '…' : ''}`,
          link: path,
          actorUserId: actor.userId,
        });

        const to = emailBy.get(userId);
        if (!to) return;
        if (emailOff.has(userId)) return;
        await sendEmail({
          to,
          fromName: brand.name,
          subject: `${ref}: ${mentioned ? `${actor.name} mentioned you` : input.eyebrow} (${title})`,
          html: buildIntakeActivityEmailHtml({
            firmName: brand.name,
            logoUrl: brand.logoUrl,
            eyebrow: mentioned ? 'You were mentioned' : input.eyebrow,
            headline,
            ticketRef: ref,
            ticketTitle: title,
            actorName: actor.name,
            actorRole: actor.side === 'legal' ? 'Legal team' : 'Requester',
            bodyPreview: preview,
            attachments: message.attachments.map((a) => a.name),
            meta: metaFor(onCounselSide),
            link,
            ctaLabel: input.ctaLabel ?? 'Open the conversation',
            internal: isInternal,
            footerNote: isInternal
              ? 'This is an internal legal-team note. The person who filed the request cannot see it.'
              : null,
          }),
          text: `${headline}\n\n${preview}\n\nOpen: ${link}`,
        });
      }),
    );
  } catch {
    /* notifications must never break the message that triggered them */
  }
}
