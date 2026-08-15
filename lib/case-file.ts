import 'server-only';
import { createAdminSupabase } from './supabase/admin';
import { isUnknownColumnError } from './signer-view';
import {
  caseModeDecision,
  type CaseMode,
  type CaseModeDecision,
} from './case-mode';

/**
 * Is the case file open on this matter, and what does that refuse?
 *
 * The counterpart to lib/firm-surface-guard.ts, one level down: that module
 * answers "does this FIRM have this surface", this one answers "is this MATTER
 * a court case". Same reason for existing - every `'use server'` export is a
 * public HTTP endpoint, and a hidden route is not a gate - and the same shape,
 * so a caller whose contract is `{ ok, error }` can hand the reason to a person.
 *
 * WHERE IT DIFFERS: this guard refuses READS too, and firm-surface-guard
 * deliberately does not.
 *
 * That module's reasoning is sound and still holds there: hiding Time and
 * Billing is a firm-wide setting several pages away from the invoice a person
 * can suddenly no longer open, so refusing its reads would be deletion with
 * extra steps. Here the distance back is one click, on the page the person is
 * already looking at, scoped to the single matter in front of them, available
 * to any owner, admin or attorney. A closed case file is a shut drawer, not a
 * shredder: no evidence row, timeline event, approach, narrative or storage
 * object is touched by closing it, and opening it again brings back every one
 * of them exactly as they were.
 */

/** The columns the resolver needs, and nothing else. */
const MODE_SELECT = 'litigation_mode, hearing_at, hearing_location';
const MODE_SELECT_LEGACY = 'hearing_at, hearing_location';

/**
 * The name of the column that may not be there yet.
 *
 * The migration adding it is written but not applied, and applying it is the
 * owner's step, so the fallback below is the LIVE path today rather than a
 * defensive flourish. It has to be read off `result.error`, using the existing
 * lib/signer-view.ts helper: Supabase resolves with `{ error }` and never
 * throws, so a try/catch here would catch nothing and the select would return
 * no row - which reads as "matter not found" and would close the case file on
 * every matter in the product.
 */
const PENDING_COLUMN = 'litigation_mode';

export type CaseFileState = CaseModeDecision & {
  /**
   * False when the column is not in the database yet. The control uses it to
   * explain itself instead of offering a switch that cannot write.
   */
  storable: boolean;
};

const CLOSED: CaseFileState = { mode: 'simple', source: 'default', storable: false };

/**
 * Resolve one matter's mode.
 *
 * Reads through the ADMIN client. Every caller has already authorized the
 * person against this matter before asking - the five action gates ask only
 * after their own access check passes, and the pages ask after firm context
 * resolves - so this read is scoped by the caller, not by RLS, exactly as
 * lib/case-analytics.ts is.
 *
 * Fails CLOSED. A matter that cannot be read resolves simple, which withholds
 * the litigation surfaces rather than handing them over on a failed read.
 */
export async function getCaseFileState(caseId: string): Promise<CaseFileState> {
  const admin = createAdminSupabase();
  if (!admin) return CLOSED;

  const first = await admin
    .from('cases')
    .select(MODE_SELECT)
    .eq('id', caseId)
    .maybeSingle();

  if (isUnknownColumnError(first.error, PENDING_COLUMN)) {
    const legacy = await admin
      .from('cases')
      .select(MODE_SELECT_LEGACY)
      .eq('id', caseId)
      .maybeSingle();
    const row = legacy.data as {
      hearing_at: string | null;
      hearing_location: string | null;
    } | null;
    if (legacy.error || !row) return CLOSED;
    return {
      ...caseModeDecision({
        litigationMode: undefined,
        hearingAt: row.hearing_at,
        hearingLocation: row.hearing_location,
      }),
      storable: false,
    };
  }

  const row = first.data as {
    litigation_mode: boolean | null;
    hearing_at: string | null;
    hearing_location: string | null;
  } | null;
  if (first.error || !row) return CLOSED;
  return {
    ...caseModeDecision({
      litigationMode: row.litigation_mode,
      hearingAt: row.hearing_at,
      hearingLocation: row.hearing_location,
    }),
    storable: true,
  };
}

export async function caseFileMode(caseId: string): Promise<CaseMode> {
  return (await getCaseFileState(caseId)).mode;
}

export type CaseFileRefusal = { ok: false; error: string };

export const CASE_FILE_CLOSED_ERROR =
  'The case file is not open on this matter. An owner, admin or attorney can open it from the matter page.';

/**
 * Null when the case file is open, a refusal when it is not.
 *
 * Returns rather than throws, so the five action modules that call it can hand
 * the sentence to the person the way they hand over every other refusal.
 *
 * ORDER MATTERS AT THE CALL SITE. Each of those modules calls this only AFTER
 * its own access check has passed. Four of the five already comment at length
 * on answering the role before the matter lookup so that a refusal cannot tell
 * a caller whether a guessed matter id is real; asking this first would give
 * that back, because it reads a row by id and would answer differently for a
 * real matter than for one that does not exist.
 */
export async function caseFileRefusal(
  caseId: string,
): Promise<CaseFileRefusal | null> {
  const state = await getCaseFileState(caseId);
  return state.mode === 'litigation'
    ? null
    : { ok: false, error: CASE_FILE_CLOSED_ERROR };
}

/** The same gate for a page or route that would rather not carry a null. */
export async function caseFileIsOpen(caseId: string): Promise<boolean> {
  return (await caseFileRefusal(caseId)) === null;
}
