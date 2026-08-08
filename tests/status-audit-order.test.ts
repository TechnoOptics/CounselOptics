import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The audit chain may only ever record a transition that happened.
 *
 * `setCaseStatusAction` called `updateCaseStatus` and then wrote
 * `case_status_changed`. While that write could return cleanly having matched
 * zero rows (see tests/status-write-honesty.test.ts), the entry described an
 * attempt, not an event. On this product the chain is evidence about a legal
 * matter, and a reader has no way to tell the two apart, so a false entry is
 * worse than a UI that lies: the interface corrects itself on the next read
 * and the record does not.
 *
 * The write now refuses when nothing was written, which is what makes the
 * ordering enforceable. This pins the ordering itself.
 *
 * Mutation: move the `logCaseEvent` call above `await updateCaseStatus`, or
 * wrap the write in a try/catch that lets the action carry on. Either turns
 * "records nothing when the write did not land" red, and the second assertion
 * catches a reorder on the success path too.
 */

const a = vi.hoisted(() => ({
  /** Every side effect, in the order it happened. */
  calls: [] as string[],
  /** Set true to make the status write behave as a refused one. */
  writeFails: { value: false },
}));

vi.mock('../lib/activity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logCaseEvent: async (input: { eventType: string }) => {
    a.calls.push(`log:${input.eventType}`);
  },
}));

vi.mock('../lib/storage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usingSupabase: () => true,
    getCase: async () => ({ id: 'case-1', status: 'open' }),
    updateCaseStatus: async () => {
      a.calls.push('write');
      if (a.writeFails.value) {
        throw new Error('That change could not be saved.');
      }
    },
  };
});

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => ({}),
  isCurrentUserAdmin: async () => false,
  requireUser: async () => ({ id: 'user-1' }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { setCaseStatusAction } = await import('../lib/actions');

describe('setCaseStatusAction', () => {
  beforeEach(() => {
    a.calls.length = 0;
    a.writeFails.value = false;
  });

  it('records nothing when the write did not land', async () => {
    a.writeFails.value = true;
    await expect(setCaseStatusAction('case-1', 'closed')).rejects.toThrow();
    // The defect, in one assertion: a refused transition leaves no
    // `case_status_changed` behind claiming it happened.
    expect(a.calls).toEqual(['write']);
  });

  it('records the transition once the write has landed', async () => {
    await setCaseStatusAction('case-1', 'closed');
    expect(a.calls).toEqual(['write', 'log:case_status_changed']);
  });
});
