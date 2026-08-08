import { setCaseAssigneeAction } from '@/lib/firm-actions';

/**
 * setCaseAssigneeAction, as a value in every case.
 *
 * The action returns `{ ok: false, error }` for the refusals it
 * anticipates, but requireUser() THROWS when the session has gone, and a
 * server action that throws rejects the transition and takes the whole
 * surrounding component down to an error boundary rather than telling the
 * control what happened. Seen in a harness: reassigning with no session
 * replaced the matter list with the error page. A refusal belongs next to
 * the control that was refused, so catch it and let the caller say so.
 *
 * This lives in its own module because there are TWO controls that reassign
 * a matter: the row-level picker in matters-table.tsx and the one on the
 * matter detail page. The detail page carried the uncaught shape for a while
 * after the list was fixed, which is exactly how a pair of call sites drift
 * apart. One helper, both callers, no third copy.
 *
 * The empty string means "unassigned" because that is what an unset <select>
 * yields; the action wants null.
 */
export async function assignTo(
  caseId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await setCaseAssigneeAction(caseId, userId || null);
  } catch {
    return { ok: false };
  }
}
