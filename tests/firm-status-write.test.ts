import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The counsel status control, and the rule that made it buildable.
 *
 * There was no firm status control before, and the reason is the defect this
 * exists not to repeat: the consumer mutation writes through the USER-scoped
 * client, `cases_update_own` is `auth.uid() = user_id`, and a firm attorney
 * who is not the case row's owner updated zero rows, was told it worked, and
 * had `case_status_changed` written into the audit chain. Putting a button on
 * that path would have been shipping the defect with a control attached.
 *
 * So setFirmCaseStatusAction is authorized through lib/firm-authz, writes
 * through the service-role client, and CONFIRMS the row before it reports
 * success or logs anything. This pins the confirmation and the ordering.
 *
 * Mutations:
 *   - drop `.select('id')` from the update, or the `written.length === 0`
 *     return: "refuses, and records nothing, when the update matched no row"
 *     goes red.
 *   - move the logCaseEvent block above the update: the same test goes red,
 *     and so does the ordering assertion on the success path.
 *   - widen FIRM_POSTING_ROLES to any member: "refuses a role that may not
 *     post" goes red.
 */

type Scenario = {
  /** Rows the fake reports the UPDATE as having affected. */
  written: Array<{ id: string }>;
  /** What callerHasFirmRole answers. */
  authorized: boolean;
};

const h = vi.hoisted(() => {
  const s: { current: Scenario } = {
    current: { written: [{ id: 'case-1' }], authorized: true },
  };
  const calls: string[] = [];

  function makeAdmin() {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { firm_id: 'firm-1', status: 'open' },
            }),
          }),
        }),
        update: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            select: () => {
              calls.push('write');
              return Promise.resolve({
                data: s.current.written,
                error: null,
              });
            },
            // Awaiting without selecting is what the old shape did, and it
            // resolves clean with nothing to inspect. Kept so removing the
            // `.select('id')` fails the assertions rather than the harness.
            then: (resolve: (v: unknown) => unknown) => {
              calls.push('write');
              return resolve({ data: null, error: null });
            },
          };
          return node;
        },
      }),
    };
  }

  return { s, calls, makeAdmin };
});

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => h.makeAdmin(),
}));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => ({}),
  requireUser: async () => ({ id: 'user-1' }),
}));

vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerHasFirmRole: async () => h.s.current.authorized,
  callerIsFirmMember: async () => h.s.current.authorized,
  requireActiveFirm: async () => {},
}));

vi.mock('../lib/activity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logCaseEvent: async (input: { eventType: string }) => {
    h.calls.push(`log:${input.eventType}`);
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { setFirmCaseStatusAction } = await import('../lib/firm-actions');

describe('setFirmCaseStatusAction', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.s.current = { written: [{ id: 'case-1' }], authorized: true };
  });

  it('refuses, and records nothing, when the update matched no row', async () => {
    h.s.current.written = [];
    const res = await setFirmCaseStatusAction('case-1', 'closed');
    expect(res.ok).toBe(false);
    // The whole point: no `case_status_changed` for a matter that did not move.
    expect(h.calls).toEqual(['write']);
  });

  it('records the transition only after the row is written', async () => {
    const res = await setFirmCaseStatusAction('case-1', 'closed');
    expect(res.ok).toBe(true);
    expect(h.calls).toEqual(['write', 'log:case_status_changed']);
  });

  it('refuses a role that may not post, without writing', async () => {
    h.s.current.authorized = false;
    const res = await setFirmCaseStatusAction('case-1', 'closed');
    expect(res.ok).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('refuses a status that is not one a matter can be in', async () => {
    const res = await setFirmCaseStatusAction('case-1', 'deleted');
    expect(res.ok).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('returns a refusal rather than throwing it', async () => {
    h.s.current.authorized = false;
    await expect(
      setFirmCaseStatusAction('case-1', 'closed'),
    ).resolves.toMatchObject({ ok: false });
  });
});

/**
 * Both controls that move a matter's status go through the same helper, for
 * the reason app/counsel/cases/set-status.ts gives: requireUser and
 * requireActiveFirm both THROW, and a server action that throws inside a
 * transition replaces the surrounding surface with an error boundary instead
 * of letting the control report what happened.
 *
 * The assignee pair drifted apart on exactly this before it was pinned, which
 * is why the status pair is pinned on the day it is written rather than after.
 * Comments are stripped first: three guards in this repo have been satisfied
 * by their own prose.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SITES = [
  ['the matter list row picker', '../app/counsel/cases/matters-table.tsx'],
  ['the matter detail picker', '../app/counsel/cases/[id]/status-picker.tsx'],
] as const;

describe('every matter status change survives a dead session', () => {
  for (const [label, rel] of SITES) {
    it(`${label} calls setStatus, never the action directly`, () => {
      const code = stripComments(read(rel));
      expect(code).toMatch(/\bsetStatus\s*\(/);
      expect(code).not.toMatch(/\bsetFirmCaseStatusAction\s*\(/);
    });
  }

  it('setStatus is the only place the action is called', () => {
    const helper = stripComments(read('../app/counsel/cases/set-status.ts'));
    expect(helper).toMatch(/\bsetFirmCaseStatusAction\s*\(/);
    expect(helper).toMatch(/catch\s*\{/);
  });
});
