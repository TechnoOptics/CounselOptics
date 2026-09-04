/**
 * What an employee tells the legal team when they send a contract in: the
 * shared fields of the contract family.
 *
 * SHARED, NOT LEGAL-ONLY. Everything here is what the employee filed, so it
 * rides in `intake_answers` under one key and renders on BOTH ticket pages.
 * That is the opposite decision from lib/intake-legal-fields.ts, and it is
 * the same rule seen from the other side: the employee's page selects
 * intake_answers whole, so a value the employee wrote may live there and a
 * value the legal team keeps to itself may not.
 *
 * One key, `contract`, rather than nine flat ones, so the employee page's
 * guard on which keys it reads out of the blob (tests/employee-payload-
 * scope.test.ts) has one entry to review rather than nine.
 *
 * WHAT IS NOT DUPLICATED. Desired completion date is the existing `due_by`.
 * Context and details is the existing `matter_summary`. Attachments are the
 * existing attachment field. The counterparty's name is the existing
 * "Counterparty / other side" list, which the conflict check reads; the
 * entity block here is the contact detail beside it, not a second name.
 *
 * Pure. The form reader takes "just enough of FormData" so it runs under
 * node and a test can drive it with the object the form submits.
 */

import { familyOfType } from './portal-request-families';
import { formField, type FormFields } from './intake-request';

export const CONTRACT_ANSWER_KEY = 'contract';

/** What kind of instrument this is. The request type says NDA or MSA; this says new, renewal or change. */
export const CONTRACT_DOCUMENT_TYPES = [
  'New agreement',
  'Renewal',
  'Amendment',
  'Statement of work or order form',
  'Termination',
  'Other',
] as const;

/** Whose paper the employee expects to sign. */
export const CONTRACT_VERSIONS = [
  'Our standard template',
  'The other side\'s version',
  'A redline of their version',
  'Not sure',
] as const;

export type ContractDetails = {
  entity: string | null;
  contact_name: string | null;
  contact_email: string | null;
  department: string | null;
  location: string | null;
  document_type: string | null;
  version_requested: string | null;
  signer_name: string | null;
  signer_title: string | null;
};

/** Whether a request type is one the contract fields belong to. */
export function isContractRequestType(requestType: string | null | undefined): boolean {
  return familyOfType(requestType)?.key === 'contract';
}

const oneOf = (v: string | null, allowed: readonly string[]): string | null =>
  v && allowed.includes(v) ? v : null;

/**
 * The contract block off the form, or nothing at all when the request is
 * not a contract, so a request of another type never carries an empty
 * `contract` key that a reader would have to treat as "filed nothing".
 */
export function contractIntakeAnswers(
  fd: FormFields,
  requestType: string,
): Record<string, unknown> {
  if (!isContractRequestType(requestType)) return {};
  const details: ContractDetails = {
    entity: formField(fd, 'contractEntity'),
    contact_name: formField(fd, 'contractContactName'),
    contact_email: formField(fd, 'contractContactEmail'),
    department: formField(fd, 'contractDepartment'),
    location: formField(fd, 'contractLocation'),
    document_type: oneOf(formField(fd, 'contractDocumentType'), CONTRACT_DOCUMENT_TYPES),
    version_requested: oneOf(formField(fd, 'contractVersion'), CONTRACT_VERSIONS),
    signer_name: formField(fd, 'contractSignerName'),
    signer_title: formField(fd, 'contractSignerTitle'),
  };
  // A contract request filed with the block left blank stores no block, so
  // the record does not carry nine nulls that read as "filed nothing".
  if (Object.values(details).every((v) => v === null)) return {};
  return { [CONTRACT_ANSWER_KEY]: details };
}

/** The labels both pages print, in the order the form asks. */
const LABELS: Array<[keyof ContractDetails, string]> = [
  ['entity', 'Customer or entity'],
  ['contact_name', 'Their contact'],
  ['contact_email', 'Contact email'],
  ['department', 'Department'],
  ['location', 'Location'],
  ['document_type', 'Document type'],
  ['version_requested', 'Version requested'],
  ['signer_name', 'Signs for us'],
  ['signer_title', 'Signer title'],
];

/**
 * The filled fields as label and value pairs, for a page to print. Reads the
 * stored `contract` value, which is untrusted jsonb as far as this code is
 * concerned: anything that is not an object is no details at all.
 */
export function readContractDetails(
  raw: unknown,
): Array<{ label: string; value: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  return LABELS.map(([key, label]) => ({
    label,
    value: String(r[key] ?? '').trim(),
  })).filter((f) => f.value.length > 0);
}
