import { describe, it, expect } from 'vitest';
import { projectToPartnerQuestions } from '../lib/form-to-partner';
import { QUESTION_TYPES, type FormPayload } from '../lib/form-schema';

const one = (over: Record<string, unknown>): FormPayload => ({
  schemaVersion: 1,
  rows: [{ id: 'r1', fields: [{
    id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {}, ...over,
  } as never] }],
});

describe('projectToPartnerQuestions', () => {
  it('flattens rows into one ordered list', () => {
    const out = projectToPartnerQuestions({ schemaVersion: 1, rows: [
      { id: 'r1', fields: [
        { id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {} },
        { id: 'b', key: 'b', type: 'short_text', label: 'B', required: false, config: {} },
      ] },
      { id: 'r2', fields: [
        { id: 'c', key: 'c', type: 'short_text', label: 'C', required: false, config: {} },
      ] },
    ] });
    expect(out.map((q) => q.label)).toEqual(['A', 'B', 'C']);
  });

  it('emits a conditional question unconditionally and never required', () => {
    const out = projectToPartnerQuestions({ schemaVersion: 1, rows: [
      { id: 'r1', fields: [
        { id: 'a', key: 'a', type: 'yesno', label: 'A', required: true, config: {} },
      ] },
      { id: 'r2', fields: [
        { id: 'b', key: 'b', type: 'short_text', label: 'B', required: true, config: {},
          showWhen: { questionId: 'a', op: 'eq', value: 'Yes' } },
      ] },
    ] });
    expect(out).toHaveLength(2);
    expect(out[1].required).toBe(false);
  });

  it('maps multiselect to select and keeps its options', () => {
    const out = projectToPartnerQuestions(one({
      type: 'multiselect', config: { options: ['X', 'Y'] },
    }));
    expect(out[0].type).toBe('select');
    expect(out[0].options).toEqual(['X', 'Y']);
  });

  it('maps yesno to yesno and select to select', () => {
    expect(projectToPartnerQuestions(one({ type: 'yesno', config: {} }))[0].type).toBe('yesno');
    expect(projectToPartnerQuestions(one({
      type: 'select', config: { options: ['X'] },
    }))[0].type).toBe('select');
  });

  it('maps every other type to text', () => {
    for (const t of QUESTION_TYPES) {
      if (t === 'yesno' || t === 'select' || t === 'multiselect') continue;
      const cfg = t === 'currency' ? { currency: 'USD' } : {};
      expect(projectToPartnerQuestions(one({ type: t, config: cfg }))[0].type).toBe('text');
    }
  });

  it('produces a type every partner app understands, for every question type', () => {
    const allowed = new Set(['text', 'select', 'yesno']);
    for (const t of QUESTION_TYPES) {
      const cfg = t === 'select' || t === 'multiselect'
        ? { options: ['X'] } : t === 'currency' ? { currency: 'USD' } : {};
      expect(allowed.has(projectToPartnerQuestions(one({ type: t, config: cfg }))[0].type)).toBe(true);
    }
  });

  it('uses the question key as the partner id, so answers can be matched back', () => {
    expect(projectToPartnerQuestions(one({ key: 'counterparty' }))[0].id).toBe('counterparty');
  });
});
