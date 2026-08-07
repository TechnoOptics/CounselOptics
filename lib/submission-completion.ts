import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { FIRM_MANAGE_ROLES } from './firm-authz';
import { createNotification } from './notifications';
import { sendEmail, buildSubmissionSignedEmailHtml } from './email';
import { siteUrl } from './intake-notify';
import { displayTicket } from './ticket-numbers';
import { normalizeCategory } from './document-category';
import { selectSigningArtifact } from './signing-artifact';
import type { SubmissionSigning } from './template-submission-types';

/**
 * The end of the chain: a signing request has completed, and the two people
 * who have been waiting on it are told.
 *
 * Not a server action. Nothing here is an HTTP endpoint, for the same reason
 * lib/template-release.ts and lib/submission-document.ts are not: the only
 * caller is lib/signature-write.ts, which has already established that the
 * last signature landed.
 *
 * WHY THE LOOKUP RUNS BACKWARDS
 * -----------------------------
 * The pointer lives on the submission, because the submission is the process
 * record and firm_signing_requests stays a generic row that knows nothing
 * about templates. The price of that direction is this scan, which
 * 20260807_flow_join.sql pays for with a partial index on
 * signing_request_id.
 *
 * WHAT AN UNAPPLIED MIGRATION DOES
 * --------------------------------
 * Nothing. PostgREST refuses the whole statement when a filter names a column
 * the table does not have, so a firm without the migration gets an error
 * here, no notice, and exactly the behaviour the product had last week. That
 * is the point: this runs on the signing path, and a firm that has not
 * migrated must not have a signature refused because of it.
 *
 * WHY THE OUTCOME DESCRIBES THE RECORD AND NOT THE DELIVERY
 * ---------------------------------------------------------
 * `backed: true` means a submission produced this request, and therefore that
 * the employee's destination is their portal record. It does NOT mean anybody
 * was successfully told. Those are different facts and conflating them is how
 * this repo shipped an audit event asserting a delivery that never happened.
 * The caller uses this to decide where a link points, and that answer does not
 * change because a notification insert failed.
 *
 * WHY THE TWO NOTICES ARE SETTLED AND NOT AWAITED IN SEQUENCE
 * -----------------------------------------------------------
 * The employee and the legal team are independent recipients of independent
 * facts. A failure telling one must not silence the other, so each side runs
 * to completion on its own and the failures are collected rather than thrown.
 * Nothing here writes to the record, so no failure below can leave the
 * record saying something untrue either.
 */

type Admin = SupabaseClient;

export type SubmissionCompletionOutcome =
  | { backed: false }
  | { backed: true; submissionId: string; submittedBy: string };

/**
 * Where an employee goes to see their own finished document.
 *
 * Deliberately NOT /inbox/documents. That is the consumer documents inbox and
 * it is gated on a Pro subscription (app/inbox/documents/page.tsx), so an
 * employee sent there is told their document is ready and shown an upsell for
 * a plan their employer's workspace has nothing to do with. This route is the
 * portal record they filed, which every filing employee is entitled to open.
 */
export function submissionPortalPath(submissionId: string): string {
  return `/portal/forms/submissions/${submissionId}`;
}

/** The columns this module reads. Named, so a new one is a deliberate act. */
const SUBMISSION_COLS =
  'id, firm_id, submitted_by, submitter_name, submitter_email, template_name, ' +
  'recipient_name, recipient_email, ticket_number, category, signing_request_id';

type CompletionRow = {
  id: string;
  firm_id: string;
  submitted_by: string;
  submitter_name: string | null;
  submitter_email: string | null;
  template_name: string;
  recipient_name: string | null;
  recipient_email: string;
  ticket_number: string | null;
  category: string | null;
};

export async function notifySubmissionCompletion(
  admin: Admin,
  signingRequestId: string,
): Promise<SubmissionCompletionOutcome> {
  // The request is asked first, and it is asked whether it is actually
  // completed. Telling two parties a document is fully signed on the strength
  // of a caller's say-so would be a false statement to both of them.
  const { data: reqData, error: reqError } = await admin
    .from('firm_signing_requests')
    .select('id, status, completed_at')
    .eq('id', signingRequestId)
    .maybeSingle();
  if (reqError) return { backed: false };
  const request = (reqData as { status?: string; completed_at?: string | null } | null) ?? null;
  if (!request || request.status !== 'completed') return { backed: false };

  const { data, error } = await admin
    .from('firm_template_submissions')
    .select(SUBMISSION_COLS)
    .eq('signing_request_id', signingRequestId)
    .limit(1);
  // An error here is the unapplied migration, not a missing submission. Both
  // mean the same thing to this function (there is nothing to say), and
  // neither is allowed to reach the caller as a throw.
  if (error) return { backed: false };
  const row = ((data ?? []) as unknown as CompletionRow[])[0] ?? null;
  // A plainly uploaded document that was sent for signature has no submission
  // behind it, and today's behaviour is the correct behaviour for it.
  if (!row) return { backed: false };

  const completedAt = request.completed_at ?? new Date().toISOString();

  // Independent, and settled rather than awaited in sequence, so neither
  // recipient's failure can silence the other's notice.
  await Promise.allSettled([
    tellTheEmployee(row, completedAt),
    tellTheLegalTeam(admin, row, signingRequestId),
  ]);

  return { backed: true, submissionId: row.id, submittedBy: row.submitted_by };
}

/** How long a minted link to an executed copy stays good for. */
const EXECUTED_URL_TTL_SECONDS = 60 * 30;

/**
 * The signature side of one submission, for the surfaces that show it.
 *
 * The stored path is never returned. What comes back is a short-lived signed
 * URL minted here on the server, so a page can offer the file without ever
 * holding a storage path a reader could keep.
 *
 * `canReadDocument` is the SAME predicate that decides whether the wording of
 * this submission is shown (canReadSubmissionDocument). The executed copy is
 * the document, in the form that is easiest to keep and forward, so it cannot
 * be more available than the words it contains. A reader who is refused the
 * text still learns where the signature has got to, which is a status and not
 * a document.
 *
 * When the executed copy is honoured is not decided here either. It is
 * selectSigningArtifact's rule, reused rather than restated: a
 * signed_file_path on a request that is not completed belongs to some earlier
 * state of it, and offering it would assert an execution the request's own
 * status denies. Passing no original is what makes this return the executed
 * copy or nothing, which is what the employee's page wants: they already have
 * the wording on the page above it.
 *
 * Returns null for anything it cannot answer, including a database with
 * 20260807_flow_join.sql unapplied, in which case there is no
 * signing_request_id to pass in at all and the page renders as it does today.
 */
export async function loadSubmissionSigning(
  admin: Admin,
  signingRequestId: string | null | undefined,
  canReadDocument: boolean,
): Promise<SubmissionSigning | null> {
  if (!signingRequestId) return null;

  const { data, error } = await admin
    .from('firm_signing_requests')
    .select('id, status, signed_file_path')
    .eq('id', signingRequestId)
    .maybeSingle();
  if (error || !data) return null;
  const request = data as { status: string | null; signed_file_path?: string | null };

  const { data: sigData } = await admin
    .from('firm_signatures')
    .select('signer_name, signer_email, signed_at')
    .eq('signing_request_id', signingRequestId);
  const signers = ((sigData ?? []) as unknown as {
    signer_name: string | null;
    signer_email: string;
    signed_at: string | null;
  }[]).map((s) => ({
    name: s.signer_name,
    email: s.signer_email,
    signedAt: s.signed_at,
  }));

  const artifact = canReadDocument
    ? selectSigningArtifact({
        status: request.status,
        signedFilePath: request.signed_file_path ?? null,
        originalFilePath: null,
      })
    : null;
  let executedUrl: string | null = null;
  if (artifact?.kind === 'executed') {
    try {
      const { data: signed } = await admin.storage
        .from('firm-documents')
        .createSignedUrl(artifact.path, EXECUTED_URL_TTL_SECONDS);
      executedUrl = signed?.signedUrl ?? null;
    } catch {
      // A link that cannot be minted is a missing link, not a missing
      // signature. The panel still says the document is fully signed.
    }
  }

  return {
    status: (request.status ?? 'sent') as SubmissionSigning['status'],
    signers,
    executedUrl,
  };
}

/** The reference the record carries, or the derived one if it has none. */
function refOf(row: CompletionRow): string {
  return displayTicket({ ticketNumber: row.ticket_number, id: row.id });
}

/** Who the other side is, in the words the employee typed for them. */
function counterpartyOf(row: CompletionRow): string {
  return row.recipient_name?.trim() || row.recipient_email;
}

/**
 * The employee, twice over.
 *
 * A bell and an email, because somebody who filed one document three weeks
 * ago is not watching a bell, and because an email that does not send must
 * not cost them the notification that does. The two are settled separately
 * for that reason.
 */
async function tellTheEmployee(row: CompletionRow, completedAt: string): Promise<void> {
  const counterparty = counterpartyOf(row);
  const link = submissionPortalPath(row.id);

  const bell = createNotification({
    userId: row.submitted_by,
    type: 'signing_request_completed',
    title: `${row.template_name} is fully signed`,
    body: `${refOf(row)} · ${counterparty} has signed it. The signed copy is on this record and on your Documents page.`,
    link,
  });

  const mail = row.submitter_email
    ? sendEmail({
        to: row.submitter_email,
        subject: `${refOf(row)}: ${row.template_name} is fully signed`,
        html: buildSubmissionSignedEmailHtml({
          templateName: row.template_name,
          reference: refOf(row),
          counterparty,
          signedOn: formatSignedOn(completedAt),
          link: `${siteUrl()}${link}`,
        }),
      })
    : // No address on the record is a reason not to send, not a failure.
      Promise.resolve(null);

  await Promise.allSettled([bell, mail]);
}

/**
 * The legal team as a group, not only whoever pressed approve.
 *
 * The same membership read and the same role set notifyApprovers uses on the
 * way in (lib/template-submissions.ts), so the people told a document is
 * waiting are the people told it is done.
 */
async function tellTheLegalTeam(
  admin: Admin,
  row: CompletionRow,
  signingRequestId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('firm_members')
    .select('user_id, role')
    .eq('firm_id', row.firm_id);
  if (error) return;
  const recipients = ((data ?? []) as { user_id: string; role: string }[]).filter((m) =>
    (FIRM_MANAGE_ROLES as readonly string[]).includes(m.role),
  );
  if (recipients.length === 0) return;

  // Read from the record, never derived a second time from the template. The
  // template can be recategorised or archived after this was filed, and the
  // record has to keep saying what it was filed under.
  const category = normalizeCategory(row.category);
  const filedBy = row.submitter_name?.trim() || row.submitter_email || 'a colleague';

  await Promise.allSettled(
    recipients.map((m) =>
      createNotification({
        userId: m.user_id,
        type: 'signing_request_completed',
        title: `Fully signed: ${row.template_name}`,
        body: `${refOf(row)} · ${counterpartyOf(row)} has signed the ${row.template_name} filed by ${filedBy}. Filed under ${category}.`,
        link: `/counsel/signing/${signingRequestId}`,
      }),
    ),
  );
}

/** A date a person can read, with a bad timestamp degrading to no date. */
function formatSignedOn(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
