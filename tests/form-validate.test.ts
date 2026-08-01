import { describe, it, expect } from 'vitest';
import { validateAnswers, isQuestionVisible } from '../lib/form-validate';
import type { FormPayload } from '../lib/form-schema';

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

  it('a question with no rule is always visible', () => {
    expect(isQuestionVisible(q('a'), form, {})).toBe(true);
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
