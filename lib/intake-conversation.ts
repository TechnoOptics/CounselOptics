'use server';

import crypto from 'crypto';
import { createAdminSupabase } from './supabase/admin';
import { getCurrentUser } from './supabase/server';
import { authorizeFirmActor } from './portal-entitlements';
import { safeStorageUpload } from './upload-safety';
import { checkRateLimit } from './rate-limit';
import { partnerTicketEvent } from './partner-notify';
import {
  BUCKET,
  INTAKE_COLS,
  firmBrand,
  hydratePeople,
  insertIntakeMessage,
  notifyIntakeActivity,
  refFor,
  revalidateIntake,
  rowToMessage,
  siteUrl,
  type Admin,
  type IntakeRow,
} from './intake-notify';
import {
  MAX_CHAT_FILES,
  MAX_CHAT_FILE_BYTES,
  MAX_MESSAGE_CHARS,
  type IntakeAttachment,
  type IntakeDocument,
  type IntakeMessage,
  type IntakeParticipant,
  type IntakePerson,
  type IntakeUploadRequest,
  type MessageVisibility,
} from './intake-conversation-types';

type Access =
  | {
      ok: true;
      userId: string;
      /** 'legal' = firm member; 'employee' = the requester or an invited colleague. */
      role: 'legal' | 'employee';
      canPost: boolean;
      /** Only the legal team may read or write internal notes. */
      canUseInternal: boolean;
      intake: IntakeRow;
      admin: Admin;
    }
  | { ok: false; error: string };

/**
 * One gate for every conversation action. Firm members get full access to
 * their firm's tickets; an employee gets access to a ticket they filed or
 * were invited onto, and may only post if their portal role allows it.
 */
async function resolveAccess(intakeId: string): Promise<Access> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server is not fully configured.' };

  const { data } = await admin
    .from('firm_matter_intakes')
    .select(INTAKE_COLS)
    .eq('id', intakeId)
    .maybeSingle();
  const intake = (data as IntakeRow | null) ?? null;
  if (!intake) return { ok: false, error: 'That request could not be found.' };

  const auth = await authorizeFirmActor(admin, intake.firm_id, user.id, 'requests.message');
  if (auth.ok && auth.role === 'legal') {
    return { ok: true, userId: user.id, role: 'legal', canPost: true, canUseInternal: true, intake, admin };
  }

  // Employee side: must actually be on this ticket, not merely in the firm.
  const isRequester = intake.created_by === user.id;
  let invited = false;
  if (!isRequester) {
    const { data: p } = await admin
      .from('firm_intake_participants')
      .select('id')
      .eq('intake_id', intakeId)
      .eq('user_id', user.id)
      .maybeSingle();
    invited = Boolean(p);
  }
  if (!isRequester && !invited) {
    return { ok: false, error: 'You do not have access to this request.' };
  }
  return {
    ok: true,
    userId: user.id,
    role: 'employee',
    canPost: auth.ok,
    canUseInternal: false,
    intake,
    admin,
  };
}

/**
 * Everything the conversation panel needs, in one round trip: the messages
 * the viewer is allowed to see, who is on the ticket, who can be mentioned,
 * the ticket's documents, and any open "send us a file" links.
 */
export async function loadIntakeConversationAction(intakeId: string): Promise<
  | {
      ok: true;
      role: 'legal' | 'employee';
      userId: string;
      canPost: boolean;
      canUseInternal: boolean;
      messages: IntakeMessage[];
      participants: IntakeParticipant[];
      mentionables: IntakePerson[];
      documents: IntakeDocument[];
      uploadRequests: IntakeUploadRequest[];
      assignee: IntakePerson | null;
    }
  | { ok: false; error: string }
> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  const { admin, intake, role } = access;

  let q = admin
    .from('firm_intake_messages')
    .select('*')
    .eq('intake_id', intakeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  if (role !== 'legal') q = q.eq('visibility', 'shared');
  const { data: msgRows } = await q;
  const messages = ((msgRows ?? []) as Record<string, unknown>[]).map(rowToMessage);

  const { data: partRows } = await admin
    .from('firm_intake_participants')
    .select('user_id, role')
    .eq('intake_id', intakeId);
  const participantRows = (partRows ?? []) as { user_id: string; role: string }[];

  // Mentionables: the whole legal team, the requester, and anyone invited.
  const { data: memberRows } = await admin
    .from('firm_members')
    .select('user_id')
    .eq('firm_id', intake.firm_id);
  const memberIds = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id);

  const everyone = [
    ...memberIds,
    ...participantRows.map((p) => p.user_id),
    ...(intake.created_by ? [intake.created_by] : []),
    ...(intake.assigned_to ? [intake.assigned_to] : []),
    ...messages.map((m) => m.authorUserId).filter((x): x is string => Boolean(x)),
  ];
  const people = await hydratePeople(admin, everyone);

  const participants: IntakeParticipant[] = participantRows
    .map((p) => {
      const person = people.get(p.user_id);
      if (!person) return null;
      return { ...person, participantRole: p.role as 'watcher' | 'assignee' };
    })
    .filter((x): x is IntakeParticipant => Boolean(x));

  // The requester is implicitly on their own ticket.
  if (intake.created_by && !participants.some((p) => p.userId === intake.created_by)) {
    const requester = people.get(intake.created_by);
    if (requester) participants.unshift({ ...requester, participantRole: 'watcher' });
  }

  const mentionables: IntakePerson[] =
    role === 'legal'
      ? [...people.values()]
      : // An employee can mention the legal team and anyone already on the ticket.
        [...people.values()].filter(
          (p) => p.side === 'legal' || participants.some((x) => x.userId === p.userId),
        );

  const { data: docRows } = await admin
    .from('firm_documents')
    .select('id, name, file_path, file_size, mime_type, status, uploaded_at')
    .eq('intake_id', intakeId)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(100);

  const documents: IntakeDocument[] = ((docRows ?? []) as Record<string, unknown>[]).map((d) => ({
    id: String(d.id),
    name: String(d.name ?? 'Document'),
    path: String(d.file_path ?? ''),
    size: (d.file_size as number | null) ?? null,
    mimeType: (d.mime_type as string | null) ?? null,
    status: String(d.status ?? 'received'),
    uploadedAt: String(d.uploaded_at ?? ''),
    origin: 'chat',
  }));

  // Files attached when the request was originally filed used to be invisible
  // to the legal team entirely, so surface them alongside the rest.
  const filed = Array.isArray((intake.intake_answers ?? {}).attachments)
    ? ((intake.intake_answers as Record<string, unknown>).attachments as IntakeAttachment[])
    : [];
  for (const f of filed) {
    if (!f?.path || documents.some((d) => d.path === f.path)) continue;
    documents.push({
      id: `filed:${f.path}`,
      name: f.name || 'Attachment',
      path: f.path,
      size: f.size ?? null,
      mimeType: f.type ?? null,
      status: 'received',
      uploadedAt: '',
      origin: 'filed',
    });
  }

  let uploadRequests: IntakeUploadRequest[] = [];
  if (role === 'legal') {
    const { data: reqRows } = await admin
      .from('firm_intake_upload_requests')
      .select('id, label, note, token, expires_at, revoked_at, completed_at, upload_count, created_at')
      .eq('intake_id', intakeId)
      .order('created_at', { ascending: false })
      .limit(20);
    uploadRequests = ((reqRows ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      label: String(r.label ?? ''),
      note: (r.note as string | null) ?? null,
      token: String(r.token),
      expiresAt: String(r.expires_at),
      revokedAt: (r.revoked_at as string | null) ?? null,
      completedAt: (r.completed_at as string | null) ?? null,
      uploadCount: Number(r.upload_count ?? 0),
      createdAt: String(r.created_at),
    }));
  }

  return {
    ok: true,
    role,
    userId: access.userId,
    canPost: access.canPost,
    canUseInternal: access.canUseInternal,
    messages,
    participants,
    mentionables,
    documents,
    uploadRequests,
    assignee: intake.assigned_to ? (people.get(intake.assigned_to) ?? null) : null,
  };
}

/** Post a message (or an internal legal note) into the conversation. */
export async function postIntakeMessageAction(
  intakeId: string,
  input: {
    body: string;
    visibility?: MessageVisibility;
    mentions?: string[];
    attachments?: IntakeAttachment[];
  },
): Promise<{ ok: boolean; error?: string; message?: IntakeMessage }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (!access.canPost) {
    return { ok: false, error: 'Messaging is not enabled for your role.' };
  }
  const body = (input.body ?? '').trim();
  const attachments = (input.attachments ?? []).slice(0, MAX_CHAT_FILES);
  if (!body && attachments.length === 0) return { ok: false, error: 'Write a message first.' };
  if (body.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: 'That message is too long.' };
  }

  const visibility: MessageVisibility =
    input.visibility === 'internal' && access.canUseInternal ? 'internal' : 'shared';

  const allowed = await checkRateLimit(`intake-msg:${access.userId}`, {
    limit: 60,
    windowSeconds: 300,
  });
  if (!allowed) return { ok: false, error: 'You are sending messages very quickly. Try again shortly.' };

  const people = await hydratePeople(access.admin, [access.userId]);
  const actor = people.get(access.userId) ?? {
    userId: access.userId,
    name: 'Someone',
    avatarUrl: null,
    side: access.role === 'legal' ? ('legal' as const) : ('employee' as const),
  };

  const message = await insertIntakeMessage({
    admin: access.admin,
    intake: access.intake,
    authorUserId: access.userId,
    authorName: actor.name,
    authorRole: access.role,
    visibility,
    body,
    attachments,
    mentions: (input.mentions ?? []).slice(0, 20),
  });
  if (!message) return { ok: false, error: 'Could not send that message.' };

  await notifyIntakeActivity({
    admin: access.admin,
    intake: access.intake,
    message,
    actor,
    eyebrow:
      visibility === 'internal'
        ? 'Internal note'
        : access.role === 'legal'
          ? 'New reply from legal'
          : 'New reply on a request',
    headline: (isRequester: boolean) =>
      visibility === 'internal'
        ? `${actor.name} added an internal note`
        : isRequester
          ? `${actor.name} replied to your request`
          : `${actor.name} replied on ${refFor(access.intake)}`,
  });

  // Partner apps get the webhook only; the branded email above is better
  // than the plain one partner-notify would otherwise send.
  if (visibility === 'shared' && access.role === 'legal') {
    await partnerTicketEvent(access.intake.id, 'ticket.legal_replied', {
      webhookOnly: true,
      message: {
        id: message.id,
        byUserId: access.userId,
        name: actor.name,
        role: 'legal',
        at: message.createdAt,
        text: body,
      },
    });
  } else if (visibility === 'shared' && access.role === 'employee') {
    await partnerTicketEvent(access.intake.id, 'ticket.employee_replied', {
      webhookOnly: true,
      message: {
        id: message.id,
        byUserId: access.userId,
        name: actor.name,
        role: 'employee',
        at: message.createdAt,
        text: body,
      },
    });
  }

  revalidateIntake(intakeId);
  return { ok: true, message };
}

/**
 * Upload files from the conversation composer. Each file is screened, stored,
 * and filed into the ticket's documents so the legal team has one place to
 * look; the chat is not a separate silo.
 */
export async function uploadIntakeChatFilesAction(
  intakeId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; attachments?: IntakeAttachment[] }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (!access.canPost) return { ok: false, error: 'Uploading is not enabled for your role.' };

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) return { ok: false, error: 'Pick a file to attach.' };
  if (files.length > MAX_CHAT_FILES) {
    return { ok: false, error: `Attach up to ${MAX_CHAT_FILES} files at a time.` };
  }

  const out: IntakeAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      return { ok: false, error: `${file.name} is larger than 25 MB.` };
    }
    const safeName = file.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
    const path = `intake-chat/${access.intake.firm_id}/${intakeId}/${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const up = await safeStorageUpload({
      client: access.admin,
      bucket: BUCKET,
      path,
      buffer,
      declaredMime: file.type || null,
      maxBytes: MAX_CHAT_FILE_BYTES,
    });
    if (!up.ok) return { ok: false, error: up.error };

    const { data: doc } = await access.admin
      .from('firm_documents')
      .insert({
        firm_id: access.intake.firm_id,
        intake_id: intakeId,
        name: file.name.slice(0, 200) || safeName,
        mime_type: file.type || null,
        file_path: path,
        file_size: file.size,
        uploaded_by: access.userId,
        status: 'received',
        tags: ['Request'],
      })
      .select('id')
      .single();

    out.push({
      name: file.name.slice(0, 200) || safeName,
      path,
      size: file.size,
      type: file.type || 'application/octet-stream',
      documentId: (doc as { id: string } | null)?.id ?? null,
    });
  }

  revalidateIntake(intakeId);
  return { ok: true, attachments: out };
}

/** A short-lived signed URL for one of the ticket's files. */
export async function getIntakeFileUrlAction(
  intakeId: string,
  path: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  // Confine the path. This ticket's own chat prefix is always fine. The two
  // broader prefixes are NOT ticket-scoped: `intake-uploads/<firm>/` covers
  // every employee's attachments firm-wide and `<firm>/` is the whole
  // firm-documents tree (letters, contracts, imports). Only the legal team,
  // which may read the firm's documents anyway, gets those; an employee is
  // held to this ticket plus their own uploads.
  const firmId = access.intake.firm_id;
  let allowed =
    path.startsWith(`intake-chat/${firmId}/${intakeId}/`) ||
    (access.role === 'legal'
      ? path.startsWith(`intake-uploads/${firmId}/`) || path.startsWith(`${firmId}/`)
      : path.startsWith(`intake-uploads/${firmId}/${access.userId}/`));
  if (!allowed && access.role !== 'legal') {
    // An employee can still open a document the legal team attached to THIS
    // ticket, which lives under the firm-wide documents prefix. Resolve it by
    // the row rather than by the prefix, so the rest of that tree stays shut.
    const { data: doc } = await access.admin
      .from('firm_documents')
      .select('id')
      .eq('intake_id', intakeId)
      .eq('firm_id', firmId)
      .eq('file_path', path)
      .maybeSingle();
    allowed = Boolean(doc);
  }
  if (!allowed) return { ok: false, error: 'That file is not part of this request.' };

  const { data, error } = await access.admin.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return { ok: false, error: 'Could not open that file.' };
  return { ok: true, url: data.signedUrl };
}

/** Assign (or unassign) the ticket. Legal team only. */
export async function assignIntakeAction(
  intakeId: string,
  userId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.role !== 'legal') return { ok: false, error: 'Only the legal team can assign a request.' };

  if (userId) {
    const { data: member } = await access.admin
      .from('firm_members')
      .select('user_id')
      .eq('firm_id', access.intake.firm_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!member) return { ok: false, error: 'Pick someone on the legal team.' };
  }

  await access.admin
    .from('firm_matter_intakes')
    .update({ assigned_to: userId, updated_at: new Date().toISOString() })
    .eq('id', intakeId);

  const people = await hydratePeople(access.admin, [access.userId, ...(userId ? [userId] : [])]);
  const actor = people.get(access.userId);
  const target = userId ? people.get(userId) : null;

  const message = await insertIntakeMessage({
    admin: access.admin,
    intake: access.intake,
    authorUserId: access.userId,
    authorName: actor?.name ?? 'Someone',
    authorRole: 'system',
    visibility: 'internal',
    body: target
      ? `${actor?.name ?? 'Someone'} assigned this request to ${target.name}.`
      : `${actor?.name ?? 'Someone'} removed the assignee.`,
    kind: 'event',
    eventType: 'assigned',
  });

  if (message && target && actor) {
    await notifyIntakeActivity({
      admin: access.admin,
      intake: { ...access.intake, assigned_to: userId },
      message: { ...message, mentions: [target.userId] },
      actor,
      eyebrow: 'Assigned to you',
      headline: () => `${actor.name} assigned ${refFor(access.intake)} to you`,
      ctaLabel: 'Open the request',
    });
  }

  revalidateIntake(intakeId);
  return { ok: true };
}

/** Invite a colleague onto the ticket so they see it and get its updates. */
export async function inviteToIntakeAction(
  intakeId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.role !== 'legal') {
    return { ok: false, error: 'Only the legal team can invite someone to a request.' };
  }

  const people = await hydratePeople(access.admin, [access.userId, userId]);
  const target = people.get(userId);
  if (!target) return { ok: false, error: 'Could not find that person.' };
  const actor = people.get(access.userId);

  const { error } = await access.admin.from('firm_intake_participants').insert({
    intake_id: intakeId,
    firm_id: access.intake.firm_id,
    user_id: userId,
    role: 'watcher',
    added_by: access.userId,
  });
  if (error && !/duplicate key/i.test(error.message)) {
    return { ok: false, error: 'Could not add them to this request.' };
  }

  const message = await insertIntakeMessage({
    admin: access.admin,
    intake: access.intake,
    authorUserId: access.userId,
    authorName: actor?.name ?? 'Someone',
    authorRole: 'system',
    // Adding a person is shared context: the requester should see who is helping.
    visibility: target.side === 'legal' ? 'internal' : 'shared',
    body: `${actor?.name ?? 'Someone'} added ${target.name} to this request.`,
    kind: 'event',
    eventType: 'participant_added',
  });

  if (message && actor) {
    await notifyIntakeActivity({
      admin: access.admin,
      intake: access.intake,
      message: { ...message, mentions: [userId] },
      actor,
      eyebrow: 'You were added to a request',
      headline: () => `${actor.name} added you to ${refFor(access.intake)}`,
      ctaLabel: 'Open the request',
    });
  }

  revalidateIntake(intakeId);
  return { ok: true };
}

export async function removeIntakeParticipantAction(
  intakeId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.role !== 'legal') return { ok: false, error: 'Only the legal team can do that.' };
  await access.admin
    .from('firm_intake_participants')
    .delete()
    .eq('intake_id', intakeId)
    .eq('user_id', userId);
  revalidateIntake(intakeId);
  return { ok: true };
}

/**
 * Create a "send us this file" link. The recipient does not need an Advottic
 * account; they open the link, drop the file, and it lands in the ticket.
 */
export async function createIntakeUploadRequestAction(
  intakeId: string,
  input: { label: string; note?: string; expiresInDays?: number },
): Promise<{ ok: boolean; error?: string; url?: string; token?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.role !== 'legal') {
    return { ok: false, error: 'Only the legal team can request documents.' };
  }
  const label = (input.label ?? '').trim();
  if (label.length < 3) return { ok: false, error: 'Say what you need, e.g. "the signed NDA".' };

  const days = Math.min(Math.max(Math.round(input.expiresInDays ?? 14), 1), 90);
  const token = crypto.randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const { error } = await access.admin.from('firm_intake_upload_requests').insert({
    intake_id: intakeId,
    firm_id: access.intake.firm_id,
    token,
    label: label.slice(0, 200),
    note: (input.note ?? '').trim().slice(0, 1000) || null,
    created_by: access.userId,
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: 'Could not create that link.' };

  const people = await hydratePeople(access.admin, [access.userId]);
  const actor = people.get(access.userId);
  const url = `${siteUrl()}/send/${token}`;

  const message = await insertIntakeMessage({
    admin: access.admin,
    intake: access.intake,
    authorUserId: access.userId,
    authorName: actor?.name ?? 'Legal team',
    authorRole: 'legal',
    visibility: 'shared',
    body: `${actor?.name ?? 'The legal team'} asked for: ${label}\n\nUse this secure link to send it: ${url}`,
    kind: 'event',
    eventType: 'document_requested',
  });

  if (message && actor) {
    await notifyIntakeActivity({
      admin: access.admin,
      intake: access.intake,
      message,
      actor,
      eyebrow: 'Documents requested',
      headline: (isRequester: boolean) =>
        isRequester
          ? `${actor.name} needs a document from you`
          : `${actor.name} requested a document on ${refFor(access.intake)}`,
      ctaLabel: 'Send the document',
    });
  }

  revalidateIntake(intakeId);
  return { ok: true, url, token };
}

export async function revokeIntakeUploadRequestAction(
  intakeId: string,
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const access = await resolveAccess(intakeId);
  if (!access.ok) return { ok: false, error: access.error };
  if (access.role !== 'legal') return { ok: false, error: 'Only the legal team can do that.' };
  await access.admin
    .from('firm_intake_upload_requests')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('intake_id', intakeId);
  revalidateIntake(intakeId);
  return { ok: true };
}

/**
 * Record a system event on the ticket timeline (status change, conversion…).
 * Callable from other server modules; never throws.
 */
export async function recordIntakeEventAction(
  intakeId: string,
  eventType: string,
  body: string,
  visibility: MessageVisibility = 'shared',
): Promise<void> {
  try {
    const admin = createAdminSupabase();
    if (!admin) return;
    const { data } = await admin
      .from('firm_matter_intakes')
      .select(INTAKE_COLS)
      .eq('id', intakeId)
      .maybeSingle();
    const intake = (data as IntakeRow | null) ?? null;
    if (!intake) return;
    await insertIntakeMessage({
      admin,
      intake,
      authorUserId: null,
      authorName: 'Advottic',
      authorRole: 'system',
      visibility,
      body,
      kind: 'event',
      eventType,
    });
    revalidateIntake(intakeId);
  } catch {
    /* the activity trail must never break the action that triggered it */
  }
}
