import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bulk send-back, run for real against a fake table.
 *
 * Every export of lib/template-submissions.ts is a public HTTP endpoint,
 * callable by any signed-in user with arguments of their own choosing, and
 * every write in it goes through the service-role client, which bypasses RLS.
 * So the action is the whole of the authorization, and a bulk action is the
 * shape where that most easily goes wrong: one role check for a list of rows
 * that may not all belong to the caller's firm.
 *
 * The three properties under test are the ones that would cost a firm real
 * damage rather than a rerender:
 *
 *   1. A reviewer whose role cannot release a document cannot move ANY row
 *      through this path, whatever they pass in.
 *   2. Nothing this action does can release a document. It moves rows to
 *      'changes_requested' and to nothing else, and there is no delivery on
 *      any branch of it.
 *   3. A partial failure is reported per row. PostgREST reports a filter that
 *      matched nothing as success with no rows, so a bulk write that swallowed
 *      the empty result would tell a reviewer that work landed which did not.
 *
 * The fake holds SEVERAL rows and applies an update only when every `.eq()`
 * predicate matches the row as it stands, which is what a conditional update
 * does. The assertions are about what ends up in those rows, not about how a
 * query was spelled.
 */

type Row = Record<string, unknown>;

const store: { rows: Row[] } = { rows: [] };
let currentUser: { id: string; email: string } | null = null;
/** The caller's role, per firm, so a cross-firm selection can be exercised. */
let rolesByFirm: Record<string, string | null> = {};

/** Runs once immediately after the next read, then clears itself. */
let mutateAfterNextRead: (() => void) | null = null;
/** Set to make the next write report a transport failure rather than a miss. */
let failNextWrite: string | null = null;

function makeAdmin() {
  return {
    from() {
      let patch: Row | null = null;
      const eqs: [string, unknown][] = [];
      let inFilter: [string, unknown[]] | null = null;

      const selected = () =>
        store.rows.filter(
          (r) =>
            eqs.every(([col, val]) => r[col] === val) &&
            (!inFilter || inFilter[1].includes(r[inFilter[0]] as never)),
        );

      const run = (asList: boolean) => {
        const hits = selected();
        if (patch) {
          if (failNextWrite) {
            const message = failNextWrite;
            failNextWrite = null;
            return { data: null, error: { message } };
          }
          if (hits.length === 0) return { data: asList ? [] : null, error: null };
          for (const hit of hits) Object.assign(hit, patch);
          return {
            data: asList ? hits.map((h) => ({ ...h })) : { ...hits[0] },
            error: null,
          };
        }
        const snapshot = hits.map((h) => ({ ...h }));
        if (mutateAfterNextRead) {
          const hook = mutateAfterNextRead;
          mutateAfterNextRead = null;
          hook();
        }
        return { data: asList ? snapshot : (snapshot[0] ?? null), error: null };
      };

      const api = {
        select: () => api,
        update: (p: Row) => {
          patch = p;
          return api;
        },
        insert: () => api,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return api;
        },
        in: (col: string, vals: unknown[]) => {
          inFilter = [col, vals];
          return api;
        },
        is: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => run(false),
        single: async () => run(false),
        then: (resolve: (value: unknown) => void) => {
          resolve(run(true));
        },
      };
      return api;
    },
  };
}

const releaseApprovedSubmission = vi.fn(async () => ({ ok: true as const }));
const createNotification = vi.fn(async () => undefined);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));
// Loaded for real so FIRM_MANAGE_ROLES stays the real role list; only the
// lookup that hits the database is replaced.
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async (firmId: string) => rolesByFirm[firmId] ?? null,
}));
vi.mock('../lib/portal-entitlements', () => ({
  authorizeFirmActor: async () => ({ ok: true }),
}));
vi.mock('../lib/firm-storage', () => ({
  getFirmByIdAdmin: async () => ({ name: 'A Firm' }),
  getActiveFirmContext: async () => null,
}));
vi.mock('../lib/intake-notify', () => ({
  hydratePeople: async () => new Map(),
  siteUrl: () => 'https://example.test',
}));
vi.mock('../lib/notifications', () => ({ createNotification }));
vi.mock('../lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('../lib/firm-template-placeholders', () => ({
  counterpartyLabel: () => null,
  formatSignedOn: () => '1 January 2026',
  mergeTemplateDocument: () => 'merged',
}));
vi.mock('../lib/template-fill', () => ({
  loadPublishedTemplate: async () => null,
  sanitizeTemplateValues: () => ({}),
}));
vi.mock('../lib/template-release', () => ({ releaseApprovedSubmission }));

const { sendBackTemplateSubmissionsAction } = await import('../lib/template-submissions');
const { MAX_BULK_SEND_BACK } = await import('../lib/approval-queue');

function submission(over: Row = {}): Row {
  return {
    id: 'sub-1',
    firm_id: 'firm-1',
    template_id: 'tpl-1',
    template_name: 'Mutual NDA',
    submitted_by: 'employee-1',
    submitter_name: 'A colleague',
    submitter_email: 'employee@example.test',
    recipient_name: null,
    recipient_email: 'other.side@example.test',
    recipient_note: null,
    field_values: {},
    signature_name: 'A Colleague',
    document_text: 'The supplier shall deliver on time.',
    status: 'pending',
    revision: 1,
    decided_by: null,
    decided_at: null,
    decision_note: null,
    original_document_text: null,
    edited_by: null,
    edited_at: null,
    edit_note: null,
    released_at: null,
    release_token: null,
    release_error: null,
    created_at: '2026-01-01T10:00:00.000Z',
    updated_at: '2026-01-01T10:00:00.000Z',
    submitted_at: '2026-01-01T10:00:00.000Z',
    ...over,
  };
}

const rowOf = (id: string): Row => store.rows.find((r) => r.id === id) as Row;

beforeEach(() => {
  currentUser = { id: 'attorney-a', email: 'a@firm.test' };
  rolesByFirm = { 'firm-1': 'attorney' };
  mutateAfterNextRead = null;
  failNextWrite = null;
  releaseApprovedSubmission.mockClear();
  createNotification.mockClear();
  store.rows = [
    submission({ id: 'sub-1' }),
    submission({ id: 'sub-2', recipient_email: 'second@outside.test' }),
    submission({ id: 'sub-3', recipient_email: 'third@outside.test' }),
  ];
});

describe('who may send documents back in bulk', () => {
  it('lets a role that can release documents move every waiting row', async () => {
    const res = await sendBackTemplateSubmissionsAction(
      ['sub-1', 'sub-2', 'sub-3'],
      'Use the 2026 entity name.',
    );

    expect(res.ok).toBe(true);
    expect(res.results?.every((r) => r.ok)).toBe(true);
    for (const id of ['sub-1', 'sub-2', 'sub-3']) {
      expect(rowOf(id).status).toBe('changes_requested');
      expect(rowOf(id).decided_by).toBe('attorney-a');
    }
    expect(createNotification).toHaveBeenCalledTimes(3);
  });

  it('refuses a paralegal every row, and moves none of them', async () => {
    rolesByFirm = { 'firm-1': 'paralegal' };

    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2'], 'Please fix.');

    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(2);
    expect(res.results?.every((r) => !r.ok)).toBe(true);
    expect(res.results?.[0].error).toMatch(/role cannot approve/i);
    // Nothing moved. This is the assertion that goes red if the role check is
    // taken out of the loop: the rows would be sitting at changes_requested.
    expect(store.rows.every((r) => r.status === 'pending')).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses a staff member every row', async () => {
    rolesByFirm = { 'firm-1': 'staff' };
    const res = await sendBackTemplateSubmissionsAction(['sub-1'], 'Please fix.');
    expect(res.results?.[0].ok).toBe(false);
    expect(store.rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('refuses somebody who holds no role in the firm the row belongs to', async () => {
    // The caller is an owner somewhere else entirely and passes ids they
    // guessed. The role is resolved against each ROW's firm, never against
    // anything the caller sent.
    rolesByFirm = { 'firm-other': 'owner' };

    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2', 'sub-3'], 'Fix this.');

    expect(res.results?.every((r) => !r.ok)).toBe(true);
    expect(store.rows.every((r) => r.status === 'pending')).toBe(true);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses the rows in a firm the caller cannot reach while allowing their own', async () => {
    store.rows.push(submission({ id: 'sub-9', firm_id: 'firm-2', recipient_email: 'ninth@outside.test' }));
    rolesByFirm = { 'firm-1': 'attorney' };

    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-9'], 'Fix this.');

    expect(res.results?.find((r) => r.id === 'sub-1')?.ok).toBe(true);
    expect(res.results?.find((r) => r.id === 'sub-9')?.ok).toBe(false);
    expect(rowOf('sub-1').status).toBe('changes_requested');
    expect(rowOf('sub-9').status).toBe('pending');
  });

  it('refuses a caller with no session at all', async () => {
    currentUser = null;
    const res = await sendBackTemplateSubmissionsAction(['sub-1'], 'Fix this.');
    expect(res.ok).toBe(false);
    expect(res.results).toBeUndefined();
    expect(store.rows.every((r) => r.status === 'pending')).toBe(true);
  });
});

describe('nothing here can release a document', () => {
  it('moves rows to changes_requested and to no other status', async () => {
    await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2', 'sub-3'], 'Fix the entity name.');
    // If this action ever grew an approve branch, one of these would be
    // 'approved' or 'sent' instead.
    expect(store.rows.map((r) => r.status)).toEqual([
      'changes_requested',
      'changes_requested',
      'changes_requested',
    ]);
  });

  it('never reaches the delivery helper', async () => {
    await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2', 'sub-3'], 'Fix the entity name.');
    expect(releaseApprovedSubmission).not.toHaveBeenCalled();
  });

  it('leaves a document that is already approved exactly where it is', async () => {
    store.rows[0].status = 'approved';
    store.rows[0].decided_by = 'attorney-b';

    const res = await sendBackTemplateSubmissionsAction(['sub-1'], 'Actually, hold on.');

    expect(res.results?.[0].ok).toBe(false);
    expect(res.results?.[0].error).toMatch(/not awaiting review/i);
    expect(rowOf('sub-1').status).toBe('approved');
    expect(rowOf('sub-1').decided_by).toBe('attorney-b');
  });
});

describe('a partial failure is reported as one', () => {
  it('names the rows that did not move and leaves the ones that did', async () => {
    store.rows[1].status = 'sent';

    const res = await sendBackTemplateSubmissionsAction(
      ['sub-1', 'sub-2', 'sub-3'],
      'Use the 2026 entity name.',
    );

    expect(res.ok).toBe(true);
    expect(res.results?.map((r) => r.ok)).toEqual([true, false, true]);
    expect(res.results?.[1].id).toBe('sub-2');
    expect(rowOf('sub-1').status).toBe('changes_requested');
    expect(rowOf('sub-2').status).toBe('sent');
    expect(rowOf('sub-3').status).toBe('changes_requested');
  });

  it('treats a write that matched nothing as a failure the caller is told about', async () => {
    // A colleague decides on sub-2 in the gap between this action's own read
    // and its own write. The conditional update then matches no row, which
    // PostgREST reports as success with no data.
    mutateAfterNextRead = () => {
      rowOf('sub-2').status = 'declined';
    };

    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2'], 'Fix this.');

    const two = res.results?.find((r) => r.id === 'sub-2');
    expect(two?.ok).toBe(false);
    expect(two?.error).toMatch(/already acted on/i);
    // The colleague's decision survives, and no notification claims otherwise.
    expect(rowOf('sub-2').status).toBe('declined');
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('refuses a row whose wording moved under it rather than sending it back anyway', async () => {
    // A reviewer edit bumps the revision. The compare-and-swap is against the
    // revision this call read, so the row that moved is reported and the one
    // that did not still goes.
    mutateAfterNextRead = () => {
      rowOf('sub-1').revision = 2;
    };

    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-2'], 'Fix this.');

    expect(res.results?.find((r) => r.id === 'sub-1')?.ok).toBe(false);
    expect(rowOf('sub-1').status).toBe('pending');
    expect(rowOf('sub-2').status).toBe('changes_requested');
  });

  it('reports a database that did not answer as such, not as a colleague', async () => {
    failNextWrite = 'connection reset';
    const res = await sendBackTemplateSubmissionsAction(['sub-1'], 'Fix this.');
    expect(res.results?.[0].ok).toBe(false);
    expect(res.results?.[0].error).toMatch(/could not be recorded/i);
    expect(rowOf('sub-1').status).toBe('pending');
  });

  it('names a row it could not find rather than dropping it from the report', async () => {
    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'no-such-row'], 'Fix this.');
    expect(res.results).toHaveLength(2);
    expect(res.results?.find((r) => r.id === 'no-such-row')?.ok).toBe(false);
  });
});

describe('the shape of the call itself', () => {
  it('requires a note, because every colleague has to be told what to change', async () => {
    const res = await sendBackTemplateSubmissionsAction(['sub-1'], '   ');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/note/i);
    expect(store.rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('refuses an empty selection', async () => {
    const res = await sendBackTemplateSubmissionsAction([], 'Fix this.');
    expect(res.ok).toBe(false);
  });

  it('refuses more rows than a queue page holds', async () => {
    const ids = Array.from({ length: MAX_BULK_SEND_BACK + 1 }, (_, i) => `id-${i}`);
    const res = await sendBackTemplateSubmissionsAction(ids, 'Fix this.');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too many/i);
  });

  it('acts on a repeated id once', async () => {
    const res = await sendBackTemplateSubmissionsAction(['sub-1', 'sub-1', 'sub-1'], 'Fix this.');
    expect(res.results).toHaveLength(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });
});
