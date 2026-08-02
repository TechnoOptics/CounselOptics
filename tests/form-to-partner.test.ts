import { describe, it, expect } from 'vitest';
import {
  bindPartnerFormAnswers,
  partnerFormBinding,
  projectToPartnerQuestions,
} from '../lib/form-to-partner';
import { QUESTION_TYPES, type FormPayload, type Question } from '../lib/form-schema';

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

// ---------------------------------------------------------------------------
// Arrival: what the partner API does with a ticket once a form is published.
// ---------------------------------------------------------------------------

const VERSION = '11111111-1111-4111-8111-111111111111';
const OTHER_VERSION = '22222222-2222-4222-8222-222222222222';

function field(over: Partial<Question> & { key: string }): Question {
  return {
    id: over.id ?? over.key,
    key: over.key,
    type: over.type ?? 'short_text',
    label: over.label ?? over.key,
    required: over.required ?? false,
    config: over.config ?? {},
    ...(over.showWhen ? { showWhen: over.showWhen } : {}),
  };
}

function form(fields: Question[]): { payload: FormPayload; versionId: string } {
  return {
    payload: { schemaVersion: 1, rows: [{ id: 'r1', fields }] },
    versionId: VERSION,
  };
}

const AMOUNT = form([
  field({ key: 'amount', type: 'currency', label: 'Contract value', config: { currency: 'USD' } }),
]);

describe('partnerFormBinding', () => {
  it('returns null when nothing is published, which is every firm today', () => {
    expect(partnerFormBinding(null, VERSION, { amount: '1' })).toBeNull();
  });

  it('treats an echoed current version as proof the partner rendered this form', () => {
    const b = partnerFormBinding(AMOUNT, VERSION, {});
    expect(b?.source).toBe('echoed');
    expect(b?.governs).toBe(true);
  });

  it('governs without an echo when the answers are keyed to the form', () => {
    const b = partnerFormBinding(AMOUNT, null, { amount: '10.00' });
    expect(b?.source).toBe('inferred');
    expect(b?.governs).toBe(true);
  });

  it('does not govern a ticket that shows no sign of having seen the form', () => {
    const b = partnerFormBinding(AMOUNT, null, { 'q-legacy': 'Sales' });
    expect(b?.source).toBe('inferred');
    expect(b?.governs).toBe(false);
    expect(b?.versionId).toBe(VERSION);
  });

  it('never binds a version id the ticket supplied', () => {
    const b = partnerFormBinding(AMOUNT, OTHER_VERSION, { amount: '10.00' });
    expect(b?.versionId).toBe(VERSION);
    expect(b?.source).toBe('inferred');
  });

  it('ignores a non-string echoed version id', () => {
    expect(partnerFormBinding(AMOUNT, { id: VERSION }, {})?.source).toBe('inferred');
    expect(partnerFormBinding(AMOUNT, 7, {})?.source).toBe('inferred');
  });
});

describe('bindPartnerFormAnswers', () => {
  it('enforces a constraint the projection could not carry, naming the question', () => {
    const out = bindPartnerFormAnswers(AMOUNT, { amount: '10.005' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain('Contract value');
    expect(out.error).toContain('amount');
    expect(out.error).toContain('two decimal places');
  });

  it('accepts a value the real payload allows, formatted as the portal stores it', () => {
    const out = bindPartnerFormAnswers(AMOUNT, { amount: '$2,500.00' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.list).toEqual([{ id: 'amount', label: 'Contract value', value: 'USD 2,500.00' }]);
  });

  it('enforces a number range the projection flattened to text', () => {
    const f = form([field({ key: 'count', type: 'number', label: 'How many', config: { min: 1, max: 5 } })]);
    expect(bindPartnerFormAnswers(f, { count: '9' }).ok).toBe(false);
    expect(bindPartnerFormAnswers(f, { count: '3' }).ok).toBe(true);
  });

  it('enforces a max length the projection flattened to text', () => {
    const f = form([field({ key: 'ref', label: 'Reference', config: { maxChars: 4 } })]);
    expect(bindPartnerFormAnswers(f, { ref: 'abcde' }).ok).toBe(false);
  });

  it('leaves a conditional question alone when its controller was never answered', () => {
    const f = form([
      field({ key: 'signed', type: 'yesno', label: 'Already signed?' }),
      field({
        key: 'who', label: 'Who signed it', required: true,
        showWhen: { questionId: 'signed', op: 'eq', value: 'Yes' },
      }),
    ]);
    // The controller is absent from what the partner sent, so the conditional
    // is not visible and cannot be required.
    expect(bindPartnerFormAnswers(f, { other: 'x' }).ok).toBe(true);
  });

  it('requires a conditional question once its controller reveals it', () => {
    const f = form([
      field({ key: 'signed', type: 'yesno', label: 'Already signed?' }),
      field({
        key: 'who', label: 'Who signed it', required: true,
        showWhen: { questionId: 'signed', op: 'eq', value: 'Yes' },
      }),
    ]);
    const out = bindPartnerFormAnswers(f, { signed: 'Yes' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain('Who signed it');
    expect(out.error).toContain('who');
  });

  it('reports the first failure in document order and counts the rest', () => {
    const f = form([
      field({ key: 'a', label: 'First', required: true }),
      field({ key: 'b', label: 'Second', required: true }),
      field({ key: 'c', label: 'Third', required: true }),
    ]);
    const out = bindPartnerFormAnswers(f, {});
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain('First');
    expect(out.error).toContain('2 other answers');
    expect(out.error).not.toContain('Third');
  });

  it('drops an answer to a question the employee never saw', () => {
    const f = form([
      field({ key: 'signed', type: 'yesno', label: 'Already signed?' }),
      field({
        key: 'who', label: 'Who signed it',
        showWhen: { questionId: 'signed', op: 'eq', value: 'Yes' },
      }),
    ]);
    const out = bindPartnerFormAnswers(f, { signed: 'No', who: 'stale' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.list.map((a) => a.id)).toEqual(['signed']);
  });

  it('ignores an answer value that is not a string', () => {
    const out = bindPartnerFormAnswers(AMOUNT, { amount: { toString: 'no' } } as unknown);
    expect(out.ok).toBe(true);
  });
});
