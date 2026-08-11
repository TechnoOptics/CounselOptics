import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
  checkTemplateFieldValue,
  invalidFieldValues,
  parseTemplateFieldType,
  templateFieldInputAttributes,
  type TemplateFieldType,
} from '../lib/template-field-formats';
import { parseTemplateFields } from '../lib/counterparty-fields';

/**
 * What a template field accepts, what it refuses, and the one whitelist that
 * decides which formats exist at all.
 *
 * THE WHITELIST IS THE POINT. A stored field is read back through
 * parseTemplateFieldType, and before this module that reading was written out
 * twice as a literal (`o.type === 'date' || o.type === 'textarea' ? o.type :
 * 'text'`) in lib/firm-templates.ts and lib/counterparty-fields.ts. A format
 * added to the union without widening both literals is a format a firm can
 * configure and save and never get back: the read silently returns 'text' and
 * nothing anywhere says so. So the round-trip below is driven BY the union
 * rather than by a list written here, and adding a type with no reader fails
 * it.
 */

describe('the set of formats', () => {
  it('keeps the three a template could always have', () => {
    expect(TEMPLATE_FIELD_TYPES).toContain('text');
    expect(TEMPLATE_FIELD_TYPES).toContain('textarea');
    expect(TEMPLATE_FIELD_TYPES).toContain('date');
  });

  it('adds the four the legal team asked for', () => {
    expect(TEMPLATE_FIELD_TYPES).toContain('email');
    expect(TEMPLATE_FIELD_TYPES).toContain('number');
    expect(TEMPLATE_FIELD_TYPES).toContain('currency');
    expect(TEMPLATE_FIELD_TYPES).toContain('phone');
  });

  /**
   * A signature is NOT a format, and this asserts it stays that way.
   *
   * Three mechanisms already answer "how is this signed": the signature places
   * lib/template-blank-detection.ts finds and deliberately never turns into
   * fields, the methods lib/signature-methods.ts permits, and the mark
   * components/SignaturePad.tsx captures. A field type would be a fourth, and
   * it would be the worst of them: a text box somebody types a signature into,
   * which is the exact thing lib/template-proposal.ts strips out of imported
   * bodies.
   */
  it('has no signature format, and reads a stored one as text', () => {
    expect(TEMPLATE_FIELD_TYPES as readonly string[]).not.toContain('signature');
    expect(parseTemplateFieldType('signature')).toBe('text');
  });

  it('gives every format a label', () => {
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(TEMPLATE_FIELD_TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it('gives every format the input attributes a browser needs', () => {
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(templateFieldInputAttributes(type).type).toBeTruthy();
    }
  });
});

describe('parseTemplateFieldType', () => {
  it('returns every format in the union unchanged', () => {
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(parseTemplateFieldType(type)).toBe(type);
    }
  });

  it('reads anything it does not recognise as text', () => {
    for (const raw of [undefined, null, '', 'Email', 'colour', 7, {}, []]) {
      expect(parseTemplateFieldType(raw)).toBe('text');
    }
  });
});

describe('reading a stored field back', () => {
  /**
   * The defect this whole change is built around: a firm configures an email
   * field, saves it, and gets a plain text box back.
   */
  it('round-trips every format through parseTemplateFields', () => {
    const stored = TEMPLATE_FIELD_TYPES.map((type, i) => ({
      key: `f${i}`,
      label: type,
      type,
      required: true,
    }));
    const read = parseTemplateFields(stored);
    expect(read.map((f) => f.type)).toEqual([...TEMPLATE_FIELD_TYPES]);
  });

  it('leaves a field saved before formats existed as text', () => {
    const read = parseTemplateFields([{ key: 'client', label: 'Client', required: true }]);
    expect(read[0].type).toBe('text');
  });
});

describe('an empty answer', () => {
  /**
   * Emptiness is the required flag's question, and it is asked elsewhere
   * (missingRequired, missingCounterpartyFields). A format that also refused
   * blanks would put two sentences under one input for one mistake.
   */
  it('is accepted by every format, because required is a separate rule', () => {
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(checkTemplateFieldValue(type, '   ')).toEqual({ ok: true, value: '' });
    }
  });
});

describe('text and paragraph', () => {
  it('accept anything, trimmed', () => {
    expect(checkTemplateFieldValue('text', '  Acme Holdings  ')).toEqual({
      ok: true,
      value: 'Acme Holdings',
    });
    expect(checkTemplateFieldValue('textarea', ' two\nlines ')).toEqual({
      ok: true,
      value: 'two\nlines',
    });
  });
});

describe('email', () => {
  it('accepts an address with an @ and a dot after it', () => {
    for (const value of [
      'dana@acme.co',
      'first.last+tag@mail.example.co.uk',
      "o'brien@acme.com",
      'DANA@Acme.CO',
    ]) {
      expect(checkTemplateFieldValue('email', value)).toEqual({ ok: true, value });
    }
  });

  it('trims surrounding space rather than refusing it', () => {
    expect(checkTemplateFieldValue('email', '  dana@acme.co ')).toEqual({
      ok: true,
      value: 'dana@acme.co',
    });
  });

  it('refuses an address with no @ at all', () => {
    const result = checkTemplateFieldValue('email', 'dana.acme.co');
    expect(result.ok).toBe(false);
  });

  it('refuses an address with no dot after the @', () => {
    expect(checkTemplateFieldValue('email', 'dana@acme').ok).toBe(false);
  });

  it('refuses an address with nothing before or after the parts', () => {
    for (const value of ['@acme.co', 'dana@.co', 'dana@acme.', 'dana@@acme.co']) {
      expect(checkTemplateFieldValue('email', value).ok).toBe(false);
    }
  });

  it('refuses an address with a space inside it', () => {
    expect(checkTemplateFieldValue('email', 'dana smith@acme.co').ok).toBe(false);
  });
});

describe('number', () => {
  it('accepts a plain number', () => {
    expect(checkTemplateFieldValue('number', '42')).toEqual({ ok: true, value: '42' });
  });

  it('accepts a negative and a decimal', () => {
    expect(checkTemplateFieldValue('number', '-3.5')).toEqual({ ok: true, value: '-3.5' });
  });

  it('accepts thousands separators and drops them', () => {
    expect(checkTemplateFieldValue('number', '1,200,000')).toEqual({
      ok: true,
      value: '1200000',
    });
  });

  it('refuses words', () => {
    expect(checkTemplateFieldValue('number', 'twelve').ok).toBe(false);
  });

  it('refuses two decimal points', () => {
    expect(checkTemplateFieldValue('number', '1.2.3').ok).toBe(false);
  });
});

describe('currency', () => {
  it('writes an amount the way a US document prints it', () => {
    expect(checkTemplateFieldValue('currency', '1234.5')).toEqual({
      ok: true,
      value: '$1,234.50',
    });
  });

  it('accepts the dollar sign and the commas somebody typed', () => {
    expect(checkTemplateFieldValue('currency', '$1,234')).toEqual({
      ok: true,
      value: '$1,234.00',
    });
  });

  it('accepts a negative amount', () => {
    expect(checkTemplateFieldValue('currency', '-250')).toEqual({
      ok: true,
      value: '-$250.00',
    });
  });

  it('refuses words', () => {
    expect(checkTemplateFieldValue('currency', 'ten dollars').ok).toBe(false);
  });

  /**
   * Refused rather than rounded. Rounding an amount on a legal instrument
   * without telling anybody is a change to the obligation.
   */
  it('refuses more than two decimal places rather than rounding them away', () => {
    const result = checkTemplateFieldValue('currency', '1.005');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/two decimal places/i);
  });
});

describe('phone', () => {
  it('accepts the punctuation people actually type, and normalises it', () => {
    for (const value of [
      '(555) 123-4567',
      '555-123-4567',
      '555.123.4567',
      '5551234567',
      '+1 555 123 4567',
      '1 (555) 123 4567',
    ]) {
      expect(checkTemplateFieldValue('phone', value)).toEqual({
        ok: true,
        value: '(555) 123-4567',
      });
    }
  });

  it('refuses a number that is not ten digits', () => {
    const result = checkTemplateFieldValue('phone', '555-1234');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/ten digits/i);
  });

  it('refuses letters', () => {
    expect(checkTemplateFieldValue('phone', '555-CALL-NOW').ok).toBe(false);
  });

  it('refuses an eleven-digit number that does not start with 1', () => {
    expect(checkTemplateFieldValue('phone', '25551234567').ok).toBe(false);
  });
});

describe('date', () => {
  it('accepts what a date picker produces', () => {
    expect(checkTemplateFieldValue('date', '2026-08-10')).toEqual({
      ok: true,
      value: '2026-08-10',
    });
  });

  it('refuses a month or a day that does not exist', () => {
    expect(checkTemplateFieldValue('date', '2026-13-01').ok).toBe(false);
    expect(checkTemplateFieldValue('date', '2026-02-30').ok).toBe(false);
  });

  it('refuses a date typed in another shape, rather than guessing the order', () => {
    expect(checkTemplateFieldValue('date', '08/10/2026').ok).toBe(false);
  });
});

describe('what somebody is told', () => {
  /**
   * Users arrive here in legal distress. Every refusal says what to fix, in a
   * sentence, without an exclamation mark and without telling anybody they got
   * it wrong.
   */
  it('says what to fix, calmly, for every format that can refuse', () => {
    const refusals = [
      checkTemplateFieldValue('email', 'nope'),
      checkTemplateFieldValue('number', 'nope'),
      checkTemplateFieldValue('currency', 'nope'),
      checkTemplateFieldValue('phone', 'nope'),
      checkTemplateFieldValue('date', 'nope'),
    ];
    for (const r of refusals) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message.length).toBeGreaterThan(12);
      expect(r.message.endsWith('.')).toBe(true);
      expect(r.message).not.toMatch(/[!]|invalid|error/i);
    }
  });
});

describe('invalidFieldValues', () => {
  const fields = [
    { key: 'email', label: 'Work email', type: 'email' as TemplateFieldType },
    { key: 'fee', label: 'Fee', type: 'currency' as TemplateFieldType },
    { key: 'note', label: 'Note', type: 'text' as TemplateFieldType },
  ];

  it('reports nothing when every answer fits its format', () => {
    expect(
      invalidFieldValues(fields, { email: 'dana@acme.co', fee: '10', note: 'hi' }),
    ).toEqual([]);
  });

  it('names the field by its label, in the template order', () => {
    const bad = invalidFieldValues(fields, { fee: 'lots', email: 'dana' });
    expect(bad.map((b) => b.key)).toEqual(['email', 'fee']);
    expect(bad[0].label).toBe('Work email');
  });

  it('says nothing about an answer nobody gave', () => {
    expect(invalidFieldValues(fields, {})).toEqual([]);
  });

  it('ignores a value posted under a key the template never declared', () => {
    expect(invalidFieldValues(fields, { smuggled: 'nope' })).toEqual([]);
  });
});
