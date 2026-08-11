'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { isUnknownColumnError } from './signer-view';
import { FIRM_MANAGE_ROLES, callerHasFirmRole } from './firm-authz';

/**
 * Open or close the case file on one matter.
 *
 * The write behind the two triggers in lib/case-mode.ts. Reads and the guard
 * live in lib/case-file.ts.
 *
 * Gated to FIRM_MANAGE_ROLES - owner, admin, attorney. Deciding that a matter
 * is a court case is a lawyer's call, and it changes which surfaces the whole
 * team can reach on it. A paralegal or staff member sees the state and no
 * control, which is the same line lib/firm-authz.ts already draws for managing
 * a matter's people.
 *
 * Reversible by exactly the same three roles, from the same panel, in one
 * click. That is load-bearing: lib/case-file.ts refuses reads as well as
 * writes, and it is only safe to do that because the way back is this short.
 */

/** What this write does and does not touch, said once, for the tests to hold. */
const NOTHING_IS_DELETED =
  'Closing the case file hides the timeline, evidence and analysis. It deletes none of them.';

export async function setCaseFileOpenAction(
  firmId: string,
  caseId: string,
  open: boolean,
): Promise<{ ok: boolean; error?: string; note?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };

  // Role first, matter second, for the reason the five action gates all give:
  // answering the matter lookup first would tell a caller whose role cannot
  // reach matters whether the id they passed is a real matter in this firm.
  if (!(await callerHasFirmRole(firmId, FIRM_MANAGE_ROLES))) {
    return {
      ok: false,
      error: 'Only an owner, admin or attorney can open or close a case file.',
    };
  }
  const supabase = createServerSupabase();
  const { data: kase } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'That matter is not in this firm.' };

  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  // The write is one column on one row. Nothing else is touched, which is the
  // whole promise: a matter switched back keeps its evidence, its timeline and
  // its approaches, and gets them all back when it is switched forward again.
  const { error } = await admin
    .from('cases')
    .update({ litigation_mode: open, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .eq('firm_id', firmId);

  if (error) {
    // The expected failure until the owner applies 20260816. Say so plainly
    // rather than surfacing a PostgREST sentence about a missing column: the
    // person reading this is a lawyer looking at a matter, and the thing they
    // need to know is who can fix it.
    if (isUnknownColumnError(error, 'litigation_mode')) {
      return {
        ok: false,
        error:
          'Opening and closing case files is not available yet. It needs a pending database update.',
      };
    }
    return { ok: false, error: error.message };
  }

  // The mode decides which surfaces answer, so the matter's own sub-routes go
  // too, not just the page the control is on.
  revalidatePath(`/counsel/cases/${caseId}`);
  revalidatePath(`/counsel/cases/${caseId}/timeline`);
  revalidatePath(`/counsel/cases/${caseId}/evidence`);
  return { ok: true, note: open ? undefined : NOTHING_IS_DELETED };
}
