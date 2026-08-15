/**
 * Is this matter a court case, or a request?
 *
 * The firm matter page shipped as one shape for everything: a case menu of
 * four court surfaces, a metric strip, an evidence-analytics dashboard nested
 * in a collapsible tile, and the Case Theory Console. An employee asking
 * whether they can accept a supplier's dinner invitation got the page a
 * wrongful-termination suit gets. The owner's words:
 *
 *   "Please only use this screen if there is a court case, or the firm has
 *    selected build a case. This is not how normal employee requests should
 *    appear."
 *
 * Two modes, and SIMPLE is the default. That matters most for the in-house
 * teams `firm_type = 'corporate'` shipped for, who do not litigate most of
 * what crosses their desk.
 *
 * Pure and I/O-free, so the page, the guard, the toggle and the tests share
 * one source of truth. The read that feeds it lives in lib/case-file.ts.
 */

export type CaseMode = 'simple' | 'litigation';

export const CASE_MODES: readonly CaseMode[] = ['simple', 'litigation'];

/** Which of the three answers decided it, for the panel to say out loud. */
export type CaseModeSource = 'explicit' | 'hearing' | 'default';

export type CaseModeDecision = { mode: CaseMode; source: CaseModeSource };

export type CaseModeInput = {
  /**
   * `cases.litigation_mode`. Three-valued on purpose: true is "a person opened
   * the case file", false is "a person closed it", null is "nobody has said".
   *
   * `undefined` is the fourth thing it can be and means the same as null: the
   * migration adding the column is written but not applied, so lib/case-file.ts
   * retries its read without the column and has nothing to report. Handled
   * explicitly rather than left to a falsy check, because `false` and "no
   * column" are opposite answers and a `!litigationMode` test would collapse
   * them.
   */
  litigationMode: boolean | null | undefined;
  /** `cases.hearing_at` - a court date, typed in by a person. */
  hearingAt: string | null;
  /** `cases.hearing_location` - a courtroom, typed in by a person. */
  hearingLocation: string | null;
};

/**
 * `case_type` is deliberately NOT an input here.
 *
 * It is written from `intake.matter_type` at lib/firm-actions.ts:1885 and
 * defaults to 'other'. `matter_type` is free text with no enum and no CHECK
 * constraint, so its values are whatever each firm typed into an intake form.
 * A gate built on it would open the workbench for a firm that writes
 * "Litigation" and withhold it from one that writes "litigation matter", and
 * neither firm would be able to tell why. It is not a litigation signal today.
 *
 * A hearing is. Nobody records a court date on a matter that is not in court,
 * and both hearing columns are only ever set by a person filling in the matter
 * form - which is what "prefer something a person entered deliberately" means.
 */
function hasHearing(input: CaseModeInput): boolean {
  return (
    (input.hearingAt ?? '').trim() !== '' ||
    (input.hearingLocation ?? '').trim() !== ''
  );
}

/**
 * Resolve the mode, and say which answer won.
 *
 * Order:
 *   1. An explicit answer, in EITHER direction. A matter switched back to a
 *      request stays a request even though the hearing that opened it is still
 *      on the record - otherwise the control cannot do the one thing it exists
 *      for. Same precedence lib/firm-workspace.ts gives a surface override.
 *   2. A hearing on the matter. There is a court case.
 *   3. Simple. The default, for everything else.
 */
export function caseModeDecision(input: CaseModeInput): CaseModeDecision {
  if (input.litigationMode === true) {
    return { mode: 'litigation', source: 'explicit' };
  }
  if (input.litigationMode === false) {
    return { mode: 'simple', source: 'explicit' };
  }
  if (hasHearing(input)) return { mode: 'litigation', source: 'hearing' };
  return { mode: 'simple', source: 'default' };
}

/** The same answer for a caller that does not need to explain itself. */
export function caseModeIsLitigation(input: CaseModeInput): boolean {
  return caseModeDecision(input).mode === 'litigation';
}
