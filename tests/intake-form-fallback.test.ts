import { describe, it, expect } from 'vitest';
import {
  bindFormAnswers,
  buildQuestionAnswers,
  FALLBACK_REQUEST_TYPES,
  firstErrorFieldId,
  isSeededLabel,
  matchTypeKeysByLabel,
  modeForType,
  pickableRequestTypes,
  readAnswers,
  resolveRequestTypeKey,
} from '../lib/intake-form-fallback';
import type { FormPayload, Question } from '../lib/form-schema';

/**
 * The decision layer between the two intake surfaces and the new tables.
 *
 * Everything here is what a real firm sees the day this ships. Zero firms have
 * published a form, so the only thing that may change for them is what the
 * seeded `firm_request_types` rows produce, and nothing else. These tests pin
 * that: which types are offered, in what order, which are withheld, what mode
 * each carries, and the shape an answer is stored in.
 */

type Row = {
  key: string;
  label: string;
  mode: 'client' | 'inhouse';
  sortOrder: number;
  hidden: boolean;
};

function row(over: Partial<Row> & { key: string }): Row {
  return {
    label: over.key,
    mode: 'inhouse',
    sortOrder: 0,
    hidden: false,
    ...over,
  };
}

/** Zinpro's live rows: the 12 seeded defaults plus four partner slugs. */
function zinproRows(): Row[] {
  const partner: Array<[string, string]> = [
    ['contract-review', 'Contract Review'],
    ['hr', 'HR'],
    ['incident', 'Incident'],
    ['nda', 'NDA'],
  ];
  return [
    ...FALLBACK_REQUEST_TYPES.map((t) => ({ ...t })),
    ...partner.map(([key, label], i) =>
      row({ key, label, mode: 'inhouse', sortOrder: 101 + i }),
    ),
  ];
}

describe('FALLBACK_REQUEST_TYPES', () => {
  it('is the migration seed verbatim, so the no-table path matches the table', () => {
    expect(
      FALLBACK_REQUEST_TYPES.map((t) => [t.key, t.label, t.mode, t.sortOrder]),
    ).toEqual([
      ['new_case_matter', 'New case / matter', 'client', 0],
      ['new_contract_agreement', 'New contract / agreement', 'inhouse', 1],
      ['internal_review_request', 'Internal review request', 'inhouse', 2],
      ['document_for_safekeeping', 'Document for safekeeping', 'inhouse', 3],
      ['trademark_ip_filing', 'Trademark / IP filing', 'inhouse', 4],
      ['nda_review', 'NDA review', 'inhouse', 5],
      ['vendor_msa_review', 'Vendor / MSA review', 'inhouse', 6],
      ['employment_matter', 'Employment matter', 'inhouse', 7],
      ['compliance_question', 'Compliance question', 'inhouse', 8],
      ['litigation_hold', 'Litigation hold', 'inhouse', 9],
      ['demand_letter', 'Demand letter', 'inhouse', 10],
      ['other', 'Other', 'inhouse', 11],
    ]);
  });
});

describe('pickableRequestTypes', () => {
  it('falls back to the built-in twelve when the table read returns nothing', () => {
    expect(pickableRequestTypes([], false).map((t) => t.key)).toEqual(
      FALLBACK_REQUEST_TYPES.map((t) => t.key),
    );
    expect(pickableRequestTypes(null, false)).toHaveLength(12);
    expect(pickableRequestTypes(undefined, false)).toHaveLength(12);
  });

  it('withholds the one client-mode type from the employee picker', () => {
    const employee = pickableRequestTypes(FALLBACK_REQUEST_TYPES, true);
    expect(employee).toHaveLength(11);
    expect(employee.some((t) => t.key === 'new_case_matter')).toBe(false);
    expect(pickableRequestTypes(FALLBACK_REQUEST_TYPES, false)).toHaveLength(12);
  });

  it('never offers a hidden type', () => {
    const rows = [
      row({ key: 'a', sortOrder: 0 }),
      row({ key: 'b', sortOrder: 1, hidden: true }),
      row({ key: 'c', sortOrder: 2 }),
    ];
    expect(pickableRequestTypes(rows, false).map((t) => t.key)).toEqual(['a', 'c']);
  });

  it('orders by sort_order, so partner slugs sort after the canonical twelve', () => {
    const keys = pickableRequestTypes(zinproRows(), true).map((t) => t.key);
    expect(keys).toHaveLength(15);
    expect(keys.slice(0, 11)).toEqual(
      FALLBACK_REQUEST_TYPES.filter((t) => t.mode === 'inhouse').map((t) => t.key),
    );
    expect(keys.slice(11)).toEqual(['contract-review', 'hr', 'incident', 'nda']);
  });

  it('keeps near-duplicate types apart rather than merging them', () => {
    const keys = pickableRequestTypes(zinproRows(), true).map((t) => t.key);
    expect(keys).toContain('nda');
    expect(keys).toContain('nda_review');
  });

  it('breaks a sort_order tie on label, so the order is stable', () => {
    const rows = [
      row({ key: 'z', label: 'Zebra', sortOrder: 5 }),
      row({ key: 'a', label: 'Aardvark', sortOrder: 5 }),
    ];
    expect(pickableRequestTypes(rows, false).map((t) => t.key)).toEqual(['a', 'z']);
  });

  it('still offers something when every type is hidden or withheld', () => {
    const allHidden = FALLBACK_REQUEST_TYPES.map((t) => ({ ...t, hidden: true }));
    expect(pickableRequestTypes(allHidden, false)).toHaveLength(12);
    // A firm whose only types are client-mode leaves the employee picker with
    // nothing to offer. An employee must always be able to file.
    const clientOnly = [row({ key: 'only', mode: 'client', sortOrder: 0 })];
    expect(pickableRequestTypes(clientOnly, true)).toHaveLength(11);
  });
});

describe('modeForType', () => {
  const types = pickableRequestTypes(FALLBACK_REQUEST_TYPES, false);

  it('carries each type its own mode, which is not cosmetic', () => {
    expect(modeForType(types, 'new_case_matter')).toBe('client');
    expect(modeForType(types, 'nda_review')).toBe('inhouse');
  });

  it('reads an unknown key as client, matching the behaviour it replaces', () => {
    expect(modeForType(types, 'no_such_type')).toBe('client');
    expect(modeForType([], 'anything')).toBe('client');
  });
});

describe('readAnswers', () => {
  it('keeps strings and string arrays and drops everything else', () => {
    expect(
      readAnswers({ a: 'yes', b: ['x', 'y'], c: 7, d: null, e: { f: 1 } }),
    ).toEqual({ a: 'yes', b: ['x', 'y'] });
  });

  it('reads a non-object as no answers at all', () => {
    expect(readAnswers(null)).toEqual({});
    expect(readAnswers('answers')).toEqual({});
    expect(readAnswers(undefined)).toEqual({});
  });

  it('caps a single answer rather than storing an unbounded string', () => {
    const long = 'x'.repeat(30000);
    const out = readAnswers({ a: long }) as { a: string };
    expect(out.a.length).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// buildQuestionAnswers
// ---------------------------------------------------------------------------

function q(over: Partial<Question> & { id: string }): Question {
  return {
    key: over.id,
    type: 'short_text',
    label: over.id.toUpperCase(),
    required: false,
    config: {},
    ...over,
  };
}

function payload(fields: Question[][]): FormPayload {
  return {
    schemaVersion: 1,
    rows: fields.map((f, i) => ({ id: `r${i}`, fields: f })),
  };
}

describe('buildQuestionAnswers', () => {
  it('stores {id, label, value}, the shape the counsel page already renders', () => {
    const p = payload([[q({ id: 'a', label: 'Counterparty name' })]]);
    expect(buildQuestionAnswers(p, { a: 'Acme Inc' })).toEqual([
      { id: 'a', label: 'Counterparty name', value: 'Acme Inc' },
    ]);
  });

  it('leaves out a question that was never answered', () => {
    const p = payload([[q({ id: 'a' }), q({ id: 'b' })]]);
    expect(buildQuestionAnswers(p, { a: 'yes', b: '  ' }).map((x) => x.id)).toEqual(['a']);
  });

  it('leaves out a question the employee never saw', () => {
    const p = payload([
      [q({ id: 'has', key: 'has', type: 'yesno' })],
      [q({ id: 'who', key: 'who', showWhen: { questionId: 'has', op: 'eq', value: 'yes' } })],
    ]);
    // A stale answer left behind by flipping the controller back to No must
    // not reappear in the record.
    expect(buildQuestionAnswers(p, { has: 'no', who: 'Acme' })).toEqual([
      { id: 'has', label: 'HAS', value: 'no' },
    ]);
  });

  it('reads a multiselect back as one line', () => {
    const p = payload([[q({ id: 'a', type: 'multiselect', config: { options: ['x', 'y'] } })]]);
    expect(buildQuestionAnswers(p, { a: ['x', 'y'] })[0].value).toBe('x, y');
  });

  it('reads an amount back with its currency, never doubled', () => {
    const p = payload([[q({ id: 'a', type: 'currency', config: { currency: 'usd' } })]]);
    expect(buildQuestionAnswers(p, { a: '$2,500.00' })[0].value).toBe('USD 2,500.00');
  });

  it('keeps document order across rows', () => {
    const p = payload([[q({ id: 'a' }), q({ id: 'b' })], [q({ id: 'c' })]]);
    expect(buildQuestionAnswers(p, { a: '1', b: '2', c: '3' }).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('is empty for a form with no answers, so nothing is written at all', () => {
    expect(buildQuestionAnswers(payload([[q({ id: 'a' })]]), {})).toEqual([]);
  });
});

describe('bindFormAnswers', () => {
  it('writes nothing at all when no form is published for the type', () => {
    // The path every firm is on today. Nothing extra reaches the row, so the
    // intake is byte for byte the one this surface has always created.
    expect(bindFormAnswers(null, { anything: 'ignored' })).toEqual({
      ok: true,
      questionAnswers: [],
      formVersionId: null,
    });
  });

  it('binds the version and the answers when a form is published', () => {
    const form = {
      versionId: 'v-1',
      payload: payload([[q({ id: 'a', label: 'Counterparty name' })]]),
    };
    expect(bindFormAnswers(form, { a: 'Acme Inc' })).toEqual({
      ok: true,
      questionAnswers: [{ id: 'a', label: 'Counterparty name', value: 'Acme Inc' }],
      formVersionId: 'v-1',
    });
  });

  it('refuses a required question that was left blank', () => {
    const form = {
      versionId: 'v-1',
      payload: payload([[q({ id: 'a', required: true })]]),
    };
    const result = bindFormAnswers(form, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['a']);
  });

  it('names the failed questions in the wording legal published', () => {
    // A question `key` is a slug frozen at publish time, and can be
    // `q_a7f3k2` for a form written in a non-Latin script, or stale wording
    // after a rename. Anything reporting a failure to a human needs the label.
    const form = {
      versionId: 'v-1',
      payload: payload([
        [
          q({ id: 'a', key: 'q_a7f3k2', label: 'Название контрагента', required: true }),
          q({ id: 'b', key: 'ok', label: 'Fine', required: false }),
        ],
        [q({ id: 'c', key: 'q_9dk21x', label: 'Effective date', required: true })],
      ]),
    };
    const result = bindFormAnswers(form, { ok: 'yes' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Document order, and only the questions that actually failed.
      expect(result.errorQuestions).toEqual([
        { key: 'q_a7f3k2', label: 'Название контрагента' },
        { key: 'q_9dk21x', label: 'Effective date' },
      ]);
    }
  });

  it('does not require a question the employee never saw', () => {
    const form = {
      versionId: 'v-1',
      payload: payload([
        [q({ id: 'has', key: 'has', type: 'yesno' })],
        [
          q({
            id: 'who',
            key: 'who',
            required: true,
            showWhen: { questionId: 'has', op: 'eq', value: 'yes' },
          }),
        ],
      ]),
    };
    expect(bindFormAnswers(form, { has: 'no' })).toEqual({
      ok: true,
      questionAnswers: [{ id: 'has', label: 'HAS', value: 'no' }],
      formVersionId: 'v-1',
    });
  });

  it('reads answers off the wire rather than trusting their shape', () => {
    const form = { versionId: 'v-1', payload: payload([[q({ id: 'a' })]]) };
    expect(bindFormAnswers(form, 'not an object')).toEqual({
      ok: true,
      questionAnswers: [],
      formVersionId: 'v-1',
    });
  });
});

describe('matchTypeKeysByLabel', () => {
  const types = FALLBACK_REQUEST_TYPES;
  const first = (
    list: readonly { key: string; label: string }[],
    label: string | null,
  ) => matchTypeKeysByLabel(list, label)[0] ?? null;

  it('finds the type a stored matter_type string was filed under', () => {
    // This is what stops a caller opting out of a published form by simply
    // omitting the request type key. The label is the string every intake
    // already stores in matter_type.
    expect(first(types, 'NDA review')).toBe('nda_review');
    expect(first(types, 'New case / matter')).toBe('new_case_matter');
  });

  it('is not fooled by surrounding space or a change of case', () => {
    expect(first(types, '  nda REVIEW ')).toBe('nda_review');
  });

  it('resolves to nothing when the string matches no type', () => {
    expect(matchTypeKeysByLabel(types, 'NDA reviewX')).toEqual([]);
    expect(matchTypeKeysByLabel(types, '')).toEqual([]);
    expect(matchTypeKeysByLabel(types, null)).toEqual([]);
    expect(matchTypeKeysByLabel([], 'NDA review')).toEqual([]);
  });

  it('returns every type sharing a label, in sort order', () => {
    const dupes = [
      { key: 'first', label: 'Contract review' },
      { key: 'second', label: 'Contract review' },
    ];
    expect(matchTypeKeysByLabel(dupes, 'Contract review')).toEqual(['first', 'second']);
  });

  it('sees through every character that renders as nothing', () => {
    // Each of these renders identically to "NDA review" on every surface that
    // shows matter_type, so matching through them is what stops an intake
    // looking like a filed NDA review while having dodged the form.
    expect(first(types, 'NDA revie\u200Bw')).toBe('nda_review'); // zero width space
    expect(first(types, '\uFEFFNDA\u200D review')).toBe('nda_review'); // BOM, ZWJ
    expect(first(types, 'NDA revie\u2060w')).toBe('nda_review'); // word joiner
    expect(first(types, 'NDA revie\u00ADw')).toBe('nda_review'); // soft hyphen
    expect(first(types, 'NDA revie\u034Fw')).toBe('nda_review'); // grapheme joiner
  });

  it('sees through a decomposed accent and a full-width character', () => {
    // The label is precomposed, the incoming string is decomposed. They look
    // the same and, without normalising, compare unequal.
    const accented = [{ key: 'cafe', label: 'Caf\u00E9 matter' }];
    expect(first(accented, 'Cafe\u0301 matter')).toBe('cafe');
    expect(first(types, '\uFF2EDA review')).toBe('nda_review');
  });
});

describe('resolveRequestTypeKey', () => {
  const types = FALLBACK_REQUEST_TYPES;
  const dupes = [
    { key: 'bare', label: 'Contract review' },
    { key: 'gated', label: 'Contract review' },
  ];
  const published = (...keys: string[]) => (key: string) => keys.includes(key);
  const none = () => false;

  it('takes the only match, whatever the caller asked for', () => {
    // The caller must never be able to redirect the gate to a type with no
    // form by naming one.
    expect(resolveRequestTypeKey(types, 'NDA review', 'other', none)).toBe('nda_review');
    expect(resolveRequestTypeKey(types, 'NDA review', null, none)).toBe('nda_review');
  });

  it('lets the picked type break a tie when that type has a form', () => {
    // Otherwise someone picking the second of two same-named types has their
    // answers validated against the first one's form.
    expect(resolveRequestTypeKey(dupes, 'Contract review', 'gated', published('bare', 'gated')))
      .toBe('gated');
  });

  it('refuses a tie break onto a type with no form, and gates anyway', () => {
    // The dodge this closes: name the bare twin, and the mandatory form on
    // the other one is skipped.
    expect(resolveRequestTypeKey(dupes, 'Contract review', 'bare', published('gated')))
      .toBe('gated');
  });

  it('prefers whichever tied type has a form when the caller named none', () => {
    expect(resolveRequestTypeKey(dupes, 'Contract review', null, published('gated')))
      .toBe('gated');
  });

  it('falls back to the first tied type when none of them has a form', () => {
    expect(resolveRequestTypeKey(dupes, 'Contract review', 'gated', none)).toBe('bare');
  });

  it('resolves to nothing when the label matches no type', () => {
    expect(resolveRequestTypeKey(types, 'Not a type', 'nda_review', none)).toBeNull();
  });
});

describe('isSeededLabel', () => {
  it('is true only while a type still carries its seeded wording', () => {
    expect(isSeededLabel({ key: 'nda_review', label: 'NDA review' })).toBe(true);
    expect(isSeededLabel({ key: 'nda_review', label: 'NDA and similar' })).toBe(false);
    // A firm's own type, and a partner slug, are never seeded wording.
    expect(isSeededLabel({ key: 'nda', label: 'NDA' })).toBe(false);
  });
});

describe('firstErrorFieldId', () => {
  const p = payload([[q({ id: 'a' }), q({ id: 'b' })], [q({ id: 'c' })]]);

  it('names the first errored control in document order, not map order', () => {
    // Errors arrive as an object, whose key order is not the form's order, so
    // focus has to be decided by walking the form.
    expect(firstErrorFieldId(p, { c: 'x', b: 'y' }, 'intake-form')).toBe(
      'intake-form-0-1-b',
    );
  });

  it('is null when nothing is wrong, or when the errors name no question', () => {
    expect(firstErrorFieldId(p, {}, 'intake-form')).toBeNull();
    expect(firstErrorFieldId(p, { nope: 'x' }, 'intake-form')).toBeNull();
  });
});
