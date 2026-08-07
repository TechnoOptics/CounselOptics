import { describe, expect, it } from 'vitest';
import {
  COUNTERPARTY_VALUE_MAX,
  canonicalizeForHash,
  counterpartyFieldsOnDocument,
  formatCounterpartyDate,
  formatCounterpartyValue,
  isWinAnsiEncodable,
  missingCounterpartyFields,
  resolveCounterpartySubmission,
  sanitizeCounterpartyValues,
} from '../lib/counterparty-fields';
import type { TemplateField } from '../lib/firm-templates';
import type { FieldBox } from '../lib/template-field-boxes';

/**
 * What the other side may write into an approved instrument.
 *
 * The surface these values arrive on is public and the action that stores
 * them is a `'use server'` export, which is a public HTTP endpoint callable
 * with any arguments in any order. So every rule below is checked over plain
 * values rather than being assumed from what a form rendered.
 */

const FIELDS: TemplateField[] = [
  { key: 'company', label: 'Company', type: 'text', required: true, party: 'employee' },
  // A field with no party at all, which is every field on every template that
  // existed before this shipped.
  { key: 'project', label: 'Project', type: 'text', required: false },
  {
    key: 'entity_name',
    label: 'Your registered entity name',
    type: 'text',
    required: true,
    party: 'counterparty',
  },
  {
    key: 'entity_address',
    label: 'Registered address',
    type: 'textarea',
    required: false,
    party: 'counterparty',
  },
  {
    key: 'effective_date',
    label: 'Effective date',
    type: 'date',
    required: true,
    party: 'counterparty',
  },
];

function box(key: string): FieldBox {
  return { key, page: 1, x: 64, y: 500, widthPt: 200, heightPt: 16 };
}

describe('sanitizeCounterpartyValues', () => {
  it('drops an employee-owned key rather than accepting it', () => {
    // THE GATE THIS MODULE EXISTS FOR. The employee's answers are what
    // counsel reviewed and approved. A counterparty who could overwrite one
    // could change the approved instrument after approval.
    const values = sanitizeCounterpartyValues(FIELDS, {
      company: 'Not Their Company Inc',
      project: 'Also not theirs',
      entity_name: 'Wren Supply Co.',
    });
    expect(values).toEqual({ entity_name: 'Wren Supply Co.' });
    expect(values.company).toBeUndefined();
    expect(values.project).toBeUndefined();
  });

  it('drops a key the template never declared', () => {
    expect(
      sanitizeCounterpartyValues(FIELDS, { invented_key: 'x', entity_name: 'Wren' }),
    ).toEqual({ entity_name: 'Wren' });
  });

  it('drops a value that is not a string or a number', () => {
    // A caller can send anything. An object here would reach String() and be
    // written onto the instrument as "[object Object]".
    expect(
      sanitizeCounterpartyValues(FIELDS, {
        entity_name: { toString: () => 'Wren' },
      }),
    ).toEqual({});
    expect(sanitizeCounterpartyValues(FIELDS, { entity_name: ['Wren'] })).toEqual({});
    expect(sanitizeCounterpartyValues(FIELDS, { entity_name: null })).toEqual({});
    expect(sanitizeCounterpartyValues(FIELDS, null)).toEqual({});
    expect(sanitizeCounterpartyValues(FIELDS, 'not an object')).toEqual({});
  });

  it('bounds the length', () => {
    const long = 'W'.repeat(5000);
    const out = sanitizeCounterpartyValues(FIELDS, { entity_name: long });
    expect(out.entity_name).toHaveLength(COUNTERPARTY_VALUE_MAX);
  });

  it('folds newlines and runs of whitespace, because the blank is one line', () => {
    // pdf-lib draws a newline as nothing, so a multi-line value would be
    // silently shortened on the instrument.
    expect(
      sanitizeCounterpartyValues(FIELDS, {
        entity_address: '  12 Mill Lane\n\tSuite  4  \r\n Boston  ',
      }),
    ).toEqual({ entity_address: '12 Mill Lane Suite 4 Boston' });
  });

  it('drops a blank answer rather than storing an empty string', () => {
    expect(sanitizeCounterpartyValues(FIELDS, { entity_name: '   ' })).toEqual({});
  });
});

describe('counterpartyFieldsOnDocument', () => {
  it('asks only for fields the approved document has a blank for', () => {
    // A field added to the template after this document was rendered has
    // nowhere to go on it, so collecting a value for it would record a fact
    // the instrument does not carry.
    const fields = counterpartyFieldsOnDocument(FIELDS, [box('entity_name')]);
    expect(fields.map((f) => f.key)).toEqual(['entity_name']);
  });

  it('asks for nothing when the document recorded no blanks', () => {
    // Which is the state of every document rendered before this shipped, and
    // of every document whose firm has not applied the migration.
    expect(counterpartyFieldsOnDocument(FIELDS, [])).toEqual([]);
  });

  it('never returns an employee field however the boxes are keyed', () => {
    // A corrupt or hand-edited field_boxes naming an employee key must not
    // turn that field into one the counterparty is asked for.
    expect(counterpartyFieldsOnDocument(FIELDS, [box('company'), box('project')])).toEqual(
      [],
    );
  });
});

describe('missingCounterpartyFields', () => {
  it('names the required blanks that are empty, in document order', () => {
    expect(missingCounterpartyFields(FIELDS, {})).toEqual([
      'entity_name',
      'effective_date',
    ]);
  });

  it('ignores an optional blank and an employee field', () => {
    expect(
      missingCounterpartyFields(FIELDS, {
        entity_name: 'Wren Supply Co.',
        effective_date: '2026-08-06',
      }),
    ).toEqual([]);
  });
});

describe('canonicalizeForHash', () => {
  it('is stable however the keys were ordered', () => {
    // The recorded SHA-256 is evidence only if it can be reproduced, and
    // neither the browser's key order nor jsonb's storage order is ours.
    const a = canonicalizeForHash({ b: '2', a: '1', c: '3' });
    const b = canonicalizeForHash({ c: '3', a: '1', b: '2' });
    expect(a).toBe(b);
    expect(a).toBe('[["a","1"],["b","2"],["c","3"]]');
  });

  it('distinguishes a different answer', () => {
    expect(canonicalizeForHash({ a: '1' })).not.toBe(canonicalizeForHash({ a: '2' }));
  });

  it('distinguishes a value moved between keys', () => {
    // A flat concatenation would hash these two the same.
    expect(canonicalizeForHash({ ab: 'c', d: 'e' })).not.toBe(
      canonicalizeForHash({ a: 'bc', d: 'e' }),
    );
  });
});

describe('formatCounterpartyDate', () => {
  it('prints the long form the signature block already uses', () => {
    // One instrument, one date format. No reader has to guess whether 06/08
    // is June or August.
    expect(formatCounterpartyDate('2026-08-06')).toBe('August 6, 2026');
    expect(formatCounterpartyDate('2026-01-01')).toBe('January 1, 2026');
    expect(formatCounterpartyDate('2026-12-31')).toBe('December 31, 2026');
  });

  it('does not go through Date, so no timezone can move the day', () => {
    // new Date('2026-08-06') is UTC midnight, and toLocaleDateString renders
    // it in the reader's own zone: a signer west of Greenwich would see the
    // day before the one they picked, and the executed copy is rendered on a
    // server in a third zone. The parts are read from the string instead.
    const previous = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(formatCounterpartyDate('2026-08-06')).toBe('August 6, 2026');
      }
    } finally {
      process.env.TZ = previous;
    }
  });

  it('returns anything it cannot parse unchanged', () => {
    // Still the signer's answer. Dropping it would be worse than printing it
    // the way they typed it.
    expect(formatCounterpartyDate('next Tuesday')).toBe('next Tuesday');
    expect(formatCounterpartyDate('2026-13-01')).toBe('2026-13-01');
    expect(formatCounterpartyDate('2026-00-10')).toBe('2026-00-10');
    expect(formatCounterpartyDate('')).toBe('');
  });
});

describe('isWinAnsiEncodable', () => {
  it('accepts the Latin-1 band, so an accented name is not refused', () => {
    expect(isWinAnsiEncodable('Wren Supply Co.')).toBe(true);
    expect(isWinAnsiEncodable('Société Générale')).toBe(true);
    expect(isWinAnsiEncodable('Ærø Rederi A/S')).toBe(true);
    expect(isWinAnsiEncodable('Müller & Söhne GmbH')).toBe(true);
  });

  it('accepts the WinAnsi block a phone keyboard substitutes into', () => {
    // Curly quotes, dashes and the ellipsis arrive without being asked for.
    // Written as escapes so the literal characters under test cannot be
    // mistaken for prose punctuation by the house style sweep.
    expect(
      isWinAnsiEncodable('O\u2019Brien \u201cTrading\u201d \u2013 Ltd\u2026'),
    ).toBe(true);
    expect(isWinAnsiEncodable('€1,000')).toBe(true);
  });

  it('refuses what the font cannot draw', () => {
    expect(isWinAnsiEncodable('株式会社')).toBe(false);
    expect(isWinAnsiEncodable('Wren Щ')).toBe(false);
  });
});

describe('formatCounterpartyValue', () => {
  it('formats a date field and leaves everything else alone', () => {
    // The overlay and the stamp both call this. If either had its own copy,
    // the signer would confirm one thing and receive another.
    expect(formatCounterpartyValue({ type: 'date' }, '2026-08-06')).toBe('August 6, 2026');
    expect(formatCounterpartyValue({ type: 'text' }, '2026-08-06')).toBe('2026-08-06');
    expect(formatCounterpartyValue({ type: 'text' }, '  Wren  ')).toBe('Wren');
  });
});

describe('resolveCounterpartySubmission', () => {
  const open = {
    accessCodeRequired: true,
    accessVerifiedAt: '2026-08-06T10:00:00Z',
    requestStatus: 'sent',
    signedAt: null as string | null,
    signerResponse: null as string | null,
    fields: FIELDS,
  };
  const good = { entity_name: 'Wren Supply Co.', effective_date: '2026-08-06' };

  it('accepts a complete answer and returns what will be stored and hashed', () => {
    const out = resolveCounterpartySubmission({ ...open, values: good });
    expect(out).toEqual({
      ok: true,
      values: good,
      canonical: canonicalizeForHash(good),
    });
  });

  it('refuses a link that has not had its access code entered', () => {
    // First, so a link forwarded without its code learns nothing about the
    // request behind it. Do not reorder.
    expect(
      resolveCounterpartySubmission({ ...open, accessVerifiedAt: null, values: good }),
    ).toEqual({ ok: false, reason: 'code-required' });
  });

  it('lets an internal signer through without a code', () => {
    expect(
      resolveCounterpartySubmission({
        ...open,
        accessCodeRequired: false,
        accessVerifiedAt: null,
        values: good,
      }).ok,
    ).toBe(true);
  });

  it('refuses a recalled request', () => {
    expect(
      resolveCounterpartySubmission({ ...open, requestStatus: 'canceled', values: good }),
    ).toEqual({ ok: false, reason: 'canceled' });
  });

  it('refuses once the document has been signed', () => {
    // The contents are settled at the moment of signature. Accepting a value
    // afterwards would change what the signature was over.
    expect(
      resolveCounterpartySubmission({
        ...open,
        signedAt: '2026-08-06T11:00:00Z',
        values: good,
      }),
    ).toEqual({ ok: false, reason: 'already-signed' });
  });

  it('refuses a signer who declined or asked for changes', () => {
    expect(
      resolveCounterpartySubmission({ ...open, signerResponse: 'rejected', values: good }),
    ).toEqual({ ok: false, reason: 'on-hold' });
    expect(
      resolveCounterpartySubmission({
        ...open,
        requestStatus: 'changes_requested',
        values: good,
      }),
    ).toEqual({ ok: false, reason: 'on-hold' });
  });

  it('refuses a document that asks the signer for nothing', () => {
    // Every document this product has produced so far. There is no step to
    // complete, so a call claiming to complete one is not a call we made.
    expect(
      resolveCounterpartySubmission({
        ...open,
        fields: FIELDS.filter((f) => f.party !== 'counterparty'),
        values: { company: 'Anything' },
      }),
    ).toEqual({ ok: false, reason: 'nothing-to-fill' });
  });

  it('refuses an incomplete answer and names what is missing', () => {
    expect(
      resolveCounterpartySubmission({ ...open, values: { entity_name: 'Wren' } }),
    ).toEqual({ ok: false, reason: 'incomplete', missing: ['effective_date'] });
  });

  it('refuses a value the document cannot print, and names the field', () => {
    // Refused here, where the signer can retype it, rather than at the stamp,
    // where it is a thrown error in the middle of producing the executed copy
    // hours after they have gone. Accented Latin is fine; this is not a rule
    // against non-English names, it is the limit of what pdf-lib's standard
    // fonts can draw.
    expect(
      resolveCounterpartySubmission({
        ...open,
        values: { ...good, entity_name: '株式会社' },
      }),
    ).toEqual({
      ok: false,
      reason: 'unsupported-characters',
      missing: ['entity_name'],
    });
    expect(
      resolveCounterpartySubmission({
        ...open,
        values: {
          ...good,
          entity_name: 'Wren Supply Co. \u00c9\u00fcbernahme \u2013 GmbH',
        },
      }).ok,
    ).toBe(true);
  });

  it('refuses an answer that is only employee keys', () => {
    // The party filter drops them, and what is left fails the required check
    // rather than being written as a complete submission.
    const out = resolveCounterpartySubmission({
      ...open,
      values: { company: 'Not theirs', project: 'Not theirs either' },
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('incomplete');
  });
});
