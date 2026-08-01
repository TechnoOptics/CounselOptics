import { describe, it, expect } from 'vitest';
import { validateFormPayload, readFormPayload, EMPTY_PAYLOAD } from '../lib/form-schema';

const q = (over: Record<string, unknown> = {}) => ({
  id: 'q1', key: 'counterparty', type: 'short_text',
  label: 'Counterparty name', required: false, config: {}, ...over,
});
const payload = (rows: unknown[]) => ({ schemaVersion: 1, rows });

describe('validateFormPayload', () => {
  it('accepts a minimal valid payload', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [q()] }]));
    expect(r.ok).toBe(true);
  });

  it('rejects a row with more than three fields', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [
      q({ id: 'a', key: 'a' }), q({ id: 'b', key: 'b' }),
      q({ id: 'c', key: 'c' }), q({ id: 'd', key: 'd' }),
    ] }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /one to three/i.test(e.message))).toBe(true);
  });

  it('rejects an empty row', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [] }]));
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate question keys', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'same' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'same' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /unique/i.test(e.message))).toBe(true);
  });

  it('rejects a rule that references a later question', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a', showWhen: { questionId: 'b', op: 'eq', value: 'Yes' } })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /earlier/i.test(e.message))).toBe(true);
  });

  it('rejects a rule referencing a question that does not exist', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ showWhen: { questionId: 'nope', op: 'eq', value: 'Yes' } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('rejects eq without a value', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b', showWhen: { questionId: 'a', op: 'eq' } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('accepts answered without a value', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]));
    expect(r.ok).toBe(true);
  });

  it('rejects a select with no options', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ type: 'select', config: { options: [] } })] },
    ]));
    expect(r.ok).toBe(false);
  });

  it('rejects an empty label', () => {
    const r = validateFormPayload(payload([{ id: 'r1', fields: [q({ label: '  ' })] }]));
    expect(r.ok).toBe(false);
  });

  it('reports every problem, not just the first', () => {
    const r = validateFormPayload(payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'dup', label: '' })] },
      { id: 'r2', fields: [q({ id: 'b', key: 'dup' })] },
    ]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(1);
  });
});

describe('readFormPayload', () => {
  it('returns an empty payload for junk rather than throwing', () => {
    expect(readFormPayload(null)).toEqual(EMPTY_PAYLOAD);
    expect(readFormPayload('nonsense')).toEqual(EMPTY_PAYLOAD);
    expect(readFormPayload({ rows: 'no' })).toEqual(EMPTY_PAYLOAD);
  });

  it('drops invalid fields but keeps valid ones', () => {
    const out = readFormPayload(payload([
      { id: 'r1', fields: [q(), { id: 'x', label: '' }] },
    ]));
    expect(out.rows[0].fields).toHaveLength(1);
  });
});
