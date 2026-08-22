import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Clearing the account of what happened empties the text and nothing else.
 *
 * "Delete my composition" is a request to remove some words the person wrote.
 * It is not a request to remove their case, their exhibits, their reviews, or
 * their collaborators, and on this product those are the record of a legal
 * matter. So this drives the real `updateCaseComposition` against a
 * postgrest-shaped fake and asserts what it did to the database, rather than
 * reading the source and hoping.
 *
 * It also pins the reason the earlier text cannot be lost: `description` and
 * `description_history` go out in ONE update statement. A future edit that
 * split them into two writes would let the new text land while the old text
 * did not.
 *
 * Mutations this is meant to catch:
 *   - write only `description` -> "keeps the words it replaced" goes red.
 *   - add a `.delete()` on any table -> "deletes nothing" goes red.
 *   - drop `.select('id')` or the zero-row throw -> the honesty tests go red.
 */

type Call = {
  table: string;
  op: 'select' | 'update' | 'delete' | 'insert';
  payload?: Record<string, unknown>;
};

const h = vi.hoisted(() => {
  const rec: {
    calls: Call[];
    /** Rows the fake reports the UPDATE as having written. */
    rows: Array<{ id: string }>;
    /** Row the initial read-back returns. */
    current: { description: string | null; description_history?: unknown } | null;
    /** Error the fake returns from the UPDATE, e.g. a missing column. */
    updateError: { code?: string; message?: string } | null;
    selectedAfterUpdate: boolean;
  } = {
    calls: [],
    rows: [{ id: 'case-1' }],
    current: { description: 'He arrived at 9pm.', description_history: [] },
    updateError: null,
    selectedAfterUpdate: false,
  };

  function makeClient() {
    return {
      from(table: string) {
        return {
          select(_cols: string) {
            rec.calls.push({ table, op: 'select' });
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: rec.current, error: null }),
              }),
            };
          },
          update(payload: Record<string, unknown>) {
            rec.calls.push({ table, op: 'update', payload });
            const builder = (): Record<string, unknown> => ({
              eq: () => builder(),
              select: () => {
                rec.selectedAfterUpdate = true;
                return Promise.resolve({
                  data: rec.updateError ? null : rec.rows,
                  error: rec.updateError,
                });
              },
              then: (resolve: (v: unknown) => unknown) =>
                resolve({ data: null, error: rec.updateError }),
            });
            return builder();
          },
          delete() {
            rec.calls.push({ table, op: 'delete' });
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
          insert(payload: Record<string, unknown>) {
            rec.calls.push({ table, op: 'insert', payload });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  return { rec, makeClient };
});

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => h.makeClient(),
  requireUser: async () => ({ id: 'user-1' }),
}));

const { updateCaseComposition, COMPOSITION_HISTORY_UNAVAILABLE } =
  await import('../lib/storage');

beforeEach(() => {
  h.rec.calls = [];
  h.rec.rows = [{ id: 'case-1' }];
  h.rec.current = { description: 'He arrived at 9pm.', description_history: [] };
  h.rec.updateError = null;
  h.rec.selectedAfterUpdate = false;
});

const updates = () => h.rec.calls.filter((c) => c.op === 'update');

describe('clearing the account', () => {
  it('deletes nothing, on any table', async () => {
    await updateCaseComposition({ caseId: 'case-1', text: '' });
    expect(h.rec.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
  });

  it('touches only the cases table, never exhibits or reviews or collaborators', async () => {
    await updateCaseComposition({ caseId: 'case-1', text: '' });
    const tables = new Set(h.rec.calls.map((c) => c.table));
    expect([...tables]).toEqual(['cases']);
    for (const t of ['exhibits', 'ai_reviews', 'case_collaborators', 'audit_events']) {
      expect(tables.has(t)).toBe(false);
    }
  });

  it('changes only the account, its history, and the updated timestamp', async () => {
    await updateCaseComposition({ caseId: 'case-1', text: '' });
    expect(updates()).toHaveLength(1);
    expect(Object.keys(updates()[0].payload ?? {}).sort()).toEqual([
      'description',
      'description_history',
      'updated_at',
    ]);
    // Nothing here can set a status, a title, or an owner.
    expect(updates()[0].payload).not.toHaveProperty('status');
    expect(updates()[0].payload).not.toHaveProperty('user_id');
  });

  it('keeps the words it cleared', async () => {
    await updateCaseComposition({ caseId: 'case-1', text: '' });
    const payload = updates()[0].payload as Record<string, unknown>;
    expect(payload.description).toBe('');
    expect(payload.description_history).toEqual([
      { text: 'He arrived at 9pm.', replacedAt: expect.any(String) },
    ]);
  });
});

describe('rewriting the account', () => {
  it('sends the new text and the text it replaced in one statement', async () => {
    // One statement is the whole guarantee. Two would let the new text land
    // while the old text did not.
    await updateCaseComposition({ caseId: 'case-1', text: 'He arrived at 10pm.' });
    expect(updates()).toHaveLength(1);
    const payload = updates()[0].payload as Record<string, unknown>;
    expect(payload.description).toBe('He arrived at 10pm.');
    expect(payload.description_history).toEqual([
      { text: 'He arrived at 9pm.', replacedAt: expect.any(String) },
    ]);
  });

  it('appends to a history that already has versions in it', async () => {
    h.rec.current = {
      description: 'second account',
      description_history: [{ text: 'first account', replacedAt: '2026-07-01T00:00:00.000Z' }],
    };
    await updateCaseComposition({ caseId: 'case-1', text: 'third account' });
    const history = (updates()[0].payload as Record<string, unknown>)
      .description_history as Array<{ text: string }>;
    expect(history.map((x) => x.text)).toEqual(['first account', 'second account']);
  });

  it('asks the database which rows it wrote', async () => {
    await updateCaseComposition({ caseId: 'case-1', text: 'new' });
    expect(h.rec.selectedAfterUpdate).toBe(true);
  });

  it('refuses when the update matched no row', async () => {
    // `cases_update_own` is owner-only while `cases` SELECT is
    // membership-wide, so a collaborator is exactly the caller who writes
    // nothing here and must not be told their edit was saved.
    h.rec.rows = [];
    await expect(
      updateCaseComposition({ caseId: 'case-1', text: 'new' }),
    ).rejects.toThrow();
  });
});

describe('before the migration is applied', () => {
  it('refuses rather than writing the new text without the old', async () => {
    h.rec.updateError = { code: '42703', message: 'column "description_history" does not exist' };
    await expect(
      updateCaseComposition({ caseId: 'case-1', text: 'new' }),
    ).rejects.toThrow(COMPOSITION_HISTORY_UNAVAILABLE);
  });

  it('says so calmly, without naming a column at the person', async () => {
    h.rec.updateError = { code: 'PGRST204', message: "Could not find the 'description_history' column" };
    await expect(
      updateCaseComposition({ caseId: 'case-1', text: 'new' }),
    ).rejects.toThrow(/untouched/);
    expect(COMPOSITION_HISTORY_UNAVAILABLE).not.toMatch(/description_history|migration|column/);
  });
});
