'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { authorizeFirmActor } from './portal-entitlements';
import { callerFirmRole, FIRM_MANAGE_ROLES } from './firm-authz';
import type { FirmRole } from './firm-types';
import { MAX_BULK_SEND_BACK, type BulkSendBackResult } from './approval-queue';
import { getFirmByIdAdmin } from './firm-storage';
import { hydratePeople } from './intake-notify';
import { createNotification } from './notifications';
import { checkRateLimit } from './rate-limit';
import {
  counterpartyLabel,
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
import {
  claimedSignatureMethod,
  decideSignatureMethod,
} from './signature-methods';
import { spendPhoneMarkAttestation } from './mark-handoff-queries';
import { employeeFieldsOf } from './counterparty-fields';
import { fieldFormatRefusal } from './template-field-formats';
import { releaseApprovedSubmission } from './template-release';
import {
  checkDispatchable,
  counterSignatureParty,
  resolveDispatchMode,
  type DeliveryMode,
} from './submission-dispatch';
import { isUnknownColumnError } from './signer-view';
import { materializeSubmissionDocument } from './submission-document';
import { loadSubmissionSigning } from './submission-completion';
import { categoryForRecord } from './document-category';
import { allocateSubmissionTicket } from './ticket-allocator';
import { displayTicket } from './ticket-numbers';
import { createSigningRequestAction } from './firm-actions';
import {
  CLEARED_SIGNATURE_COLUMNS,
  decodeSignaturePng,
  signatureColumns,
  storeSubmissionMark,
} from './template-signature';
import {
  rowToSubmission,
  type SubmissionInput,
  type SubmissionRow,
  type SubmissionSigning,
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

/**
 * The stored row plus the two pointers 20260807_flow_join.sql adds. Both are
 * optional on the type as well as nullable in the database, because until the
 * owner applies that migration the columns are simply not there and every read
 * of them is undefined.
 */
type DispatchRow = SubmissionRow & {
  document_id?: string | null;
  signing_request_id?: string | null;
};

/**
 * Write the mode this document_text was merged under alongside it, and fall
 * back to writing neither when the column is not there yet.
 *
 * The two always move together: the text is merged from the template's mode at
 * the same moment, so a row that records one without the other is the
 * desynchronisation resolveDispatchMode exists to prevent.
 *
 * Retrying without the column is right in this direction and only this one. An
 * absent mode reads as "ask the template", which is exactly what dispatch did
 * before this column existed, so a firm that has not applied
 * 20260807_flow_join.sql keeps today's behaviour rather than losing the
 * ability to file a document at all. That is the opposite of the template
 * write's answer (resolveDeliveryModeColumnFallback), and for a good reason:
 * there, dropping the mode silently changed what the legal team had chosen.
 */
type WriteError = { code?: string | null; message?: string | null } | null;

async function writeWithDeliveryMode<T>(
  write: (extra: Record<string, unknown>) => PromiseLike<{ data: T | null; error: WriteError }>,
  deliveryMode: DeliveryMode,
): Promise<{ data: T | null; error: WriteError }> {
  const first = await write({ delivery_mode: deliveryMode });
  if (!isUnknownColumnError(first.error, 'delivery_mode')) return first;
  return await write({});
}

const SUBMISSION_COLS = '*';

function trimTo(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which of the EMPLOYEE'S required answers are still blank.
 *
 * The other side's fields are not the employee's to answer and are not asked
 * of them, so requiring one here would refuse a submission for a blank that
 * has no input on the page. Those are checked on the signing surface instead
 * (missingCounterpartyFields), against the same required flag.
 */
function missingRequired(fields: TemplateField[], values: Record<string, string>): string[] {
  return employeeFieldsOf(fields)
    .filter((f) => f.required && !(values[f.key] ?? '').trim())
    .map((f) => f.label);
}

async function buildDocument(
  template: FirmTemplate,
  values: Record<string, string>,
  signatureName: string,
  signerEmail: string,
  recipient: { name?: string | null; email?: string | null },
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
    deliveryMode: template.deliveryMode,
    // A template that goes out for signature carries a block for the other
    // side. The employee's preview passes this same rule through the same
    // helper, so what they read on the page and what the reviewer reads are
    // still one function's output.
    counterpartyName: counterpartyLabel({
      deliveryMode: template.deliveryMode,
      recipientName: recipient.name,
      recipientEmail: recipient.email,
    }),
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
 * What the reviewer's own page rendered: the wording, and the revision it
 * carried.
 *
 * Both the edit and the decision are conditional on what the reviewer read
 * rather than on the row the action has just read, and the difference is the
 * whole point. A reviewer sits with a document open for minutes; the gap
 * between an action's own read and its own write is milliseconds. Comparing
 * against the fresh read closes the millisecond and leaves the minutes open,
 * which is how one reviewer's edit disappears under another's, and how an
 * approver ends up recorded as having released text they never saw.
 *
 * Two values carry that, and they do different jobs.
 *
 * `revision` is what the conditional update swaps on. A PostgREST filter is a
 * query-string parameter on a PATCH exactly as on a GET, so `.eq('document_
 * text', seen)` puts the whole merged agreement in the request URL. A short
 * vendor form fits; a real mutual NDA does not, and the write then fails on
 * every ordinary document rather than on a race. `revision` says the same
 * thing in a few bytes: it is bumped on every write that changes document_text
 * (the submission inserts it at 1, a resubmission and a reviewer edit each add
 * one) and on no other write, so an unchanged revision means unchanged text.
 *
 * The wording is still sent and still compared, but only against the row this
 * action has just read, where its length costs nothing. That comparison is
 * there to word the error: it tells "a colleague rewrote this while you had it
 * open" apart from a bare lost race.
 *
 * A caller can of course send any values here, but the caller is already a
 * reviewer who could read the current row and send that back. This is a
 * lost-update guard, not an authorization check; authorization is the role
 * check above it. An omitted document arrives as '' and an omitted or
 * malformed revision arrives as -1, which no stored row can hold, so a caller
 * who leaves either out is told to reload rather than quietly getting the old
 * behaviour.
 */
function seenDocument(value: unknown): string {
  return String(value ?? '');
}

/** -1 for anything that is not a stored revision, so a missing baseline fails closed. */
function seenRevision(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : -1;
}

/**
 * Was this a way of signing the firm agreed to accept?
 *
 * The firm chooses per template, and until now the employee's own signature
 * was the one signature in the product that ignored the choice: the pad
 * offered all three modes whatever the template said, and nothing on the way
 * in looked. So a template restricted to a typed name was signed with an
 * uploaded photograph and the row recorded it without complaint.
 *
 * THE PHONE IS DECIDED BY THE SERVER, and that is the whole reason this
 * function takes a handoff id rather than a method. A page claiming 'phone'
 * would be a page's word for it, and a restriction one string wide is not a
 * restriction. What is checked instead is a row: found under this caller's own
 * user, firm and template, carrying a fingerprint left by a phone that burned
 * a one-time token and holds the cookie bound to it, and matching the bytes
 * being submitted now. claimedSignatureMethod then translates the pad's own
 * vocabulary for every other case, and reads a caller that simply says 'phone'
 * as having said nothing.
 *
 * WHAT THIS DOES AND DOES NOT PROVE, stated rather than left to be discovered.
 * It proves the mark was made by a device that was handed the one-time code,
 * burned it, and holds the cookie bound to that claim. It does NOT prove that
 * device was a different one from the desk: the QR is rendered into the desk's
 * own page, so the employee can decode it from their own screen and claim it
 * from the same browser. The residual is therefore an employee satisfying
 * their own firm's phone-only restriction without picking up a phone. No
 * tenant or user boundary is crossed, and the same residual exists on the
 * outside signer's handoff. It is left open deliberately: the obvious closure,
 * refusing a claim whose user agent matches the desk, is a heuristic that
 * would wrongly refuse real phones and strand the employee on exactly the
 * template this whole change exists to unblock.
 *
 * Called immediately before the write and not earlier, because verifying the
 * attestation spends it: one phone mark signs one document. Everything that
 * can refuse a submission for a reason unrelated to signing has already run by
 * then, so a refusal here does not burn a mark the employee will need again.
 */
async function guardSignatureMethod(input: {
  /**
   * The template's parsed restriction. Undefined is accepted and reads as no
   * restriction, which is the same answer null gives and the same answer a
   * database without 20260814_signature_methods.sql produces. A gate that
   * threw on a column that is not there yet would refuse every submission in
   * the product.
   */
  allowed: Parameters<typeof decideSignatureMethod>[0]['allowed'] | undefined;
  userId: string;
  firmId: string;
  templateId: string;
  submission: SubmissionInput;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const handoffId =
    typeof input.submission.signatureHandoffId === 'string'
      ? input.submission.signatureHandoffId.trim()
      : '';

  const attestedPhone = handoffId
    ? await spendPhoneMarkAttestation({
        handoffId,
        userId: input.userId,
        firmId: input.firmId,
        templateId: input.templateId,
        signatureDataUrl: input.submission.signatureDataUrl,
      })
    : false;

  const decision = decideSignatureMethod({
    allowed: input.allowed ?? null,
    claimed: claimedSignatureMethod({
      attestedPhone,
      padMode: input.submission.signatureMode,
    }),
  });
  return decision.ok ? { ok: true } : { ok: false, error: decision.error };
}

/**
 * Store the employee's mark and write the record around it.
 *
 * This runs after the write that creates or updates the submission, and it
 * cannot fail that write. A document that reached the legal team without its
 * squiggle is recoverable by asking the colleague to sign again; a submission
 * that vanished because a picture would not upload is not. So a bad image, a
 * storage outage or a refused update all leave the row exactly as the caller's
 * own write left it, and the submission still goes to the queue.
 *
 * It returns the row as it now stands, so the employee is handed back the
 * record that was actually written rather than the one from a moment earlier.
 *
 * The update swaps on the revision for the same reason every other write in
 * this file does. A reviewer can edit a submission in the gap between it being
 * filed and its mark being stored; a reviewer edit bumps the revision and
 * clears the signature columns, and without this predicate the mark would land
 * on top of that and claim the new wording had been signed. The mark is then
 * lost rather than misattached, which is the right way round.
 *
 * The mark itself is not deleted from storage when this update misses. It is
 * keyed by revision, so it sits beside the revision it belongs to and is
 * simply not pointed at.
 */
async function recordSignature(
  admin: Admin,
  row: SubmissionRow,
  input: SubmissionInput,
  documentText: string,
): Promise<SubmissionRow> {
  try {
    const decoded = decodeSignaturePng(input.signatureDataUrl);
    const markPath = decoded.ok
      ? await storeSubmissionMark(admin, {
          firmId: row.firm_id,
          submissionId: row.id,
          revision: row.revision,
          bytes: decoded.bytes,
        })
      : null;
    const h = headers();
    const columns = signatureColumns({
      markPath,
      mode: input.signatureMode,
      // Read as "the box was ticked", never as when. See signatureColumns.
      intentAffirmed: Boolean(input.signatureIntentAt),
      ip:
        (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ||
        h.get('x-real-ip'),
      userAgent: h.get('user-agent'),
      documentText,
      now: new Date(),
    });
    const { data } = await admin
      .from('firm_template_submissions')
      .update(columns)
      .eq('id', row.id)
      .eq('revision', row.revision)
      .select(SUBMISSION_COLS)
      .maybeSingle();
    return (data as SubmissionRow | null) ?? row;
  } catch {
    return row;
  }
}

/**
 * Put the two filing facts onto a record that has just been created: what
 * kind of document it is, and the firm's reference for it.
 *
 * BOTH ARE WRITTEN AFTER THE INSERT, NOT IN IT, AND THAT IS THE WHOLE DESIGN
 * OF THIS FUNCTION. Their columns arrive with 20260807_flow_join.sql, which
 * the owner has not applied. PostgREST refuses an insert that names a column
 * the table does not have, so putting either of these in the insert above
 * would stop every employee in every firm from filing anything at all until
 * the migration ran. Written separately, an unmigrated database fails these
 * two writes, keeps the submission, and both queues look exactly as they look
 * today.
 *
 * Neither failure is fatal for the same reason. The employee's document
 * reaches the legal team either way; a record with no number shows the
 * derived reference instead (displayTicket), and a record with no category is
 * grouped under Unfiled. A colleague's work must not be lost because a
 * counter would not move.
 *
 * The row is patched in memory rather than re-read. The values are the ones
 * just written and a third round trip would tell us nothing new.
 */
async function stampFiling(
  admin: Admin,
  row: SubmissionRow,
  category: string | null,
): Promise<SubmissionRow> {
  const stamped: SubmissionRow = { ...row };

  if (category) {
    const { error } = await admin
      .from('firm_template_submissions')
      .update({ category })
      .eq('id', row.id);
    if (error) console.warn('[submitTemplate] category not stored', error.message);
    else stamped.category = category;
  }

  const allocated = await allocateSubmissionTicket(admin, {
    firmId: row.firm_id,
    submissionId: row.id,
  });
  if (allocated.ok) stamped.ticket_number = allocated.ticketNumber;
  else console.warn('[submitTemplate] ticket number not allocated', allocated.error);

  return stamped;
}

/**
 * The reference this record is quoted by, everywhere it is mentioned.
 *
 * One helper, called from one place per message, so a document is never
 * referred to two different ways in two different notifications about it.
 */
function refOf(row: SubmissionRow): string {
  return displayTicket({ ticketNumber: row.ticket_number, id: row.id });
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
        body: `${refOf(row)} \u00b7 ${row.submitter_name ?? 'A colleague'} filled ${row.template_name} for ${row.recipient_email}.`,
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
  // AFTER the emptiness check, so a blank required answer is reported as blank
  // rather than as the wrong shape. This is the gate: the fill page runs the
  // same rule to say what to fix without a round trip, but this export is a
  // public HTTP endpoint and a pattern in a browser is a hint.
  const wrongFormat = fieldFormatRefusal(employeeFieldsOf(template.fields), values);
  if (wrongFormat) return { ok: false, error: wrongFormat };

  const people = await hydratePeople(admin, [user.id]);
  const submitterName = people.get(user.id)?.name ?? user.email ?? null;
  const recipientName = trimTo(input.recipientName, 160) || null;
  const documentText = await buildDocument(template, values, signatureName, user.email ?? '', {
    name: recipientName,
    email: recipientEmail,
  });

  const methodGate = await guardSignatureMethod({
    allowed: template.signatureMethods,
    userId: user.id,
    firmId,
    templateId: template.id,
    submission: input,
  });
  if (!methodGate.ok) return { ok: false, error: methodGate.error };

  const { data, error } = await writeWithDeliveryMode<SubmissionRow>(
    (extra) =>
      admin
        .from('firm_template_submissions')
        .insert({
          firm_id: firmId,
          template_id: template.id,
          template_name: template.name,
          submitted_by: user.id,
          submitter_name: submitterName,
          submitter_email: user.email ?? null,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          recipient_note: trimTo(input.recipientNote, 500) || null,
          field_values: values,
          signature_name: signatureName,
          document_text: documentText,
          status: 'pending',
          ...extra,
        })
        .select(SUBMISSION_COLS)
        .single(),
    template.deliveryMode,
  );
  if (error || !data) {
    return { ok: false, error: 'Could not send that for review. Try again.' };
  }

  const signed = await recordSignature(admin, data as SubmissionRow, input, documentText);
  // The category is COPIED from the template, not joined from it at read
  // time. A template can be recategorised or archived months later, and the
  // submission has to keep the category it was actually filed under, because
  // that is what the record is asserting. The number goes on before anyone is
  // told about the document, so the first notification a reviewer sees
  // already quotes the reference they will use for it.
  const row = await stampFiling(admin, signed, categoryForRecord(template.category));
  await notifyApprovers(admin, row, user.id);
  refresh();
  // Back to the colleague who just filled it in, so their own words go back to
  // them. rowToSubmission withholds the wording unless it is told otherwise.
  return { ok: true, submission: rowToSubmission(row, undefined, true) };
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
    // Every row here was filed by the caller, so every one of them is their
    // own words and their own signature.
    submissions: rows.map((r) =>
      rowToSubmission(r, (id) => people.get(id)?.name ?? null, true),
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
  // AFTER the emptiness check, so a blank required answer is reported as blank
  // rather than as the wrong shape. This is the gate: the fill page runs the
  // same rule to say what to fix without a round trip, but this export is a
  // public HTTP endpoint and a pattern in a browser is a hint.
  const wrongFormat = fieldFormatRefusal(employeeFieldsOf(template.fields), values);
  if (wrongFormat) return { ok: false, error: wrongFormat };

  const recipientName = trimTo(input.recipientName, 160) || null;
  const documentText = await buildDocument(
    template,
    values,
    signatureName,
    row.submitter_email ?? user.email ?? '',
    { name: recipientName, email: recipientEmail },
  );

  const methodGate = await guardSignatureMethod({
    allowed: template.signatureMethods,
    userId: user.id,
    firmId: row.firm_id,
    templateId: template.id,
    submission: input,
  });
  if (!methodGate.ok) return { ok: false, error: methodGate.error };

  const { data: updated } = await writeWithDeliveryMode<SubmissionRow>(
    (extra) =>
      admin
        .from('firm_template_submissions')
        .update({
          recipient_email: recipientEmail,
          recipient_name: recipientName,
          recipient_note: trimTo(input.recipientNote, 500) || null,
          field_values: values,
          signature_name: signatureName,
          document_text: documentText,
          status: move.status,
          revision: row.revision + 1,
          // A new revision carries no approval. Clearing these keeps the
          // release gate from ever seeing an approver against a document that
          // changed.
          decided_by: null,
          decided_at: null,
          // Nor any reviewer edit. The employee has just rewritten the
          // document, so a previous reviewer's wording is gone and the copy of
          // "what the employee submitted" would otherwise point at the wrong
          // revision.
          original_document_text: null,
          edited_by: null,
          edited_at: null,
          edit_note: null,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...extra,
        })
        .eq('id', submissionId)
        .eq('status', row.status)
        .select(SUBMISSION_COLS)
        .maybeSingle(),
    template.deliveryMode,
  );
  if (!updated) return { ok: false, error: 'Could not resend that for review.' };

  // The new revision is a new document, so it gets a new mark and a new hash
  // over the words the employee has just affirmed. The previous revision's
  // PNG stays where it is, keyed by its own revision number.
  const recorded = await recordSignature(
    admin,
    updated as SubmissionRow,
    input,
    documentText,
  );
  await notifyApprovers(admin, recorded, user.id);
  refresh();
  // The caller is the submitter; ownership was checked above.
  return { ok: true, submission: rowToSubmission(recorded, undefined, true) };
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

  // Claimed on the status this page was rendered from, and read back. The
  // `.eq('status', ...)` is the whole point of the write: it exists so a
  // reviewer who decides between the render and the click wins. Unread, the
  // exact race it guards against matched zero rows, came back with error
  // null, and was reported to the employee as a withdrawal, while the
  // document stayed in the queue for counsel to approve out to a third
  // party. A zero-row match here is not a failure to say sorry for, it is a
  // fact about what happened, so say that instead.
  const { data: withdrawn, error } = await admin
    .from('firm_template_submissions')
    .update({ status: move.status, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', row.status)
    .select('id');
  if (error) {
    return { ok: false, error: 'Could not withdraw that. Please try again.' };
  }
  if (!withdrawn || withdrawn.length === 0) {
    return {
      ok: false,
      error:
        'Somebody decided this while you were reading it, so it was not withdrawn. Reload the page to see where it stands.',
    };
  }
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

/**
 * One submission, for the reviewer or for the employee who filed it.
 *
 * `signing` is present only for a submission that went out for signature, and
 * it is what closes the loop for the employee: until this, nothing on any
 * portal surface read a signing request at all, so the colleague who filed a
 * document was never shown the signed version of it.
 *
 * The executed copy is gated on the same predicate as the wording, and the
 * link is minted server-side and short-lived. See loadSubmissionSigning.
 */
export async function getTemplateSubmissionAction(submissionId: string): Promise<{
  ok: boolean;
  error?: string;
  submission?: TemplateSubmission;
  signing?: SubmissionSigning | null;
  viewer?: 'legal' | 'submitter';
  canApprove?: boolean;
  /**
   * Which of the two deliveries approving this would perform.
   *
   * Resolved by the rule the dispatcher itself uses, over the same two
   * inputs, so the sentence the reviewer reads at the moment they take
   * responsibility for the document cannot describe a delivery that is not
   * going to happen.
   */
  deliveryMode?: DeliveryMode;
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
  const canReadDocument = canReadSubmissionDocument({ role, isSubmitter, status: row.status });
  // Absent until 20260807_flow_join.sql is applied, so this is undefined
  // rather than null on an unmigrated database and the page renders exactly
  // as it does today.
  const signingRequestId = (row as DispatchRow).signing_request_id ?? null;
  // Read for the mode alone, and only for the fallback the row cannot answer.
  // An archived template reads as null here and the mode is then 'share',
  // which is both today's behaviour and what the dispatcher would do.
  const template = row.delivery_mode
    ? null
    : row.template_id
      ? await loadPublishedTemplate(admin, row.firm_id, row.template_id)
      : null;
  return {
    ok: true,
    viewer: role ? 'legal' : 'submitter',
    canApprove: canApproveSubmissions(role),
    deliveryMode: resolveDispatchMode({
      submissionMode: row.delivery_mode,
      templateMode: template?.deliveryMode,
    }),
    signing: await loadSubmissionSigning(
      admin,
      signingRequestId,
      canReadDocument,
      // The caller's own address, so the employee can be linked to their own
      // counter-signature and nobody is ever handed somebody else's.
      user.email ?? null,
    ),
    submission: rowToSubmission(row, (id) => people.get(id)?.name ?? null, canReadDocument),
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
 * The decision is also conditional on the revision the reviewer's page rendered.
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
  seenRevisionNumber?: number,
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
  // ORDER IS LOAD-BEARING: the role check runs BEFORE the staleness check
  // below, and must keep running first. A caller who may not decide on this
  // document learns that and nothing else. Reversed, the staleness message
  // would tell a member who is not allowed to read the wording whether a string
  // they guessed matches the stored one, which turns the narrowed read
  // (canReadSubmissionDocument) into an oracle they can query a guess at a
  // time. Do not reorder these two blocks.
  const decision = reviewDecision({ role, current: row.status, action, note });
  if (!decision.ok) return { ok: false, error: decision.error };

  const seen = seenDocument(seenDocumentText);
  const seenRev = seenRevision(seenRevisionNumber);
  if (seen !== row.document_text || seenRev !== row.revision) {
    return {
      ok: false,
      error:
        'The wording changed while this was open. Reload it, read the current version, and decide again.',
    };
  }

  const { data: updated, error: updateError } = await admin
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
    // the row at the instant of the write, and it is what actually holds. It
    // swaps on the revision rather than the wording: the revision moves on
    // exactly the writes that move the wording, and unlike the wording it fits
    // in a request URL. See seenDocument above.
    .eq('revision', seenRev)
    .select(SUBMISSION_COLS)
    .maybeSingle();
  // A transport or database failure is not a colleague. Folding one into the
  // other is how an approver gets told somebody beat them to it when nobody
  // did, on a document that is in fact still sitting there waiting.
  if (updateError) {
    return { ok: false, error: 'That decision could not be recorded just now. Try again shortly.' };
  }
  if (!updated) return { ok: false, error: 'Someone else has already acted on this submission.' };

  const fresh = updated as SubmissionRow;
  const people = await hydratePeople(admin, [user.id]);
  const actorName = people.get(user.id)?.name ?? 'The legal team';

  if (decision.status === 'changes_requested') {
    await createNotification({
      userId: fresh.submitted_by,
      type: 'system',
      title: `${fresh.template_name} needs a change before it goes out`,
      body: `${refOf(fresh)} \u00b7 ${trimTo(note, 300) || 'Open it to see what to adjust.'}`,
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
      body: `${refOf(fresh)} \u00b7 ${trimTo(note, 300) || 'Open it to see what the legal team said.'}`,
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
    body: `${refOf(fresh)} \u00b7 ${
      released.ok
        ? `It has been sent to ${fresh.recipient_email}.`
        : 'Legal has approved it. The delivery did not go through yet and can be retried.'
    }`,
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
 * Send several waiting submissions back to the colleagues who filed them, with
 * one note.
 *
 * THERE IS DELIBERATELY NO BULK APPROVE, AND THIS COMMENT IS WHERE THAT
 * DECISION LIVES. Approving in this product is not marking a row done: it
 * releases the finished document to a named party outside the company, from
 * the firm. A bulk approve is therefore a bulk send to third parties. Three
 * things say it must not exist:
 *
 *   1. decideTemplateSubmissionAction is conditional on the wording AND the
 *      revision the reviewer's own page rendered, precisely so that nobody is
 *      recorded as having released text they never read. A list row shows a
 *      form name, a colleague and an address; it does not show the agreement.
 *      Any bulk approve would have to supply that wording from somewhere other
 *      than the reviewer's eyes, which converts a deliberate read-then-release
 *      into a click-then-release and empties the guard of its meaning.
 *   2. The queue does not even hold the wording. listFirmTemplateSubmissions
 *      hands rows through canReadSubmissionDocument, and the queue narrows
 *      them again to ApprovalRow, which has no document field. Building bulk
 *      approve would mean opening a new server path that reads document_text
 *      past that gate to feed it.
 *   3. Sending back releases nothing. It returns the document to the person
 *      who wrote it and keeps it alive, so getting it wrong costs a colleague
 *      a second pass rather than putting confidential material outside the
 *      firm. That asymmetry is the whole reason one of these is a bulk action
 *      and the other is not.
 *
 * Everything else here follows decideTemplateSubmissionAction row by row. The
 * caller's role is resolved from their own session against each row's OWN firm
 * (never a firm id passed in), reviewDecision checks role and transition
 * together, and the write is a compare-and-swap on the status and the revision
 * this call just read, so a row a colleague acted on in the meantime is
 * reported as lost rather than overwritten. Each row's outcome is returned
 * separately: a bulk action that reported one success over a partial failure
 * would be telling a reviewer that work landed which did not.
 */
export async function sendBackTemplateSubmissionsAction(
  submissionIds: string[],
  note: string,
): Promise<{ ok: boolean; error?: string; results?: BulkSendBackResult[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const ids = [...new Set((submissionIds ?? []).map((id) => String(id ?? '')).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: 'Nothing was selected.' };
  if (ids.length > MAX_BULK_SEND_BACK) {
    return { ok: false, error: 'Too many at once. Narrow the queue and try again.' };
  }
  // The note is what the colleague is told, and reviewDecision requires one on
  // every row. Refused once here so a missing note is one sentence rather than
  // fifty copies of the same one.
  if (!String(note ?? '').trim()) {
    return { ok: false, error: 'Add a short note so your colleagues know what to change.' };
  }

  const allowed = await checkRateLimit(`template-send-back:${user.id}`, {
    limit: 20,
    windowSeconds: 3600,
  });
  if (!allowed) {
    return { ok: false, error: 'You have sent a lot of documents back. Try again later.' };
  }

  const { data } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .in('id', ids);
  const byId = new Map<string, SubmissionRow>();
  for (const r of (data ?? []) as SubmissionRow[]) byId.set(r.id, r);

  // One role lookup per firm rather than per row. The lookup reads the CALLER's
  // own membership through the user-scoped client, so this is a cache of the
  // caller's own roles and not a way to widen them.
  const roles = new Map<string, FirmRole | null>();
  const roleIn = async (firmId: string): Promise<FirmRole | null> => {
    if (!roles.has(firmId)) roles.set(firmId, await callerFirmRole(firmId));
    return roles.get(firmId) ?? null;
  };

  const results: BulkSendBackResult[] = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      results.push({ id, ref: id.split('-')[0] ?? id, ok: false, error: 'That submission could not be found.' });
      continue;
    }
    const ref = refOf(row);
    const decision = reviewDecision({
      role: await roleIn(row.firm_id),
      current: row.status,
      action: 'request_changes',
      note,
    });
    if (!decision.ok) {
      results.push({ id, ref, ok: false, error: decision.error });
      continue;
    }

    const { data: updated, error: updateError } = await admin
      .from('firm_template_submissions')
      .update({
        status: decision.status,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_note: trimTo(note, 2000) || null,
        release_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .eq('revision', row.revision)
      .select(SUBMISSION_COLS)
      .maybeSingle();
    // PostgREST reports a filter that matched nothing as success with no rows,
    // so an empty result is a failure this caller has to be told about.
    if (updateError) {
      results.push({ id, ref, ok: false, error: 'That could not be recorded just now. Try again shortly.' });
      continue;
    }
    if (!updated) {
      results.push({ id, ref, ok: false, error: 'Someone else has already acted on this submission.' });
      continue;
    }

    const fresh = updated as SubmissionRow;
    await createNotification({
      userId: fresh.submitted_by,
      type: 'system',
      title: `${fresh.template_name} needs a change before it goes out`,
      body: `${ref} · ${trimTo(note, 300)}`,
      link: `/portal/forms/submissions/${fresh.id}`,
      actorUserId: user.id,
    });
    results.push({ id, ref, ok: true });
  }

  refresh();
  return { ok: true, results };
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
 * The write is conditional on the status AND on the revision the reviewer's
 * page rendered, which is what seenRevisionNumber carries. Two reviewers
 * editing the same document at once therefore cannot silently overwrite one
 * another: the second one is told to reload rather than having their
 * colleague's wording disappear under them, and the record never shows a jump
 * from the first version to the third with the second missing.
 */
export async function editTemplateSubmissionAction(
  submissionId: string,
  documentText: string,
  note?: string,
  seenDocumentText?: string,
  seenRevisionNumber?: number,
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
  const seenRev = seenRevision(seenRevisionNumber);
  const role = await callerFirmRole(row.firm_id);
  // ORDER IS LOAD-BEARING: reviewEdit runs the role check first, and this call
  // runs BEFORE the staleness check below. Both must stay in this order. A
  // caller who may not edit this document learns that and nothing else.
  // Reversed, the staleness message would confirm whether a string the caller
  // guessed matches the stored wording, which turns the narrowed read
  // (canReadSubmissionDocument) into an oracle they can query a guess at a
  // time. Do not reorder these two blocks.
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
  if (seen !== row.document_text || seenRev !== row.revision) return { ok: false, error: stale };

  const { data: updated, error } = await admin
    .from('firm_template_submissions')
    .update({
      document_text: edit.documentText,
      // The compare-and-swap below holds the revision at `seenRev` through the
      // write, and the revision only ever moves when document_text moves, so
      // the stored text at that instant is `seen`. This preserves exactly what
      // was on the row and not what an earlier read happened to see.
      ...(edit.preserveOriginal ? { original_document_text: seen } : {}),
      edited_by: user.id,
      edited_at: new Date().toISOString(),
      edit_note: trimTo(note, 2000) || null,
      // Same signal a resubmission gives: the document is not the one anyone
      // else has open, and the queue shows a new version number for it.
      revision: row.revision + 1,
      // The employee's mark and the record around it go with the old wording.
      // They affirmed a sentence about these words, and these words have just
      // changed, so what is stored is no longer a signature on this document.
      // Keeping the hash would be worse than keeping nothing: it would say the
      // current text had been signed. Whether the employee is then asked to
      // sign again is the release gate's decision, not this write's.
      ...CLEARED_SIGNATURE_COLUMNS,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .eq('status', 'pending')
    // Swaps on the revision, not the wording: same guarantee, and it fits in a
    // request URL where a merged agreement does not. See seenDocument above.
    .eq('revision', seenRev)
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
    body: `${refOf(row)} \u00b7 ${trimTo(note, 300) || 'You can read the current wording and the version you sent.'}`,
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
 * Deliver an approved submission by whichever of the two routes its template
 * asks for, and record the outcome.
 *
 * Both routes end at the same status write, and both leave a failure as an
 * approved row with release_error set, which is the state
 * retryTemplateReleaseAction already expects. It needs no change: it calls
 * this, and this now knows about both modes.
 *
 * The share route is unchanged. The release helper still owns the whole of it:
 * it re-reads the row, refuses anything that is not approved, claims the
 * release so a second caller cannot repeat it, and gives the claim back if any
 * part of the send fails.
 */
async function sendApproved(
  admin: Admin,
  submissionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error: readError } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('id', submissionId)
    .maybeSingle();
  // A failed read and a missing row both arrive as null data, and reporting a
  // database that did not answer as a submission that is not there writes a
  // false statement onto the record.
  if (readError) {
    return { ok: false, error: 'This submission could not be read just now. Try again shortly.' };
  }
  const row = (data as DispatchRow | null) ?? null;
  if (!row) return { ok: false, error: 'That submission could not be found.' };

  // The mode is the submission's own, falling back to the template's.
  //
  // The row records what its document_text was merged under, and that is what
  // has to be delivered: see resolveDispatchMode. The template is read for the
  // rows that carry no mode of their own, and a template that has since been
  // archived or unpublished cannot be read, so the mode then falls back to
  // 'share', which is today's behaviour and the behaviour of every template
  // before this column existed. The alternative, refusing, would strand
  // approved submissions whose template was tidied away while they sat in the
  // queue, which is a worse failure than delivering the way the product
  // delivered last week.
  const template = row.template_id
    ? await loadPublishedTemplate(admin, row.firm_id, row.template_id)
    : null;

  const gate = checkDispatchable({
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    recipientEmail: row.recipient_email,
    documentText: row.document_text,
    releasedAt: row.released_at,
    deliveryMode: resolveDispatchMode({
      submissionMode: row.delivery_mode,
      templateMode: template?.deliveryMode,
    }),
    documentId: row.document_id ?? null,
    signingRequestId: row.signing_request_id ?? null,
  });
  if (!gate.ok) return recordDeliveryFailure(admin, submissionId, gate.reason);

  if (gate.mode === 'share') {
    const released = await releaseApprovedSubmission(admin, submissionId);
    if (!released.ok) return recordDeliveryFailure(admin, submissionId, released.error);
  } else {
    const dispatched = await dispatchForSignature(admin, row);
    if (!dispatched.ok) {
      // The instrument may already be out even though the delivery is not
      // complete, and when it is, the row has to say 'sent' or the completion
      // path in a later slice never fires for it.
      if (dispatched.markSent) await markSubmissionSent(admin, submissionId);
      return recordDeliveryFailure(admin, submissionId, dispatched.error);
    }
  }

  const sent = await markSubmissionSent(admin, submissionId);
  if (!sent.ok) return sent;
  await admin
    .from('firm_template_submissions')
    .update({ release_error: null, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  return { ok: true };
}

/** The status write both modes end at. */
async function markSubmissionSent(
  admin: Admin,
  submissionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const move = applySubmissionAction('approved', 'mark_sent');
  if (!move.ok) return { ok: false, error: move.error };
  await admin
    .from('firm_template_submissions')
    .update({ status: move.status, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('status', 'approved');
  return { ok: true };
}

/** Put the reason on the record, then hand it back to the caller unchanged. */
async function recordDeliveryFailure(
  admin: Admin,
  submissionId: string,
  error: string,
): Promise<{ ok: false; error: string }> {
  await admin
    .from('firm_template_submissions')
    .update({ release_error: error, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  return { ok: false, error };
}

/**
 * Send an approved submission for signature instead of as a read-only share.
 *
 * The claim is the same compare-and-swap the share path uses
 * (lib/template-release.ts), on the same column, for the same reason: the read
 * above and the send below are two separate moments, and between them a second
 * approver, or the same one in a second tab, can pass the very same gate. Both
 * would then dispatch, which for a signature means two executed PDFs and two
 * audit chains for one instrument. The database decides who got there first,
 * and the caller who did not win sends nothing.
 *
 * ONE REAL HAZARD, NAMED. createSigningRequestAction is a `'use server'` export
 * and calls requireUser(). Reached from here the caller is the approving
 * reviewer, which is correct and is exactly whose authority should send it. Do
 * NOT refactor it to take a user id: that would turn an authenticated action
 * into an impersonation primitive.
 */
async function dispatchForSignature(
  admin: Admin,
  row: DispatchRow,
): Promise<{ ok: true } | { ok: false; error: string; markSent?: boolean }> {
  const nowIso = () => new Date().toISOString();

  const { data: claimed, error: claimError } = await admin
    .from('firm_template_submissions')
    .update({ released_at: nowIso(), updated_at: nowIso() })
    .eq('id', row.id)
    .eq('status', 'approved')
    .is('released_at', null)
    .select('id')
    .maybeSingle();
  // A claim that failed to write and a claim that lost the race both come back
  // without a row. Only the second one means the document is on its way.
  if (claimError) {
    return { ok: false, error: 'This document could not be sent just now. Try again shortly.' };
  }
  if (!claimed) return { ok: false, error: 'This document has already been sent.' };

  /**
   * Give the claim back so an approver can try again. Everything after the
   * claim and before the signature request exists can fail on infrastructure
   * the firm does not control, and a half-finished dispatch must never look
   * finished: the record goes back to approved and unclaimed, which is the
   * state the retry path expects. Nothing is unclaimed once the request
   * exists, because at that point the counterparty may already hold the link.
   */
  const unclaim = async (error: string): Promise<{ ok: false; error: string }> => {
    const { error: writeError } = await admin
      .from('firm_template_submissions')
      .update({ released_at: null, release_error: error, updated_at: nowIso() })
      .eq('id', row.id);
    if (writeError) {
      return {
        ok: false,
        error:
          'The send failed and the document could not be returned to a sendable state. This record needs attention before it can go out.',
      };
    }
    return { ok: false, error };
  };

  try {
    // Rendered once and filed as a real document. Idempotent, so a retry after
    // a failure below reuses the same bytes and therefore the same hash.
    const filed = await materializeSubmissionDocument(admin, row.id);
    if (!filed.ok) return await unclaim(filed.error);

    // Two signers on ONE request: the counterparty at order 1, the
    // employee counter-signing at order 2. counterSignatureParty is the whole
    // rule, including when there is only one of them. The employee is
    // classified internal by the lookup inside createSigningRequestAction and
    // correctly gets no access code; what stands in for it is the session
    // check in lib/signature-write.ts, which refuses a signature made in their
    // name by anyone holding the link.
    // The template's signature methods, read HERE and frozen onto the request
    // below, because this is the moment the document is dispatched.
    //
    // Read live rather than copied onto the submission when it was filed, and
    // that is a deliberate difference from category and delivery_mode beside
    // it. Those two describe the document_text, which was merged at submit
    // time and cannot be reconsidered. This describes the ceremony, which has
    // not started yet: a firm that tightens what it will accept while a
    // submission sits in the approval queue means the tightening to apply to
    // what goes out of it. Once the link is sent, the frozen copy on the
    // request is what governs and no later edit reaches it.
    //
    // A template that has since been archived or deleted reads as null, which
    // is no restriction: the same answer as before this column existed, and
    // the alternative would be refusing to send an approved document because
    // its template was tidied away.
    const signatureMethods = row.template_id
      ? (await loadPublishedTemplate(admin, row.firm_id, row.template_id))
          ?.signatureMethods ?? null
      : null;

    const created = await createSigningRequestAction(
      row.firm_id,
      filed.documentId,
      counterSignatureParty(row),
      row.recipient_note,
      {
        // The counterparty keeps a copy of what they signed. 15 USC 7001(d) is
        // about the signer being able to retain the record, and this is a
        // document they are a party to rather than one the firm is
        // withholding.
        signerCanDownload: true,
        signatureMethods,
      },
    );
    if (!created.ok || !created.requestId) {
      return await unclaim(
        created.error ?? 'The signature request could not be created. Nothing has gone out.',
      );
    }

    const { error: pointerError } = await admin
      .from('firm_template_submissions')
      .update({ signing_request_id: created.requestId, updated_at: nowIso() })
      .eq('id', row.id);
    if (pointerError) {
      // The request exists and the recipient may already hold the link, so
      // this does not unclaim and does not retry: doing either would send a
      // second copy of the same agreement. The pointer is what a later slice
      // reads to close the loop, so say plainly that it is missing.
      return {
        ok: false,
        markSent: true,
        error:
          'This document was sent for signature, but the link between it and this record was not saved. It can be followed under Signing.',
      };
    }

    if ((created.emailFailures ?? []).length > 0) {
      // The request and its tokens are valid and a resend is cheap, so the
      // record keeps it. But nobody was told, and reporting this as delivered
      // would be the one thing the approver must not be told.
      return {
        ok: false,
        markSent: true,
        error:
          'This document was sent for signature but the email did not reach the recipient. Open it under Signing and send the link again.',
      };
    }

    return { ok: true };
  } catch {
    return await unclaim(
      'Something went wrong while preparing this document to send. It has not gone out, and it can be sent again.',
    );
  }
}
