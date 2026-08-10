import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Asking a named colleague to fill in a firm form, run for real against a fake
 * database.
 *
 * This is a `'use server'` export, so it is a public HTTP endpoint that any
 * signed-in user can call with a firm id, a template id and a user id of their
 * own choosing, and every read inside it uses the service-role client, which
 * bypasses RLS. The checks in the action are therefore the whole of the
 * authorization, and this file is about the three of them:
 *
 *   1. The caller must hold a role in THAT firm that may post firm work.
 *   2. The template must belong to that firm and be published.
 *   3. The colleague must be an active member of that firm's workspace with an
 *      account they have actually signed into.
 *
 * Plus the one thing this codebase gets wrong most often: a write that matched
 * nothing comes back as success with no row, so an absent notification is a
 * failure the caller has to be told about rather than a cheerful "sent".
 */

type Row = Record<string, unknown>;

const tables: { firm_templates: Row[]; firm_employees: Row[] } = {
  firm_templates: [],
  firm_employees: [],
};
let currentUser: { id: string; email: string } | null = null;
let rolesByFirm: Record<string, string | null> = {};
/** Set to make the notification insert fail the way a refused write does. */
let notificationFails = false;

const createNotification = vi.fn(async (input: Record<string, unknown>) =>
  notificationFails ? null : { id: 'note-1', ...input },
);

function makeAdmin() {
  return {
    from(table: keyof typeof tables) {
      const eqs: [string, unknown][] = [];
      const isNull: string[] = [];
      const api = {
        select: () => api,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return api;
        },
        is: (col: string, val: unknown) => {
          if (val === null) isNull.push(col);
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          const hit = (tables[table] ?? []).find(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              isNull.every((c) => r[c] == null),
          );
          return { data: hit ? { ...hit } : null, error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const hits = (tables[table] ?? []).filter(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              isNull.every((c) => r[c] == null),
          );
          resolve({ data: hits.map((h) => ({ ...h })), error: null });
        },
      };
      return api;
    },
  };
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: async () => currentUser,
  createServerSupabase: async () => null,
  isSupabaseConfigured: () => true,
}));
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => makeAdmin() }));
// Loaded for real so FIRM_POSTING_ROLES stays the real role list; only the
// lookup that hits the database is replaced.
vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerFirmRole: async (firmId: string) => rolesByFirm[firmId] ?? null,
}));
vi.mock('../lib/intake-notify', () => ({
  hydratePeople: async () => new Map([['lawyer-1', { name: 'Priya Raman' }]]),
  siteUrl: () => 'https://example.test',
}));
vi.mock('../lib/notifications', () => ({ createNotification }));
vi.mock('../lib/rate-limit', () => ({ checkRateLimit: async () => true }));

const { askColleagueForTemplateAction, canRequestTemplates, listRequestableColleagues } =
  await import('../lib/template-requests');

beforeEach(() => {
  currentUser = { id: 'lawyer-1', email: 'priya@firm.test' };
  rolesByFirm = { 'firm-1': 'attorney' };
  notificationFails = false;
  createNotification.mockClear();
  tables.firm_templates = [
    { id: 'tpl-1', firm_id: 'firm-1', name: 'Mutual NDA', status: 'published' },
    { id: 'tpl-draft', firm_id: 'firm-1', name: 'Half-written thing', status: 'draft' },
    { id: 'tpl-other', firm_id: 'firm-2', name: 'Another firm form', status: 'published' },
  ];
  tables.firm_employees = [
    {
      firm_id: 'firm-1',
      user_id: 'employee-1',
      display_name: 'Dana Okafor',
      email: 'dana@firm.test',
      deactivated_at: null,
    },
    {
      firm_id: 'firm-1',
      user_id: 'employee-gone',
      display_name: 'Former Colleague',
      email: 'gone@firm.test',
      deactivated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      firm_id: 'firm-1',
      user_id: null,
      display_name: 'Never Signed In',
      email: 'invited@firm.test',
      deactivated_at: null,
    },
    {
      firm_id: 'firm-2',
      user_id: 'employee-elsewhere',
      display_name: 'Somebody Else',
      email: 'else@other.test',
      deactivated_at: null,
    },
  ];
});

describe('who may ask a colleague for a form', () => {
  it('lets a role that posts firm work send the request', async () => {
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1', 'For Acme.');
    expect(res.ok).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('lets a paralegal send it, since nothing is released by asking', async () => {
    rolesByFirm = { 'firm-1': 'paralegal' };
    expect(await canRequestTemplates('firm-1')).toBe(true);
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    expect(res.ok).toBe(true);
  });

  it('refuses a staff member, who is sold read-only access', async () => {
    rolesByFirm = { 'firm-1': 'staff' };
    expect(await canRequestTemplates('firm-1')).toBe(false);
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/role cannot/i);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses somebody who holds no role in the firm they named', async () => {
    // An owner of a different firm, passing this firm's id.
    rolesByFirm = { 'firm-2': 'owner' };
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    expect(res.ok).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses a caller with no session', async () => {
    currentUser = null;
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    expect(res.ok).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('which form may be asked for', () => {
  it('refuses a template belonging to another firm', async () => {
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-other', 'employee-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not available/i);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses a template that is not published', async () => {
    // An employee cannot fill in a draft, so asking them to would send them to
    // a page that turns them away.
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-draft', 'employee-1');
    expect(res.ok).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('which colleague may be asked', () => {
  it('refuses somebody in another firm', async () => {
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-elsewhere');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not on this workspace/i);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('refuses somebody who has been deactivated', async () => {
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-gone');
    expect(res.ok).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('offers only the people a notification can actually reach', async () => {
    const list = await listRequestableColleagues('firm-1');
    // The invited-but-never-signed-in row has no user id, so nothing can be
    // sent to it and it is not offered; the deactivated one is gone too.
    expect(list.map((c) => c.userId)).toEqual(['employee-1']);
    expect(list[0].label).toBe('Dana Okafor');
  });

  it('offers nobody to a role that cannot ask', async () => {
    rolesByFirm = { 'firm-1': 'staff' };
    expect(await listRequestableColleagues('firm-1')).toEqual([]);
  });
});

describe('what the colleague is actually sent', () => {
  it('links them straight to the fill page for that form', async () => {
    await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1', 'Acme, by Friday.');
    const sent = createNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.userId).toBe('employee-1');
    expect(sent.link).toBe('/portal/forms/tpl-1');
    expect(sent.title).toContain('Mutual NDA');
    expect(sent.body).toBe('Acme, by Friday.');
    expect(sent.actorUserId).toBe('lawyer-1');
  });

  it('says something useful when no note was written', async () => {
    await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    const sent = createNotification.mock.calls[0][0] as Record<string, unknown>;
    expect(String(sent.body ?? '')).not.toBe('');
  });

  it('reports a write that did not land instead of claiming it was sent', async () => {
    notificationFails = true;
    const res = await askColleagueForTemplateAction('firm-1', 'tpl-1', 'employee-1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/could not send/i);
  });
});
