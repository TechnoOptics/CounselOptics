'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';
import { callerFirmRole, FIRM_MANAGE_ROLES } from './firm-authz';
import { getFirmByIdAdmin } from './firm-storage';
import { hydratePeople } from './intake-notify';
import { createNotification } from './notifications';
import { checkRateLimit } from './rate-limit';
import {
  formatSignedOn,
  mergeTemplateDocument,
} from './firm-template-placeholders';
import type { FirmTemplate, TemplateField } from './firm-templates';
import {
  applySubmissionAction,
  canApproveSubmissions,
  canReadSubmissionDocument,
  isEditableBySubmitter,
  reviewDecision,
  reviewEdit,
  type ReviewAction,
} from './template-approval';
import { loadPublishedTemplate, sanitizeTemplateValues } from './template-fill';
import { releaseApprovedSubmission } from './template-release';
import {
  rowToSubmission,
  type SubmissionInput,
  type SubmissionRow,
  type TemplateSubmission,
} from './template-submission-types';

/**
 * Employee template submissions and the legal approval gate.
 *
 * An employee fills a firm template, names the outside recipient, and submits.
 * The document goes to the legal team, not the recipient. Someone whose firm
 * role may release documents (see lib/template-approval.ts) reads exactly what
 * would be sent and either approves it, which delivers it, or sends it back
 * with a reason, which the employee can act on and resubmit.
 *
 * Every export of this module is a public HTTP endpoint, so each one resolves
 * the caller's own identity and firm role from the session; none of them trust
 * an id or a role passed in by the caller. Rows live behind RLS with no
 * policies, so the service-role client is used for the writes and the checks
 * here are the whole of the authorization.
 *
 * The document text is rebuilt on the server from the firm's own template and
 * the employee's field values, never taken from the request body: the reviewer
 * reads a document the firm actually authored.
 */

type Admin = NonNullable<ReturnType<typeof createAdminSupabase>>;

const SUBMISSION_COLS = '*';

function trimTo(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function missingRequired(fields: TemplateField[], values: Record<string, string>): string[] {
  return fields.filter((f) => f.required && !(values[f.key] ?? '').trim()).map((f) => f.label);
}

async function buildDocument(
  template: FirmTemplate,
  values: Record<string, string>,
  signatureName: string,
  signerEmail: string,
): Promise<string> {
  const firm = await getFirmByIdAdmin(template.firmId);
  return mergeTemplateDocument({
    body: template.body,
    fields: template.fields,
    values,
    firmName: firm?.name ?? 'the company',
    signatureName,
    signerEmail,
    signedOn: formatSignedOn(new Date()),
  });
}

/**
 * Every user id a set of rows names. A submission can name two people, the
 * one who decided it and the one who edited it, and hydrating only the first
 * is how "edited by" ends up blank on exactly the rows that have an editor.
 */
function namedIn(rows: readonly SubmissionRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.decided_by) ids.add(r.decided_by);
    if (r.edited_by) ids.add(r.edited_by);
  }
  return [...ids];
}

function refresh(): void {
  revalidatePath('/portal/forms');
  revalidatePath('/counsel/forms/approvals');
}

/**
 * The document the reviewer's own page rendered.
 *
 * Both the edit and the decision are conditional on this rather than on the row
 * the action has just read, and the difference is the whole point. A reviewer
 * sits with a document open for minutes; the gap between an action's own read
 * and its own write is milliseconds. Comparing against the fresh read closes
 * the millisecond and leaves the minutes open, which is how one reviewer's
 * edit disappears under another's, and how an approver ends up recorded as
 * having released text they never saw.
 *
 * A caller can of course send any string here, but the caller is already a
 * reviewer who could read the current text and send that. This is a lost-update
 * guard, not an authorization check; authorization is the role check above it.
 * An omitted argument arrives as '' and fails the comparison, so a caller who
 * leaves it out is told to reload rather than quietly getting the old
 * behaviour.
 */
function seenDocument(value: unknown): string {
  return String(value ?? '');
}

/** Tell the people who can act on it that a document is waiting. */
async function notifyApprovers(
  admin: Admin,
  row: SubmissionRow,
  actorUserId: string,
): Promise<void> {
  const { data } = await admin
    .from('firm_members')
    .select('user_id, role')
    .eq('firm_id', row.firm_id);
  const approvers = ((data ?? []) as { user_id: string; role: string }[]).filter((m) =>
    (FIRM_MANAGE_ROLES as readonly string[]).includes(m.role),
  );
  await Promise.all(
    approvers.map((m) =>
      createNotification({
        userId: m.user_id,
        type: 'system',
        title: 'A document is waiting for approval',
        body: `${row.submitter_name ?? 'A colleague'} filled ${row.template_name} for ${row.recipient_email}.`,
        link: `/counsel/forms/approvals/${row.id}`,
        actorUserId,
      }),
    ),
  );
}

// ── Employee side ─────────────────────────────────────────────────────────

/**
 * Submit a filled template for legal review. This is the only way an
 * approval-gated template starts its journey to a recipient.
 */
export async function submitTemplateForApprovalAction(
  firmId: string,
  templateId: string,
  input: SubmissionInput,
): Promise<{ ok: boolean; error?: string; submission?: TemplateSubmission }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.create');
  if (!actor.ok) return { ok: false, error: actor.error };

  const allowed = await checkRateLimit(`template-submit:${user.id}`, {
    limit: 20,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return { ok: false, error: 'You have sent a lot of documents for review. Try again later.' };
  }

  const template = await loadPublishedTemplate(admin, firmId, templateId);
  if (!template) return { ok: false, error: 'That form is no longer available.' };

  const recipientEmail = trimTo(input.recipientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'Enter the recipient email address.' };
  }
  const signatureName = trimTo(input.signatureName, 120);
  if (!signatureName) return { ok: false, error: 'Type your full legal name as the signature.' };

  const values = sanitizeTemplateValues(template.fields, input.values);
  const missing = missingRequired(template.fields, values);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these in first: ${missing.join(', ')}.` };
  }

  const people = await hydratePeople(admin, [user.id]);
  const submitterName = people.get(user.id)?.name ?? user.email ?? null;
  const documentText = await buildDocument(template, values, signatureName, user.email ?? '');

  const { data, error } = await admin
    .from('firm_template_submissions')
    .insert({
      firm_id: firmId,
      template_id: template.id,
      template_name: template.name,
      submitted_by: user.id,
      submitter_name: submitterName,
      submitter_email: user.email ?? null,
      recipient_name: trimTo(input.recipientName, 160) || null,
      recipient_email: recipientEmail,
      recipient_note: trimTo(input.recipientNote, 500) || null,
      field_values: values,
      signature_name: signatureName,
      document_text: documentText,
      status: 'pending',
    })
    .select(SUBMISSION_COLS)
    .single();
  if (error || !data) {
    return { ok: false, error: 'Could not send that for review. Try again.' };
  }

  const row = data as SubmissionRow;
  await notifyApprovers(admin, row, user.id);
  refresh();
  return { ok: true, submission: rowToSubmission(row) };
}

/** The submissions the signed-in employee has filed, newest first. */
export async function listMyTemplateSubmissionsAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string; submissions?: TemplateSubmission[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: actor.error };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('firm_id', firmId)
    .eq('submitted_by', user.id)
    .order('submitted_at', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as SubmissionRow[];
  const people = await hydratePeople(admin, namedIn(rows));
  return {
    ok: true,
    submissions: rows.map((r) =>
      rowToSubmission(r, (id) => people.get(id)?.name ?? null),
    ),
  };
}

/** Fix and resend a submission the legal team sent back. */
export async function resubmitTemplateSubmissionAction(
  submissionId: string,
  input: SubmissionInput,
): Promise<{ ok: boolean; error?: string; submission?: TemplateSubmission }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row || row.submitted_by !== user.id) {
    return { ok: false, error: 'That submission could not be found.' };
  }
  // Owning the row is not the same as still being entitled to file one. A
  // person who has left, or whose portal role no longer includes filing, must
  // not be able to push work back into the legal team's queue, so this asks
  // the same question the original submission did.
  const actor = await authorizeFirmActor(admin, row.firm_id, user.id, 'requests.create');
  if (!actor.ok) return { ok: false, error: actor.error };
  if (!isEditableBySubmitter(row.status)) {
    return { ok: false, error: 'This submission can no longer be edited.' };
  }
  const move = applySubmissionAction(row.status, 'resubmit');
  if (!move.ok) return { ok: false, error: move.error };

  const template = row.template_id
    ? await loadPublishedTemplate(admin, row.firm_id, row.template_id)
    : null;
  if (!template) return { ok: false, error: 'That form is no longer available.' };

  const recipientEmail = trimTo(input.recipientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'Enter the recipient email address.' };
  }
  const signatureName = trimTo(input.signatureName, 120);
  if (!signatureName) return { ok: false, error: 'Type your full legal name as the signature.' };
  const values = sanitizeTemplateValues(template.fields, input.values);
  const missing = missingRequired(template.fields, values);
  if (missing.length > 0) {
    return { ok: false, error: `Fill these in first: ${missing.join(', ')}.` };
  }

  const documentText = await buildDocument(
    template,
    values,
    signatureName,
    row.submitter_email ?? user.email ?? '',
  );

  const { data: updated } = await admin
    .from('firm_template_submissions')
    .update({
      recipient_email: recipientEmail,
      recipient_name: trimTo(input.recipientName, 160) || null,
      recipient_note: trimTo(input.recipientNote, 500) || null,
      field_values: values,
      signature_name: signatureName,
      document_text: documentText,
      status: move.status,
      revision: row.revision + 1,
      // A new revision carries no approval. Clearing these keeps the release
      // gate from ever seeing an approver against a document that changed.
      decided_by: null,
      decided_at: null,
      // Nor any reviewer edit. The employee has just rewritten the document,
      // so a previous reviewer's wording is gone and the copy of "what the
      // employee submitted" would otherwise point at the wrong revision.
      original_document_text: null,
      edited_by: null,
      edited_at: null,
      edit_note: null,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', row.status)
    .select(SUBMISSION_COLS)
    .maybeSingle();
  if (!updated) return { ok: false, error: 'Could not resend that for review.' };

  await notifyApprovers(admin, updated as SubmissionRow, user.id);
  refresh();
  return { ok: true, submission: rowToSubmission(updated as SubmissionRow) };
}

/** Pull a submission back before the legal team has decided on it. */
export async function withdrawTemplateSubmissionAction(
  submissionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row || row.submitted_by !== user.id) {
    return { ok: false, error: 'That submission could not be found.' };
  }
  // Owning the row is not standing to act on it. `requests.view` is the
  // baseline every active employee holds, so this asks the one question that
  // matters here: are they still part of this firm at all.
  const actor = await authorizeFirmActor(admin, row.firm_id, user.id, 'requests.view');
  if (!actor.ok) return { ok: false, error: actor.error };
  const move = applySubmissionAction(row.status, 'withdraw');
  if (!move.ok) return { ok: false, error: move.error };

  await admin
    .from('firm_template_submissions')
    .update({ status: move.status, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', row.status);
  refresh();
  return { ok: true };
}

// ── Legal side ────────────────────────────────────────────────────────────

/**
 * The firm's review queue. Any member may read the queue; the wording of a
 * document that has not been cleared for release is narrower than that, see
 * canReadSubmissionDocument.
 */
export async function listFirmTemplateSubmissionsAction(
  firmId: string,
): Promise<{
  ok: boolean;
  error?: string;
  submissions?: TemplateSubmission[];
  canApprove?: boolean;
}> {
  const role = await callerFirmRole(firmId);
  if (!role) return { ok: false, error: 'No access to this firm.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('firm_id', firmId)
    .order('submitted_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as SubmissionRow[];
  const people = await hydratePeople(admin, namedIn(rows));
  const user = await getCurrentUser();
  return {
    ok: true,
    canApprove: canApproveSubmissions(role),
    submissions: rows.map((r) =>
      rowToSubmission(
        r,
        (id) => people.get(id)?.name ?? null,
        canReadSubmissionDocument({
          role,
          isSubmitter: r.submitted_by === user?.id,
          status: r.status,
        }),
      ),
    ),
  };
}

/** One submission, for the reviewer or for the employee who filed it. */
export async function getTemplateSubmissionAction(submissionId: string): Promise<{
  ok: boolean;
  error?: string;
  submission?: TemplateSubmission;
  viewer?: 'legal' | 'submitter';
  canApprove?: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  const role = await callerFirmRole(row.firm_id);
  const isSubmitter = row.submitted_by === user.id;
  if (!role && !isSubmitter) return { ok: false, error: 'You do not have access to this document.' };

  const people = await hydratePeople(admin, namedIn([row]));
  return {
    ok: true,
    viewer: role ? 'legal' : 'submitter',
    canApprove: canApproveSubmissions(role),
    submission: rowToSubmission(
      row,
      (id) => people.get(id)?.name ?? null,
      canReadSubmissionDocument({ role, isSubmitter, status: row.status }),
    ),
  };
}

/**
 * The decision. Approving is what releases the document: the caller's role and
 * the record's state are checked together in reviewDecision(), the status is
 * moved with a conditional update so two reviewers cannot both approve, and
 * only then does the release helper run, which checks the stored record again
 * before anything leaves.
 *
 * Declining is a third outcome and not a variant of the second. It ends the
 * submission where sending it back keeps it alive, so it takes a different
 * branch here, a different status on the row, and different wording to the
 * employee: nobody is left waiting to be told what to change on a document
 * that is not going out. A declined row can never be released, because
 * checkReleasable and the release claim both require the status 'approved'
 * and nothing moves a declined row back to it.
 *
 * The decision is also conditional on the wording the reviewer's page rendered.
 * The premise of this gate is that a person with release authority read THIS
 * document, and the reviewer edit gives the document a way to change while they
 * are reading it. Without this, a reviewer who opened the page at ten o'clock
 * could approve at five past and release a version a colleague wrote at one
 * past, with their own name recorded as the approver of text they never saw.
 */
export async function decideTemplateSubmissionAction(
  submissionId: string,
  action: ReviewAction,
  note?: string,
  seenDocumentText?: string,
): Promise<{ ok: boolean; error?: string; status?: string; deliveryError?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  const role = await callerFirmRole(row.firm_id);
  const decision = reviewDecision({ role, current: row.status, action, note });
  if (!decision.ok) return { ok: false, error: decision.error };

  const seen = seenDocument(seenDocumentText);
  if (seen !== row.document_text) {
    return {
      ok: false,
      error:
        'The wording changed while this was open. Reload it, read the current version, and decide again.',
    };
  }

  const { data: updated } = await admin
    .from('firm_template_submissions')
    .update({
      status: decision.status,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_note: trimTo(note, 2000) || null,
      release_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'pending')
    // The check above is against a row read a moment ago; this one is against
    // the row at the instant of the write, and it is what actually holds.
    .eq('document_text', seen)
    .select(SUBMISSION_COLS)
    .maybeSingle();
  if (!updated) return { ok: false, error: 'Someone else has already acted on this submission.' };

  const fresh = updated as SubmissionRow;
  const people = await hydratePeople(admin, [user.id]);
  const actorName = people.get(user.id)?.name ?? 'The legal team';

  if (decision.status === 'changes_requested') {
    await createNotification({
      userId: fresh.submitted_by,
      type: 'system',
      title: `${fresh.template_name} needs a change before it goes out`,
      body: trimTo(note, 300) || 'Open it to see what to adjust.',
      link: `/portal/forms/submissions/${fresh.id}`,
      actorUserId: user.id,
    });
    refresh();
    return { ok: true, status: fresh.status };
  }

  if (decision.status === 'declined') {
    // Says plainly that it is finished and gives the reason, so nobody sits
    // waiting for a change request that is not coming. It reports a decision
    // about the document, never about the person who filled it in.
    await createNotification({
      userId: fresh.submitted_by,
      type: 'system',
      title: `${fresh.template_name} is not going out`,
      body: trimTo(note, 300) || 'Open it to see what the legal team said.',
      link: `/portal/forms/submissions/${fresh.id}`,
      actorUserId: user.id,
    });
    refresh();
    return { ok: true, status: fresh.status };
  }

  const released = await sendApproved(admin, fresh.id);
  await createNotification({
    userId: fresh.submitted_by,
    type: 'system',
    title: released.ok
      ? `${actorName} approved ${fresh.template_name}`
      : `${actorName} approved ${fresh.template_name}, delivery is pending`,
    body: released.ok
      ? `It has been sent to ${fresh.recipient_email}.`
      : 'Legal has approved it. The delivery did not go through yet and can be retried.',
    link: `/portal/forms/submissions/${fresh.id}`,
    actorUserId: user.id,
  });
  refresh();
  return {
    ok: true,
    status: released.ok ? 'sent' : 'approved',
    deliveryError: released.ok ? undefined : released.error,
  };
}

/**
 * The reviewer's edit of a document that is waiting on them.
 *
 * The document carries a colleague's typed signature, so counsel changing it
 * silently would put counsel's words out under the employee's name. Nothing
 * here is silent. The employee's own text is copied into
 * original_document_text on the first edit and never touched again, the
 * editor and the time are stamped on the row, the reason is kept, and the
 * employee is told. document_text is what the release helper sends, so the
 * document that goes out is traceably the edited one and the submitted one is
 * still on the record beside it.
 *
 * The write is conditional on the status AND on the text the reviewer's page
 * rendered, which is what seenDocumentText carries. Two reviewers editing the
 * same document at once therefore cannot silently overwrite one another: the
 * second one is told to reload rather than having their colleague's wording
 * disappear under them, and the record never shows a jump from the first
 * version to the third with the second missing.
 */
export async function editTemplateSubmissionAction(
  submissionId: string,
  documentText: string,
  note?: string,
  seenDocumentText?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionRow | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  const seen = seenDocument(seenDocumentText);
  const role = await callerFirmRole(row.firm_id);
  const edit = reviewEdit({
    role,
    current: row.status,
    currentText: seen,
    nextText: String(documentText ?? ''),
    hasOriginal: Boolean(row.original_document_text),
  });
  if (!edit.ok) return { ok: false, error: edit.error };

  const stale =
    'This document has changed since you opened it. Reload it, read the current wording, and make the change again.';
  if (seen !== row.document_text) return { ok: false, error: stale };

  const { data: updated, error } = await admin
    .from('firm_template_submissions')
    .update({
      document_text: edit.documentText,
      // The compare-and-swap below guarantees the stored text is `seen` at the
      // moment of the write, so this preserves exactly what was on the row and
      // not what an earlier read happened to see.
      ...(edit.preserveOriginal ? { original_document_text: seen } : {}),
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: trimTo(note, 2000) || null,
      // Same signal a resubmission gives: the document is not the one anyone
      // else has open, and the queue shows a new version number for it.
      revision: row.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'pending')
    .eq('document_text', seen)
    .select('id')
    .maybeSingle();
  if (error) {
    return { ok: false, error: 'That change could not be saved just now. Try again shortly.' };
  }
  if (!updated) return { ok: false, error: stale };

  const people = await hydratePeople(admin, [user.id]);
  const actorName = people.get(user.id)?.name ?? 'The legal team';
  await createNotification({
    userId: row.submitted_by,
    type: 'system',
    title: `${actorName} adjusted the wording of ${row.template_name}`,
    body: trimTo(note, 300) || 'You can read the current wording and the version you sent.',
    link: `/portal/forms/submissions/${row.id}`,
    actorUserId: user.id,
  });
  refresh();
  return { ok: true };
}

/** Retry a delivery that failed after an approval. Approvers only. */
export async function retryTemplateReleaseAction(
  submissionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data } = await admin
    .from('firm_template_submissions')
    .select('firm_id')
    .eq('id', submissionId)
    .maybeSingle();
  const firmId = (data as { firm_id: string } | null)?.firm_id;
  if (!firmId) return { ok: false, error: 'That submission could not be found.' };

  const role = await callerFirmRole(firmId);
  if (!canApproveSubmissions(role)) {
    return { ok: false, error: 'Your role cannot release documents.' };
  }

  const released = await sendApproved(admin, submissionId);
  refresh();
  if (!released.ok) return { ok: false, error: released.error };
  return { ok: true };
}

/**
 * Deliver an approved submission and record the outcome.
 *
 * The release helper owns the whole delivery: it re-reads the row, refuses
 * anything that is not approved, claims the release so a second caller cannot
 * repeat it, and gives the claim back if any part of the send fails. So a
 * failure here always leaves the record approved, unclaimed, and retryable,
 * and only a genuinely complete delivery reaches the status write below.
 */
async function sendApproved(
  admin: Admin,
  submissionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const released = await releaseApprovedSubmission(admin, submissionId);
  if (!released.ok) {
    await admin
      .from('firm_template_submissions')
      .update({ release_error: released.error, updated_at: new Date().toISOString() })
      .eq('id', submissionId);
    return { ok: false, error: released.error };
  }
  const move = applySubmissionAction('approved', 'mark_sent');
  if (!move.ok) return { ok: false, error: move.error };
  await admin
    .from('firm_template_submissions')
    .update({
      status: move.status,
      release_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'approved');
  return { ok: true };
}
