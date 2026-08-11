import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';
import {
  fieldFormatRefusal,
  checkTemplateFieldValue,
} from '../lib/template-field-formats';
import {
  COUNTERPARTY_REFUSAL_COPY,
  resolveCounterpartySubmission,
  sanitizeCounterpartyValues,
} from '../lib/counterparty-fields';
import { sanitizeTemplateValues } from '../lib/template-fill';
import type { TemplateField } from '../lib/firm-templates';

/**
 * A format is a GATE, not a hint.
 *
 * Everything a browser checks here is checked again on a server, because every
 * `'use server'` export is a public HTTP endpoint callable with arguments of
 * the caller's own choosing, and the signing surface is public outright. This
 * repo has shipped the browser-only version of exactly this more than once.
 *
 * Three gates, three ways of asserting them:
 *   - fieldFormatRefusal, the rule itself, exercised over plain values.
 *   - resolveCounterpartySubmission, which is pure and is driven directly.
 *   - lib/template-submissions.ts, whose two submit actions pull in both
 *     Supabase clients, next/cache, notifications and rate limiting, so it is
 *     read as source in the same way tests/template-submissions-authz.test.ts
 *     reads it, and for the same reason.
 */

const EMPLOYEE_FIELDS: TemplateField[] = [
  { key: 'contact_email', label: 'Contact email', type: 'email', required: true },
  { key: 'fee', label: 'Fee', type: 'currency', required: false },
  { key: 'note', label: 'Note', type: 'text', required: false },
];

describe('fieldFormatRefusal', () => {
  it('says nothing when every answer fits', () => {
    expect(
      fieldFormatRefusal(EMPLOYEE_FIELDS, { contact_email: 'dana@acme.co', fee: '10' }),
    ).toBeNull();
  });

  it('names the field and says what to fix', () => {
    const refusal = fieldFormatRefusal(EMPLOYEE_FIELDS, { contact_email: 'dana' });
    expect(refusal).toContain('Contact email');
    expect(refusal).toContain('@');
  });

  it('reports every answer that does not fit, not only the first', () => {
    const refusal = fieldFormatRefusal(EMPLOYEE_FIELDS, {
      contact_email: 'dana',
      fee: 'lots',
    });
    expect(refusal).toContain('Contact email');
    expect(refusal).toContain('Fee');
  });
});

describe('the employee submission path', () => {
  const SOURCE = stripComments(
    readFileSync(
      fileURLToPath(new URL('../lib/template-submissions.ts', import.meta.url)),
      'utf8',
    ),
  );

  /**
   * Both actions, and both is the point: resubmit is the path an employee
   * takes after legal sends the form back, so a check on the first submit
   * alone is a check somebody walks around by being asked for a correction.
   */
  for (const action of [
    'submitTemplateForApprovalAction',
    'resubmitTemplateSubmissionAction',
  ]) {
    it(`${action} refuses an answer that does not fit its format`, () => {
      const at = SOURCE.indexOf(`export async function ${action}(`);
      expect(at).toBeGreaterThan(-1);
      const next = SOURCE.indexOf('\nexport async function ', at + 1);
      const body = SOURCE.slice(at, next === -1 ? SOURCE.length : next);
      expect(body).toContain('fieldFormatRefusal(');
    });
  }
});

describe('sanitizeTemplateValues', () => {
  it('stores the normalised answer, so the document carries one shape', () => {
    const fields: TemplateField[] = [
      { key: 'phone', label: 'Phone', type: 'phone', required: false },
      { key: 'fee', label: 'Fee', type: 'currency', required: false },
    ];
    expect(sanitizeTemplateValues(fields, { phone: '555.123.4567', fee: '1234.5' })).toEqual(
      { phone: '(555) 123-4567', fee: '$1,234.50' },
    );
  });

  it('leaves a text answer exactly as it was, trimmed', () => {
    const fields: TemplateField[] = [
      { key: 'company', label: 'Company', type: 'text', required: false },
    ];
    expect(sanitizeTemplateValues(fields, { company: '  Acme  ' })).toEqual({
      company: 'Acme',
    });
  });

  /**
   * Nothing is dropped for failing its format here. Dropping would turn a
   * mistyped answer into a missing one, and the employee would be told to fill
   * in a field they can see they filled in. The refusal is
   * fieldFormatRefusal's, and it names the field.
   */
  it('keeps an answer that does not fit, so the refusal can name it', () => {
    const fields: TemplateField[] = [
      { key: 'contact_email', label: 'Contact email', type: 'email', required: true },
    ];
    expect(sanitizeTemplateValues(fields, { contact_email: 'dana' })).toEqual({
      contact_email: 'dana',
    });
  });
});

describe('the counterparty signing path', () => {
  const FIELDS: TemplateField[] = [
    {
      key: 'signer_email',
      label: 'Your email',
      type: 'email',
      required: true,
      party: 'counterparty',
    },
  ];

  const open = {
    isCounterparty: true,
    accessCodeRequired: true,
    accessVerifiedAt: '2026-08-10T00:00:00Z',
    requestStatus: 'sent',
    signedAt: null,
    signerResponse: null,
    fields: FIELDS,
  };

  it('accepts an answer that fits, normalised', () => {
    const out = resolveCounterpartySubmission({
      ...open,
      values: { signer_email: '  dana@acme.co ' },
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.values.signer_email).toBe('dana@acme.co');
  });

  it('refuses an answer that does not fit, and names the field', () => {
    const out = resolveCounterpartySubmission({
      ...open,
      values: { signer_email: 'dana' },
    });
    expect(out).toEqual({
      ok: false,
      reason: 'wrong-format',
      missing: ['signer_email'],
    });
  });

  it('has calm wording for that refusal', () => {
    const copy = COUNTERPARTY_REFUSAL_COPY['wrong-format'];
    expect(copy.length).toBeGreaterThan(20);
    expect(copy).not.toMatch(/[!]|invalid|error/i);
  });

  /**
   * A blank required answer is still 'incomplete'. The format check must not
   * take that sentence over, or somebody who left a field empty is told their
   * answer is the wrong shape.
   */
  it('still reports an empty required answer as incomplete', () => {
    const out = resolveCounterpartySubmission({ ...open, values: {} });
    expect(out).toEqual({ ok: false, reason: 'incomplete', missing: ['signer_email'] });
  });

  it('normalises a phone the other side typed however they liked', () => {
    const fields: TemplateField[] = [
      { key: 'tel', label: 'Phone', type: 'phone', required: true, party: 'counterparty' },
    ];
    expect(sanitizeCounterpartyValues(fields, { tel: '+1 (555) 123-4567' })).toEqual({
      tel: '(555) 123-4567',
    });
  });
});

describe('the whitelist has no second copy', () => {
  /**
   * The trap this change exists to close. Two modules coerced a stored type
   * against a literal list, and a format added to the union without widening
   * BOTH became a plain text box on read with nothing said.
   *
   * Read as source rather than inferred from behaviour, because the behaviour
   * of a literal that happens to agree with the union today is
   * indistinguishable from the shared reading. What goes wrong is the next
   * format, and only the source says whether the next format is covered.
   */
  for (const file of ['../lib/firm-templates.ts', '../lib/counterparty-fields.ts']) {
    it(`${file} reads a field type through the shared whitelist`, () => {
      const source = stripComments(
        readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'),
      );
      expect(source).toContain('parseTemplateFieldType(');
      expect(source).not.toMatch(/o\.type === '(date|textarea)'/);
    });
  }
});

describe('a value survives the round trip it is put through', () => {
  /**
   * The normalised value is re-checked by the server after the browser has
   * already normalised it once, so a format whose normalisation its own check
   * refuses would refuse an answer nobody can fix.
   */
  it('re-accepts what it normalised', () => {
    const samples: [Parameters<typeof checkTemplateFieldValue>[0], string][] = [
      ['phone', '555.123.4567'],
      ['currency', '1234.5'],
      ['number', '1,200'],
      ['email', 'dana@acme.co'],
      ['date', '2026-08-10'],
    ];
    for (const [type, raw] of samples) {
      const once = checkTemplateFieldValue(type, raw);
      expect(once.ok).toBe(true);
      if (!once.ok) continue;
      expect(checkTemplateFieldValue(type, once.value)).toEqual(once);
    }
  });
});
