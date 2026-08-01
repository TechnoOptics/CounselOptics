import { describe, it, expect } from 'vitest';
import { validateFormPayload } from '../lib/form-schema';
import { nextVersionNumber } from '../lib/form-queries';

/**
 * These cover the publish GATE, not `publishFormAction` itself. The action
 * needs a database, so its round trip is covered by the manual verification
 * in Task 10.
 *
 * What is pinned here is the invariant that publish refuses exactly what the
 * builder refuses, because both call `validateFormPayload`. If publish ever
 * grows a validator of its own, a form that the builder shows as clean could
 * be rejected on publish, or worse, an invalid one could be published.
 */
describe('publish gate', () => {
  it('refuses a payload that fails validation', () => {
    const bad = { schemaVersion: 1, rows: [{ id: 'r1', fields: [] }] };
    expect(validateFormPayload(bad).ok).toBe(false);
  });

  it('accepts a payload that passes', () => {
    const good = { schemaVersion: 1, rows: [{ id: 'r1', fields: [{
      id: 'a', key: 'a', type: 'short_text', label: 'A', required: false, config: {},
    }] }] };
    expect(validateFormPayload(good).ok).toBe(true);
  });

  it('reports every problem with the field that caused it, so publish can return them unchanged', () => {
    const result = validateFormPayload({
      schemaVersion: 1,
      rows: [
        { id: 'r1', fields: [{ id: 'a', key: 'a', type: 'select', label: 'A', required: false, config: {} }] },
        { id: 'r2', fields: [{ id: 'b', key: 'b', type: 'short_text', label: '', required: false, config: {} }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Both problems in one pass, each carrying the question id the builder
    // scrolls to. Publish passes this array straight back to the dialog.
    expect(result.errors.map((e) => e.questionId).sort()).toEqual(['a', 'b']);
  });
});

/**
 * Version numbering is pure so it can be pinned without a database. A version
 * is immutable once written, so the only way this can go wrong is by reusing
 * a number, which the unique (form_id, version) index would reject.
 */
describe('nextVersionNumber', () => {
  it('starts at 1 for a form that has never been published', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber(null)).toBe(1);
  });

  it('is one past the highest version stored, whatever order the rows arrive in', () => {
    expect(nextVersionNumber([{ version: 3 }])).toBe(4);
    expect(nextVersionNumber([{ version: 1 }, { version: 7 }, { version: 4 }])).toBe(8);
  });

  it('ignores rows whose version is not a usable number', () => {
    expect(nextVersionNumber([{ version: Number.NaN }, { version: 2 }])).toBe(3);
    expect(nextVersionNumber([{ version: -5 }])).toBe(1);
  });
});
