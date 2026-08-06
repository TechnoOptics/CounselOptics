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
  isEditableBySubmitter,
  reviewDecision,
} from './template-approval';
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

/** Values are only ever stored for fields the firm declared on the template. */
function sanitizeValues(
  fields: TemplateField[],
  values: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = trimTo((values ?? {})[f.key], 5000);
    if (v) out[f.key] = v;
  }
  return out;
}

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

async function loadTemplateForFill(
  admin: Admin,
  firmId: string,
  templateId: string,
): Promise<FirmTemplate | null> {
  const { data } = await admin
    .from('firm_templates')
    .select('*')
    .eq('firm_id', firmId)
    .eq('id', templateId)
    .eq('status', 'published')
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    firmId: String(r.firm_id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    body: String(r.body ?? ''),
    fields: Array.isArray(r.fields) ? (r.fields as TemplateField[]) : [],
    status: r.status as FirmTemplate['status'],
    requiresApproval: r.requires_approval !== false,
    createdAt: String(r.created_at),
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

function refresh(): void {
  revalidatePath('/portal/forms');
  revalidatePath('/counsel/forms/approvals');
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

  const template = await loadTemplateForFill(admin, firmId, templateId);
  if (!template) return { ok: false, error: 'That form is no longer available.' };

  const recipientEmail = trimTo(input.recipientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'Enter the recipient email address.' };
  }
  const signatureName = trimTo(input.signatureName, 120);
  if (!signatureName) return { ok: false, error: 'Type your full legal name as the signature.' };

  const values = sanitizeValues(template.fields, input.values);
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
  const people = await hydratePeople(
    admin,
    rows.map((r) => r.decided_by).filter((x): x is string => Boolean(x)),
  );
  return {
    ok: true,
    submissions: rows.map((r) =>
      rowToSubmission(r, r.decided_by ? (people.get(r.decided_by)?.name ?? null) : null),
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
  if (!isEditableBySubmitter(row.status)) {
    return { ok: false, error: 'This submission can no longer be edited.' };
  }
  const move = applySubmissionAction(row.status, 'resubmit');
  if (!move.ok) return { ok: false, error: move.error };

  const template = row.template_id
    ? await loadTemplateForFill(admin, row.firm_id, row.template_id)
    : null;
  if (!template) return { ok: false, error: 'That form is no longer available.' };

  const recipientEmail = trimTo(input.recipientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(recipientEmail)) {
    return { ok: false, error: 'Enter the recipient email address.' };
  }
  const signatureName = trimTo(input.signatureName, 120);
  if (!signatureName) return { ok: false, error: 'Type your full legal name as the signature.' };
  const values = sanitizeValues(template.fields, input.values);
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

/** The firm's review queue. Any member may read it. */
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
  const people = await hydratePeople(
    admin,
    rows.map((r) => r.decided_by).filter((x): x is string => Boolean(x)),
  );
  return {
    ok: true,
    canApprove: canApproveSubmissions(role),
    submissions: rows.map((r) =>
      rowToSubmission(r, r.decided_by ? (people.get(r.decided_by)?.name ?? null) : null),
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

  const people = await hydratePeople(admin, row.decided_by ? [row.decided_by] : []);
  return {
    ok: true,
    viewer: role ? 'legal' : 'submitter',
    canApprove: canApproveSubmissions(role),
    submission: rowToSubmission(
      row,
      row.decided_by ? (people.get(row.decided_by)?.name ?? null) : null,
    ),
  };
}

/**
 * The decision. Approving is what releases the document: the caller's role and
 * the record's state are checked together in reviewDecision(), the status is
 * moved with a conditional update so two reviewers cannot both approve, and
 * only then does the release helper run, which checks the stored record again
 * before anything leaves.
 */
export async function decideTemplateSubmissionAction(
  submissionId: string,
  action: 'approve' | 'request_changes',
  note?: string,
): Promise<{ ok: boolean; error?: string; status?: string; emailSent?: boolean }> {
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
    emailSent: released.ok ? released.emailSent : false,
  };
}

/** Retry a delivery that failed after an approval. Approvers only. */
export async function retryTemplateReleaseAction(
  submissionId: string,
): Promise<{ ok: boolean; error?: string; emailSent?: boolean }> {
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
  return { ok: true, emailSent: released.emailSent };
}

/**
 * Deliver an approved submission and record the outcome. The release helper
 * re-reads the row and refuses anything that is not approved, so this stays
 * safe wherever it is called from; a failure leaves the record approved and
 * retryable rather than losing the decision.
 */
async function sendApproved(
  admin: Admin,
  submissionId: string,
): Promise<{ ok: true; emailSent: boolean } | { ok: false; error: string }> {
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
      released_at: new Date().toISOString(),
      release_token: released.token,
      release_error: released.emailSent ? null : 'The recipient emails could not be sent.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'approved');
  return { ok: true, emailSent: released.emailSent };
}
