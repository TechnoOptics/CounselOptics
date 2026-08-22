'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { callerFirmRole } from './firm-authz';
import { canApproveSubmissions } from './template-approval';
import {
  readAuthorizationStatus,
  readSigningDirection,
  type AuthorizationStatus,
} from './signing-authorization';

/**
 * The legal team's decision on a document somebody else sent us.
 *
 * EVERY EXPORT IN A `'use server'` MODULE IS A PUBLIC HTTP ENDPOINT. Anyone
 * with a session can call these with any id they like, so neither of them
 * trusts a caller-supplied firm id: the firm is read off the request row
 * itself and the caller's real role in THAT firm is resolved from the
 * database before anything is written. This is the shape of defect this repo
 * has been bitten by repeatedly (a module taking an id from its arguments and
 * writing past RLS with the admin client, gated only by a UI that happens to
 * pass the right one), so it is written out rather than assumed.
 *
 * WHO MAY DECIDE IS canApproveSubmissions, UNCHANGED. There is no second list
 * of roles in this file and no role literal anywhere in it. The people who may
 * release the firm's own document to an outside party are exactly the people
 * who may let the firm's name go onto an outside party's document, and two
 * lists for one question is how the two directions drift apart.
 *
 * The employee is never told what the note said. See
 * lib/signing-authorization.ts and tests/employee-payload-scope.test.ts: the
 * note is the legal team's working reasoning, and only the decision itself is
 * the employee's to read.
 */

export type AuthorizationDecision = 'approve' | 'decline';

type Result = { ok: boolean; error?: string };

/**
 * Record a decision on an inbound signing request.
 *
 * The write is conditional on the row still being 'pending', so two reviewers
 * in two tabs cannot both decide: the second one is told the decision was
 * already made rather than silently overwriting the first. That matters more
 * here than on the outbound queue, because approving is what makes a live
 * signer link open on a document that binds the firm.
 */
export async function decideInboundAuthorizationAction(
  requestId: string,
  decision: AuthorizationDecision,
  note: string | null,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };

  const { data, error: readError } = await admin
    .from('firm_signing_requests')
    .select('id, firm_id, direction, authorization_status')
    .eq('id', requestId)
    .maybeSingle();
  // A failed read and a missing row both arrive as null data, and telling a
  // reviewer the request is gone when the truth is that the database did not
  // answer writes a false statement onto the record.
  if (readError) {
    return { ok: false, error: 'That request could not be read just now. Try again shortly.' };
  }
  const row = data as {
    firm_id: string;
    direction?: unknown;
    authorization_status?: unknown;
  } | null;
  if (!row) return { ok: false, error: 'That request could not be found.' };

  const role = await callerFirmRole(row.firm_id);
  if (!canApproveSubmissions(role)) {
    return { ok: false, error: 'Your role cannot authorise a document for signature.' };
  }

  // An outbound request has no authorisation to give. Saying so plainly beats
  // writing 'approved' onto a column the signer gate does not consult in that
  // direction, which would leave a record claiming a decision nobody made.
  if (readSigningDirection(row.direction) !== 'inbound') {
    return { ok: false, error: 'This document is going out, so there is nothing to authorise.' };
  }

  const current = readAuthorizationStatus(row.authorization_status);
  if (current !== 'pending') {
    return { ok: false, error: 'A decision has already been recorded on this document.' };
  }

  const trimmed = (note ?? '').trim();
  // A reason is required to send one back, for the reason reviewDecision
  // requires one on the outbound queue: this is the last thing anyone will
  // read about a document a colleague handed over, and "no" on its own leaves
  // them with nothing to take back to the other party.
  if (decision === 'decline' && !trimmed) {
    return {
      ok: false,
      error: 'Add a short note saying what would need to change before this could be signed.',
    };
  }

  const next: AuthorizationStatus = decision === 'approve' ? 'approved' : 'declined';
  const { data: updated, error } = await admin
    .from('firm_signing_requests')
    .update({
      authorization_status: next,
      authorized_by: user.id,
      authorized_at: new Date().toISOString(),
      authorization_note: trimmed || null,
    })
    .eq('id', requestId)
    .eq('authorization_status', 'pending')
    .select('id')
    .maybeSingle();
  // PostgREST resolves rather than throws, so this checks `{ error }`: a
  // try/catch here would catch nothing, which is how a month of audit writes
  // were lost in this repo once already.
  if (error) {
    return { ok: false, error: 'That decision could not be saved just now. Try again shortly.' };
  }
  if (!updated) {
    return { ok: false, error: 'A decision has already been recorded on this document.' };
  }

  revalidatePath('/counsel/forms/approvals');
  revalidatePath(`/counsel/signing/${requestId}`);
  return { ok: true };
}
