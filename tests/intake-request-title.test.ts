import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';
import {
  inhouseIntakeAnswers,
  intakeTitle,
} from '../lib/intake-request';

/**
 * The title an employee types has to survive the trip to the screen.
 *
 * It did not. The form read `subject` off the field, used it for
 * `client_name`, and never wrote `intake_answers.subject` - the key that six
 * readers check first. So every employee-filed request was titled by its
 * generic type ("NDA / confidentiality"), and the one person who could tell
 * the difference was the one who had typed a real title.
 *
 * A test that only rendered the form would have passed on that code: the
 * input was there, required, and correctly named. The assertion that catches
 * it is the round trip - write the answers the form writes, then read them
 * with the helper the surfaces read with, and require the typed words back.
 */

const DENVER = 'Contractor NDA for the Denver office';

/** The fields the in-house form submits, as FormData submits them. */
function submitted(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('subject', DENVER);
  fd.set('submittedBy', 'Dana Okafor');
  fd.set('priority', 'Normal');
  fd.set('confidentiality', 'Standard');
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

describe('an in-house request keeps the title that was typed', () => {
  it('writes it to intake_answers.subject', () => {
    expect(inhouseIntakeAnswers(submitted(), DENVER).subject).toBe(DENVER);
  });

  it('reads back as the title, not as the request type', () => {
    const answers = inhouseIntakeAnswers(submitted(), DENVER);
    expect(
      intakeTitle({
        intake_answers: answers,
        matter_type: 'NDA / confidentiality',
        client_name: 'Dana Okafor',
      }),
    ).toBe(DENVER);
  });

  it('reads back as the title on the counsel side too, where client_name is the requester', () => {
    // The partner API stores the employee's name in client_name and the
    // subject in intake_answers. A reader that used client_name showed a
    // person's name where the subject belongs.
    expect(
      intakeTitle({
        intake_answers: { subject: DENVER },
        matter_type: 'Legal request',
        client_name: 'Dana Okafor',
      }),
    ).toBe(DENVER);
  });

  it('still carries the rest of the in-house metadata', () => {
    const answers = inhouseIntakeAnswers(
      submitted({ dueBy: '2026-09-01', priority: 'High' }),
      DENVER,
    );
    expect(answers.submitted_by).toBe('Dana Okafor');
    expect(answers.due_by).toBe('2026-09-01');
    expect(answers.priority).toBe('High');
    expect(answers.confidentiality).toBe('Standard');
    // Not rendered in employee mode, so it must read as absent, not ''.
    expect(answers.expiry).toBeNull();
  });

  it('falls back to the request type only when no title was stored', () => {
    expect(
      intakeTitle({
        intake_answers: { subject: '   ' },
        matter_type: 'NDA / confidentiality',
        client_name: 'Dana Okafor',
      }),
    ).toBe('NDA / confidentiality');
  });
});

/**
 * The helper above is only worth anything if the two surfaces reach it. Both
 * checks read the source with comments stripped, so a comment naming the
 * call cannot satisfy them.
 */
function source(rel: string): string {
  return stripComments(
    readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8'),
  );
}

describe('both ends are wired to it', () => {
  it('the request form builds its answers with inhouseIntakeAnswers', () => {
    const src = source('app/counsel/intake/create-intake-form.tsx');
    expect(src).toContain('inhouseIntakeAnswers(formData, subject)');
  });

  it('the counsel request queue titles a row with intakeTitle', () => {
    // The queue is a table now and the title is resolved on the server, so
    // this reads the page that builds the rows rather than the component that
    // draws them. Same rule, same reason: `client_name` holds the REQUESTER on
    // the partner path, so it can never be the subject.
    const src = source('app/counsel/inbox/page.tsx');
    expect(src).toContain('intakeTitle(r)');
  });
});
