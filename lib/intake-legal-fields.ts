/**
 * The legal team's own fields on a request: the ones the employee who filed
 * it is never handed.
 *
 * ONE RECORD, TWO AUDIENCES
 * -------------------------
 * The owner's rule, in his words about the drop box: show the legal team's
 * tools "on the legal side but do not show them to the employee since they
 * are legal team tools". app/portal/[id]/page.tsx reads the request through
 * the service-role client behind a hand-written gate, so RLS is not in the
 * path and whatever that page SELECTs, the employee's browser was handed.
 * tests/employee-payload-scope.test.ts pins that SELECT to a column
 * allowlist.
 *
 * That guard has one hole and it is the reason this module exists:
 * `intake_answers` is one jsonb column the employee page selects whole. A
 * legal-only value put in there ships to the employee automatically, with no
 * code change anywhere near the guard. So every field here is a REAL COLUMN
 * on firm_matter_intakes, and each one is named in LEGAL_ONLY_COLUMNS in that
 * test. tests/intake-legal-fields.test.ts checks the two lists agree.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ----------------------------
 * Status, assignee, priority, due and follow-up already exist on the ticket
 * (lib/intake-workflow.ts, setIntakeWorkflowAction). "Review follow-up date"
 * is `follow_up_on`, which the management block already carries. "Close
 * notes" is the reason the decline dialog writes to intake_answers.decision,
 * which the employee is meant to read; the administrative block shows it and
 * does not store a second copy. `case_id` is the matter a request BECAME and
 * is left alone; `related_case_id` is a matter it merely touches.
 *
 * Pure. No imports that reach a database, so vitest runs it under node and
 * the write validation is testable without a fake client.
 */

import { isUnknownColumnError } from './signer-view';
import { familyOfType, type PortalFamilyKey } from './portal-request-families';

/**
 * Every legal-only column. Each one also has to appear in LEGAL_ONLY_COLUMNS
 * in tests/employee-payload-scope.test.ts, which is what keeps the employee's
 * SELECT from ever naming it.
 *
 * `expiry_notified_at` is written by the deadlines sweep alone, never from
 * the client; it is in this list because it is a column on the row and the
 * guard has to know about it for the same reason as the others.
 */
export const LEGAL_ONLY_INTAKE_COLUMNS = [
  'related_case_id',
  'completed_on',
  'multiple_documents',
  'effective_on',
  'expires_on',
  'notify_on_expiry',
  'expiry_notified_at',
] as const;

export type LegalOnlyIntakeColumn = (typeof LEGAL_ONLY_INTAKE_COLUMNS)[number];

/**
 * The families whose tickets carry the administrative block. Grown one
 * family per phase, so a family not yet named here shows the legal team
 * nothing new rather than half of something.
 *
 * The drop box is the family the owner's rule was spoken about: the legal
 * team's status and tools are shown on the legal side and never to the
 * employee who dropped the document off. Its Status is the workflow state
 * the management block already carries, and the employee's SELECT guard
 * names `workflow_state` so the employee reads only the four-word portal
 * label derived from the lifecycle status.
 *
 * `legal` is the family "Trademark / IP filing" belongs to (familyOfType in
 * lib/portal-request-families.ts), with the hold, the demand letter and
 * Other. The reference desk's trademark form carries no status, assignment,
 * priority or administrative tools at all; here it gets the same workflow
 * every ticket has and this block, and nothing trademark-specific. A mark
 * name, its classes, a filing basis or a serial number would be fields the
 * owner has not asked for, and they are deliberately not invented here.
 */
export const ADMINISTRATIVE_TOOLS_FAMILIES: readonly PortalFamilyKey[] = [
  'internal',
  'contract',
  'dropbox',
  'legal',
];

/** Whether a request with this matter_type shows the block to the legal team. */
export function showsAdministrativeTools(
  matterType: string | null | undefined,
): boolean {
  const family = familyOfType(matterType);
  return family !== null && ADMINISTRATIVE_TOOLS_FAMILIES.includes(family.key);
}

/** What the block reads off a row. Null where the column is absent or unset. */
export type IntakeLegalFields = {
  relatedCaseId: string | null;
  /** yyyy-mm-dd. */
  completedOn: string | null;
  multipleDocuments: boolean;
  /** yyyy-mm-dd. */
  effectiveOn: string | null;
  /** yyyy-mm-dd. */
  expiresOn: string | null;
  notifyOnExpiry: boolean;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The fields off a row that may or may not carry the columns yet.
 *
 * The counsel page selects `*`, so before the migration is applied the keys
 * are simply absent and read as null here. That is a read degrading, which is
 * allowed; a write to an absent column is refused instead (see
 * resolveLegalFieldColumnFallback).
 */
export function readIntakeLegalFields(
  row: Record<string, unknown> | null | undefined,
): IntakeLegalFields {
  const r = row ?? {};
  return {
    relatedCaseId: str(r.related_case_id),
    completedOn: str(r.completed_on),
    multipleDocuments: r.multiple_documents === true,
    effectiveOn: str(r.effective_on),
    expiresOn: str(r.expires_on),
    notifyOnExpiry: r.notify_on_expiry === true,
  };
}

/** What the client sends. Every key optional: a field saves on its own. */
export type IntakeLegalFieldsInput = {
  /** A case id, or '' / null to clear. */
  relatedCaseId?: string | null;
  /** yyyy-mm-dd, or '' / null to clear. */
  completedOn?: string | null;
  multipleDocuments?: boolean;
  effectiveOn?: string | null;
  expiresOn?: string | null;
  notifyOnExpiry?: boolean;
};

export type LegalFieldWrite =
  | { ok: true; update: Partial<Record<LegalOnlyIntakeColumn, unknown>> }
  | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** '' clears; anything else has to be a real calendar date. */
function dateOrNull(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: null };
  if (!DATE.test(v) || Number.isNaN(Date.parse(v))) return { ok: false };
  return { ok: true, value: v };
}

/**
 * The column values a write carries, or the one plain sentence that stops it.
 *
 * A date input hands back '' for "cleared", which is an instruction rather
 * than a missing field. Anything else has to parse, because a column typed
 * `date` rejects free text and the failure would surface as a raw Postgres
 * message. The case id is shape-checked here and ownership-checked by the
 * action, which is the only place that can ask the database whose it is.
 *
 * Moving the expiration date re-arms the expiry notice: the sweep fires once
 * per date, and a date the team changed is a date nobody has been told about.
 */
export function normalizeLegalFieldsWrite(
  input: IntakeLegalFieldsInput,
): LegalFieldWrite {
  const update: Partial<Record<LegalOnlyIntakeColumn, unknown>> = {};

  if (input.relatedCaseId !== undefined) {
    const v = String(input.relatedCaseId ?? '').trim();
    if (v && !UUID.test(v)) {
      return { ok: false, error: 'Pick a matter from the list.' };
    }
    update.related_case_id = v || null;
  }

  for (const [key, column] of [
    ['completedOn', 'completed_on'],
    ['effectiveOn', 'effective_on'],
    ['expiresOn', 'expires_on'],
  ] as const) {
    if (input[key] === undefined) continue;
    const d = dateOrNull(input[key]);
    if (!d.ok) return { ok: false, error: 'Pick a valid date.' };
    update[column] = d.value;
    if (column === 'expires_on') update.expiry_notified_at = null;
  }

  if (input.multipleDocuments !== undefined) {
    update.multiple_documents = input.multipleDocuments === true;
  }
  if (input.notifyOnExpiry !== undefined) {
    update.notify_on_expiry = input.notifyOnExpiry === true;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, error: 'Nothing to save.' };
  }
  return { ok: true, update };
}

export type LegalFieldColumnFallback =
  /** Do not save, and say so. The value is legal-only and cannot be kept anywhere else. */
  | 'abort-column-missing'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/** The wording for the abort, kept beside the decision that causes it. */
export const LEGAL_FIELD_UNSAVED_ERROR =
  'That was not saved. This field needs a database update that has not ' +
  'been applied yet. Ask your administrator to apply the pending update.';

/**
 * What to do when a write carrying a legal-only column fails.
 *
 * Same shape as resolveDeliveryModeColumnFallback in lib/submission-dispatch.ts
 * and for the same reason: the column arrives with a migration the owner
 * applies, and between merge and apply the write comes back with the column
 * unknown. There the retry-without-column branch exists because an absent
 * column reads as the value the author chose. Here there is no such branch.
 * The only other place these values could go is intake_answers, and that is
 * the one place they must never be, so the write refuses and says why.
 */
export function resolveLegalFieldColumnFallback(input: {
  error: { code?: string | null; message?: string | null } | null | undefined;
}): LegalFieldColumnFallback {
  for (const column of LEGAL_ONLY_INTAKE_COLUMNS) {
    if (isUnknownColumnError(input.error, column)) return 'abort-column-missing';
  }
  return 'surface-error';
}

/**
 * How far ahead of the expiration date the legal team is told. Thirty days
 * is the shortest of the three the case-deadline sweep already uses, and a
 * contract that needs renewing is not helped by a notice on the day.
 */
export const EXPIRY_NOTICE_LEAD_DAYS = 30;

/**
 * Whether the expiry notice for a request is due now.
 *
 * Due from LEAD days before the date onward, and only while nothing has been
 * sent for this date: `notifiedAt` is stamped by the sweep and cleared when
 * the date moves (normalizeLegalFieldsWrite). A request whose date is
 * already behind us and was never noticed is still due, because the team
 * asked to be told and has not been.
 */
export function expiryNoticeDue(input: {
  /** yyyy-mm-dd, or null when unset. */
  expiresOn: string | null;
  notifyOnExpiry: boolean;
  notifiedAt: string | null;
  /** Epoch milliseconds. */
  now: number;
}): boolean {
  if (!input.notifyOnExpiry || input.notifiedAt) return false;
  if (!input.expiresOn) return false;
  const at = Date.parse(input.expiresOn);
  if (Number.isNaN(at)) return false;
  const lead = EXPIRY_NOTICE_LEAD_DAYS * 24 * 60 * 60 * 1000;
  return at - lead <= input.now;
}
