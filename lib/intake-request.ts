/**
 * What an in-house request stores, and what it is called.
 *
 * The two halves live together because they are one rule seen from each end.
 * The title a person types on the request form is written to
 * `intake_answers.subject`, and every surface that names a request reads that
 * key first. The ends drifted apart: the form had no writer for `subject` at
 * all, so six readers fell straight through to `matter_type` and every
 * employee-filed request was titled by its generic type. "Contractor NDA for
 * the Denver office" was stored - it went to `client_name` - and shown
 * nowhere.
 *
 * `client_name` cannot be the title. On the partner-API path
 * (lib/partner-tickets.ts) that column holds the REQUESTER's name, which is
 * why the counsel inbox showed a person where a subject belongs. Only
 * `intake_answers.subject` means the same thing on both paths.
 */

export type IntakeTitleRow = {
  intake_answers: Record<string, unknown> | null;
  matter_type: string | null;
  client_name: string | null;
};

/** What the request IS, not who filed it. */
export function intakeTitle(row: IntakeTitleRow): string {
  const answers = (row.intake_answers ?? {}) as Record<string, unknown>;
  return (
    String(answers.subject ?? '').trim() ||
    (row.matter_type ?? '').trim() ||
    (row.client_name ?? '').trim() ||
    'Legal request'
  );
}

/**
 * Just enough of FormData to read a field, so this runs in Node without a
 * DOM and a test can drive it with the same object the form submits.
 */
export type FormFields = { get(name: string): unknown };

/** A trimmed field, or null when it was blank. Shared with the contract reader. */
export function formField(fd: FormFields, name: string): string | null {
  return String(fd.get(name) ?? '').trim() || null;
}

/**
 * The metadata an in-house request carries in `intake_answers`.
 *
 * Extracted from the form so the write has somewhere to be tested. Inline it
 * was a block of assignments no test could reach, which is how it lost
 * `subject` without anything going red.
 */
export function inhouseIntakeAnswers(
  fd: FormFields,
  subject: string,
): Record<string, unknown> {
  return {
    subject: subject.trim(),
    submitted_by: formField(fd, 'submittedBy'),
    due_by: formField(fd, 'dueBy'),
    expiry: formField(fd, 'expiry'),
    priority: formField(fd, 'priority'),
    confidentiality: formField(fd, 'confidentiality'),
  };
}
