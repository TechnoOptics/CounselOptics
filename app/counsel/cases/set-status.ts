import { setFirmCaseStatusAction } from '@/lib/firm-actions';

/**
 * setFirmCaseStatusAction, as a value in every case.
 *
 * The action returns `{ ok: false, error }` for the refusals it anticipates,
 * but requireUser() THROWS when the session has gone, and requireActiveFirm
 * throws by design when the organization's access has ended. A server action
 * that throws rejects the transition and takes the whole surrounding component
 * down to an error boundary rather than telling the control what happened.
 * That is what happened to the matter page when reassignment threw, so the
 * status control is built the same way from the start rather than after.
 *
 * This lives in its own module because there are TWO controls that move a
 * matter's status: the row-level picker in matters-table.tsx and the one on
 * the matter detail page. Assignment drifted apart across exactly that pair
 * before it was pinned. One helper, both callers, no third copy.
 */
export async function setStatus(
  caseId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    return await setFirmCaseStatusAction(caseId, status);
  } catch {
    return { ok: false };
  }
}
