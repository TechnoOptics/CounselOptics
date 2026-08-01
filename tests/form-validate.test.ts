import { describe, it, expect } from 'vitest';
import { validateAnswers, isQuestionVisible } from '../lib/form-validate';
import type { FormPayload, Question } from '../lib/form-schema';

const form: FormPayload = {
  schemaVersion: 1,
  rows: [
    { id: 'r1', fields: [
      { id: 'a', key: 'has_counterparty', type: 'yesno', label: 'Is there a counterparty?',
        required: true, config: {} },
    ] },
    { id: 'r2', fields: [
      { id: 'b', key: 'counterparty', type: 'short_text', label: 'Counterparty name',
        required: true, config: {}, showWhen: { questionId: 'a', op: 'eq', value: 'Yes' } },
    ] },
    { id: 'r3', fields: [
      { id: 'c', key: 'value', type: 'currency', label: 'Contract value',
        required: false, config: { currency: 'USD', min: 0 } },
      { id: 'd', key: 'summary', type: 'long_text', label: 'Summary',
        required: false, config: { maxWords: 5 } },
      { id: 'e', key: 'term', type: 'number', label: 'Term in months',
        required: false, config: { min: 1, max: 60 } },
    ] },
  ],
};

describe('a hidden question is not required', () => {
  it('submits cleanly when the controlling answer hides a required question', () => {
    const r = validateAnswers(form, { has_counterparty: 'No' });
    expect(r.ok).toBe(true);
  });

  it('requires it once the controlling answer reveals it', () => {
    const r = validateAnswers(form, { has_counterparty: 'Yes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.counterparty).toBeTruthy();
  });

  it('accepts it when revealed and answered', () => {
    const r = validateAnswers(form, { has_counterparty: 'Yes', counterparty: 'Acme' });
    expect(r.ok).toBe(true);
  });
});

describe('isQuestionVisible', () => {
  const q = (id: string) => form.rows.flatMap((r) => r.fields).find((f) => f.id === id)!;

  it('eq matches and does not match', () => {
    expect(isQuestionVisible(q('b'), form, { has_counterparty: 'Yes' })).toBe(true);
    expect(isQuestionVisible(q('b'), form, { has_counterparty: 'No' })).toBe(false);
  });

  it('treats an unanswered controller as not matching', () => {
    expect(isQuestionVisible(q('b'), form, {})).toBe(false);
  });

  it('neq also treats an unanswered controller as not matching', () => {
    // A field is not part of `form`; it exists only to exercise the neq
    // branch directly, since none of the fixture's own rules use neq.
    const neqField: Question = {
      id: 'x', key: 'x_key', type: 'short_text', label: 'X',
      required: false, config: {}, showWhen: { questionId: 'a', op: 'neq', value: 'Yes' },
    };
    expect(isQuestionVisible(neqField, form, {})).toBe(false);
  });

  it('a question with no rule is always visible', () => {
    expect(isQuestionVisible(q('a'), form, {})).toBe(true);
  });
});

describe('visibility cascades through a hidden controller', () => {
  // A three-level chain: chain_b is shown only when chain_a is Yes, and
  // chain_c is shown only when chain_b is Yes. chain_c's controller is
  // itself a conditional question, so this exercises whether hiding
  // chain_b also hides chain_c, rather than trusting chain_b's raw answer.
  const chainForm: FormPayload = {
    schemaVersion: 1,
    rows: [
      { id: 'cr1', fields: [
        { id: 'ca', key: 'chain_a', type: 'yesno', label: 'A', required: true, config: {} },
      ] },
      { id: 'cr2', fields: [
        { id: 'cb', key: 'chain_b', type: 'yesno', label: 'B', required: true, config: {},
          showWhen: { questionId: 'ca', op: 'eq', value: 'Yes' } },
      ] },
      { id: 'cr3', fields: [
        { id: 'cc', key: 'chain_c', type: 'short_text', label: 'C', required: true, config: {},
          showWhen: { questionId: 'cb', op: 'eq', value: 'Yes' } },
      ] },
    ],
  };
  const c = () => chainForm.rows[2].fields[0];

  it('hides and un-requires the third question when its controller is hidden, even with a stale answer', () => {
    // chain_a is No, so chain_b is hidden, but answers still carries a
    // stale chain_b: 'Yes' as if the client never scrubbed it (or a
    // replayed/edited payload restored it).
    const answers = { chain_a: 'No', chain_b: 'Yes' };

    expect(isQuestionVisible(c(), chainForm, answers)).toBe(false);

    const r = validateAnswers(chainForm, answers);
    expect(r.ok).toBe(true);
  });

  it('reveals and enforces the third question normally once its controller is genuinely visible', () => {
    const revealed = { chain_a: 'Yes', chain_b: 'Yes' };

    expect(isQuestionVisible(c(), chainForm, revealed)).toBe(true);

    const missing = validateAnswers(chainForm, revealed);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.chain_c).toBeTruthy();

    const complete = validateAnswers(chainForm, { ...revealed, chain_c: 'done' });
    expect(complete.ok).toBe(true);
  });
});

describe('per type constraints', () => {
  const base = { has_counterparty: 'No' };

  it('enforces maxWords on long text', () => {
    const r = validateAnswers(form, { ...base, summary: 'one two three four five six' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.summary).toMatch(/5 words/);
  });

  it('accepts long text at the limit', () => {
    expect(validateAnswers(form, { ...base, summary: 'one two three four five' }).ok).toBe(true);
  });

  it('enforces number min and max', () => {
    expect(validateAnswers(form, { ...base, term: '0' }).ok).toBe(false);
    expect(validateAnswers(form, { ...base, term: '61' }).ok).toBe(false);
    expect(validateAnswers(form, { ...base, term: '12' }).ok).toBe(true);
  });

  it('rejects a non-numeric number', () => {
    expect(validateAnswers(form, { ...base, term: 'twelve' }).ok).toBe(false);
  });

  it('rejects negative currency when min is zero', () => {
    expect(validateAnswers(form, { ...base, value: '-5' }).ok).toBe(false);
  });

  it('rejects sub-cent currency rather than rounding it silently', () => {
    expect(validateAnswers(form, { ...base, value: '1.005' }).ok).toBe(false);
  });
});
