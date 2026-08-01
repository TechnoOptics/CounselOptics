import { describe, it, expect } from 'vitest';
import {
  safeRows,
  safePayload,
  domId,
  formatAnswer,
  questionLabel,
} from '../lib/form-render-model';
import { validateAnswers } from '../lib/form-validate';
import type { Question } from '../lib/form-schema';

// The builder hands its draft to the renderer as raw `draft_payload` jsonb,
// typed `unknown` and uncoerced (lib/form-queries.ts, `FormState.draft`), so
// `safeRows` is the only barrier between Postgres and a component that
// destructures `question.config`. These are the shapes it has to survive.

describe('safeRows survives anything the draft path can hand it', () => {
  it('returns no rows for the non-payloads', () => {
    for (const input of [null, undefined, 0, '', 'rows', [], true, {}]) {
      expect(safeRows(input)).toEqual([]);
    }
  });

  it('returns no rows when `rows` is not an array', () => {
    expect(safeRows({ schemaVersion: 1, rows: 'nope' })).toEqual([]);
    expect(safeRows({ schemaVersion: 1, rows: { 0: {} } })).toEqual([]);
    expect(safeRows({ schemaVersion: 1, rows: null })).toEqual([]);
  });

  it('skips a row whose `fields` is not an array, and keeps the rows around it', () => {
    const rows = safeRows({
      rows: [
        { id: 'r1', fields: [{ key: 'a', type: 'short_text', label: 'A' }] },
        { id: 'bad', fields: 'not an array' },
        null,
        'also not a row',
        { id: 'r2', fields: [{ key: 'b', type: 'short_text', label: 'B' }] },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('drops a field that is not an object', () => {
    const rows = safeRows({
      rows: [{ id: 'r1', fields: ['counterparty', 42, null, { key: 'a', type: 'short_text', label: 'A' }] }],
    });
    expect(rows[0].fields.map((f) => f.key)).toEqual(['a']);
  });

  it('drops a field with no key: an answer has nowhere to live without one', () => {
    const rows = safeRows({
      rows: [{ id: 'r1', fields: [{ type: 'short_text', label: 'No key' }, { key: '   ', label: 'Blank' }] }],
    });
    expect(rows).toEqual([]);
  });
});

describe('safeRows repairs what the render depends on', () => {
  it('gives a question with no config an empty one, on every shape that destructures it', () => {
    // The failure this prevents: seven field components read
    // `question.config.{min,max,step,currency,options}`, and `config` is
    // declared non-optional so TypeScript never flags its absence.
    const rows = safeRows({
      rows: [
        {
          id: 'r1',
          fields: [
            { key: 'when', type: 'date', label: 'When' },
            { key: 'amount', type: 'currency', label: 'Amount' },
            { key: 'who', type: 'select', label: 'Who' },
          ],
        },
      ],
    });
    for (const q of rows[0].fields) {
      expect(q.config).toEqual({});
      expect(() => {
        const { min, max, step } = q.config;
        return [min, max, step, q.config.currency, q.config.options];
      }).not.toThrow();
    }
  });

  it('replaces a config that is not an object at all', () => {
    const rows = safeRows({
      rows: [{ id: 'r1', fields: [{ key: 'a', type: 'number', label: 'A', config: 'min=1' }] }],
    });
    expect(rows[0].fields[0].config).toEqual({});
  });

  it('always hands a select an array of options, however they were stored', () => {
    // SelectField and MultiSelectField map over this. A non-array throws.
    const rows = safeRows({
      rows: [
        {
          id: 'r1',
          fields: [
            { key: 'a', type: 'select', label: 'A', config: { options: 'Mutual' } },
            { key: 'b', type: 'multiselect', label: 'B', config: { options: ['Finance', '', null, 7] } },
          ],
        },
      ],
    });
    expect(rows[0].fields[0].config.options).toEqual([]);
    expect(rows[0].fields[1].config.options).toEqual(['Finance', '7']);
  });

  it('drops config values it cannot put in a DOM attribute', () => {
    const rows = safeRows({
      rows: [
        {
          id: 'r1',
          fields: [
            {
              key: 'a',
              type: 'number',
              label: 'A',
              config: { min: { nested: true }, max: 60, step: 'half', currency: 42, maxChars: 120 },
            },
          ],
        },
      ],
    });
    expect(rows[0].fields[0].config).toEqual({ max: 60, maxChars: 120 });
  });

  it('coerces `required` to a real boolean', () => {
    // It reaches the DOM as `aria-required`. A truthy non-boolean would emit
    // aria-required="yes", which is not valid ARIA and announces nothing.
    const rows = safeRows({
      rows: [
        {
          id: 'r1',
          fields: [
            { key: 'a', type: 'short_text', label: 'A', required: 'yes' },
            { key: 'b', type: 'short_text', label: 'B', required: true },
            { key: 'c', type: 'short_text', label: 'C' },
          ],
        },
      ],
    });
    expect(rows[0].fields.map((f) => f.required)).toEqual([false, true, false]);
  });

  it('backfills a missing row id and question id, uniquely', () => {
    // computeVisibilityMap keys on the question id. Two questions sharing one
    // would share a visibility entry, and one could be hidden by a rule that
    // has nothing to do with it.
    const rows = safeRows({
      rows: [
        { fields: [{ key: 'a', type: 'short_text', label: 'A' }, { key: 'b', type: 'short_text', label: 'B' }] },
        { fields: [{ key: 'c', type: 'short_text', label: 'C' }] },
      ],
    });
    const ids = rows.flatMap((r) => r.fields.map((f) => f.id));
    expect(new Set(ids).size).toBe(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('falls back to short_text for a type it does not recognise', () => {
    // Keeps the author's half-written question on screen rather than dropping
    // it, which is the whole reason the draft skips readFormPayload.
    const rows = safeRows({
      rows: [{ id: 'r1', fields: [{ key: 'a', type: 'signature', label: 'Sign here' }, { key: 'b', label: 'No type' }] }],
    });
    expect(rows[0].fields.map((f) => f.type)).toEqual(['short_text', 'short_text']);
  });

  it('keeps a question whose label is not written yet', () => {
    // readFormPayload drops this one, which is precisely the question the
    // author is looking at in the preview.
    const rows = safeRows({ rows: [{ id: 'r1', fields: [{ key: 'a', type: 'short_text' }] }] });
    expect(rows[0].fields[0].label).toBe('');
  });

  it('drops a duplicate key rather than rendering two questions onto one answer', () => {
    const rows = safeRows({
      rows: [
        { id: 'r1', fields: [{ key: 'a', type: 'short_text', label: 'First' }] },
        { id: 'r2', fields: [{ key: 'a', type: 'short_text', label: 'Second' }] },
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['r1']);
    expect(rows[0].fields[0].label).toBe('First');
  });

  it('caps a row at three fields, which is what the grid lays out', () => {
    const rows = safeRows({
      rows: [
        {
          id: 'r1',
          fields: ['a', 'b', 'c', 'd'].map((k) => ({ key: k, type: 'short_text', label: k })),
        },
      ],
    });
    expect(rows[0].fields.map((f) => f.key)).toEqual(['a', 'b', 'c']);
  });

  it('drops a malformed rule rather than letting it hide the question', () => {
    // computeVisibilityMap resolves a rule pointing at nothing to hidden, so a
    // half-written rule would make the author's question disappear.
    const rows = safeRows({
      rows: [
        { id: 'r1', fields: [{ id: 'ctrl', key: 'ctrl', type: 'yesno', label: 'Ctrl' }] },
        {
          id: 'r2',
          fields: [
            { key: 'no_op', type: 'short_text', label: 'A', showWhen: { questionId: 'ctrl' } },
            { key: 'no_value', type: 'short_text', label: 'B', showWhen: { questionId: 'ctrl', op: 'eq' } },
            { key: 'not_object', type: 'short_text', label: 'C', showWhen: 'ctrl == Yes' },
          ],
        },
      ],
    });
    for (const q of rows[1].fields) expect(q.showWhen).toBeUndefined();
  });

  it('keeps a well-formed rule intact', () => {
    const rows = safeRows({
      rows: [
        { id: 'r1', fields: [{ id: 'ctrl', key: 'ctrl', type: 'yesno', label: 'Ctrl' }] },
        {
          id: 'r2',
          fields: [{ key: 'why', type: 'long_text', label: 'Why', showWhen: { questionId: 'ctrl', op: 'eq', value: 'Yes' } }],
        },
      ],
    });
    expect(rows[1].fields[0].showWhen).toEqual({ questionId: 'ctrl', op: 'eq', value: 'Yes' });
  });

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      { rows: [{ fields: [{ key: 'a', config: { options: { 0: 'x' } } }] }] },
      { rows: [{ id: 5, fields: [{ key: 6, type: 7, label: 8, config: 9, showWhen: 10 }] }] },
      { rows: [[]] },
      { rows: [{ fields: [[]] }] },
    ];
    for (const input of nasty) expect(() => safeRows(input)).not.toThrow();
  });
});

describe('safePayload feeds the coerced rows straight to the validator', () => {
  it('a hidden required question in a draft still does not block submission', () => {
    const draft = {
      rows: [
        { id: 'r1', fields: [{ id: 'ctrl', key: 'has_dispute', type: 'yesno', label: 'Dispute?', required: true }] },
        {
          id: 'r2',
          fields: [
            {
              key: 'detail',
              type: 'long_text',
              label: 'What about?',
              required: true,
              showWhen: { questionId: 'ctrl', op: 'eq', value: 'Yes' },
            },
          ],
        },
      ],
    };
    expect(validateAnswers(safePayload(draft), { has_dispute: 'No' }).ok).toBe(true);

    const shown = validateAnswers(safePayload(draft), { has_dispute: 'Yes' });
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.errors.detail).toBeTruthy();
  });

  it('always reports schemaVersion 1', () => {
    expect(safePayload('garbage')).toEqual({ schemaVersion: 1, rows: [] });
  });
});

describe('questionLabel', () => {
  it('uses the author\'s label whenever there is one', () => {
    expect(questionLabel({ label: 'Counterparty name' })).toBe('Counterparty name');
  });

  it('names an unlabelled draft question rather than leaving the input unnamed', () => {
    for (const label of ['', '   ', undefined as never]) {
      expect(questionLabel({ label })).toBe('Untitled question');
    }
  });
});

describe('domId', () => {
  it('replaces the characters a DOM id may not carry', () => {
    expect(domId('form', 'client email', 0, 1)).toBe('form-0-1-client-email');
    expect(domId('form', 'a.b/c d', 2, 0)).toBe('form-2-0-a-b-c-d');
  });

  it('separates two keys that slug to the same string', () => {
    // Without the position these collide, and a colliding id binds a label to
    // the wrong control and merges two yesno questions into one radio group.
    expect(domId('form', 'client email', 0, 0)).not.toBe(domId('form', 'client-email', 0, 1));
  });

  it('separates two forms on one page', () => {
    expect(domId('form', 'a', 0, 0)).not.toBe(domId('ro', 'a', 0, 0));
  });
});

describe('formatAnswer', () => {
  const q = (type: Question['type'], config: Question['config'] = {}): Question => ({
    id: 'q',
    key: 'q',
    type,
    label: 'Q',
    required: false,
    config,
  });

  it('reads an unanswered question as empty, so the caller can say so', () => {
    expect(formatAnswer(q('short_text'), undefined)).toBe('');
    expect(formatAnswer(q('short_text'), '')).toBe('');
    expect(formatAnswer(q('multiselect'), [])).toBe('');
  });

  it('joins a multiselect in the order it was stored', () => {
    expect(formatAnswer(q('multiselect'), ['Finance', 'Security'])).toBe('Finance, Security');
  });

  it('prefixes the currency code without doubling the marker up', () => {
    const money = q('currency', { currency: 'usd' });
    expect(formatAnswer(money, '$2,500.00')).toBe('USD 2,500.00');
    expect(formatAnswer(money, '2500')).toBe('USD 2500');
    expect(formatAnswer(money, ' $ 40 ')).toBe('USD 40');
  });

  it('defaults the currency code when the question carries none', () => {
    expect(formatAnswer(q('currency'), '10.00')).toBe('USD 10.00');
    // `config` absent entirely, the state safeRows repairs but this survives too.
    expect(formatAnswer({ ...q('currency'), config: undefined as never }, '10.00')).toBe('USD 10.00');
  });

  it('leaves every other type alone', () => {
    expect(formatAnswer(q('short_text'), 'Northwind Trading Ltd')).toBe('Northwind Trading Ltd');
    expect(formatAnswer(q('date'), '2026-08-01')).toBe('2026-08-01');
  });
});
