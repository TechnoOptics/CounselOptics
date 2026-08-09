import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';

/**
 * The four `firm_webhook_configs` server actions, and the firm predicate that
 * was missing from all of them.
 *
 * A row in that table is an outbound egress channel for an organization's
 * matter-room chat: fanoutWebhooks reads it with the service-role client on
 * every message send and POSTs a preview of the message body to whatever `url`
 * the row carries. `url` is also a bearer credential for Slack or Teams, so
 * reading the table is disclosure in its own right. All four exports were
 * gated on `requireUser()` and nothing else, which made planting, listing,
 * disabling and deleting another organization's webhooks a signed-in call
 * away.
 *
 * HOW THIS SUITE IS BUILT, because three shapes of false green have caught
 * agents on this repository:
 *
 *   - Every neighbouring gate is held OPEN. requireUser resolves, the webhook
 *     lookup finds a row, and the write reports a row affected. The only thing
 *     that can refuse in these cases is the gate under test, so a green
 *     refusal cannot be somebody else's refusal.
 *   - Refusal and side effect are asserted SEPARATELY. Moving a gate below the
 *     write still returns ok:false, so `expect(res.ok).toBe(false)` alone is
 *     satisfied by a gate that runs too late. Every refusal case also asserts
 *     the recorded call log, which is empty exactly when nothing was written.
 *   - The fake can FAIL. `written` is settable, and the update/delete nodes
 *     keep a `then` so that dropping `.select('id')` resolves clean with
 *     nothing to inspect, the way PostgREST really behaves. A mutation that
 *     removes the confirmation therefore has a branch to be caught in.
 *
 * Mutations, each verified red before this file was committed:
 *   - drop the callerIsFirmAdmin check in listFirmWebhooksAction: "refuses to
 *     list ... " goes red.
 *   - drop it in createFirmWebhookAction: "refuses to plant ... " goes red.
 *   - drop the authorizeWebhook gate in setFirmWebhookActiveAction or in
 *     deleteFirmWebhookAction: the matching refusal goes red.
 *   - move the authorizeWebhook gate BELOW the write: the refusal assertion
 *     stays green and the call-log assertion goes red, which is the whole
 *     reason the two are separate.
 *   - let authorizeWebhook pass when the row is missing: "answers a webhook
 *     that does not exist ... " goes red.
 *   - drop `.select('id')` from the update or the delete: the matching
 *     "reports a write that matched no row" goes red.
 */

type Row = { id: string };

const h = vi.hoisted(() => {
  const s = {
    /** What callerIsFirmAdmin answers. */
    isAdmin: true,
    /** The firm the looked-up webhook belongs to; null means no such row. */
    lookupFirmId: 'firm-1' as string | null,
    /** Rows the fake reports the UPDATE or DELETE as having affected. */
    written: [{ id: 'wh-1' }] as Row[],
  };
  const calls: string[] = [];

  const listRow = {
    id: 'wh-1',
    firm_id: 'firm-1',
    kind: 'slack',
    label: 'Ops',
    url: 'https://hooks.slack.com/services/T/B/x',
    channel_filter: null,
    is_active: true,
    include_body: true,
    created_at: '2026-08-01T00:00:00.000Z',
    last_fired_at: null,
    failure_count: 0,
    last_error: null,
  };

  function writeNode(label: string) {
    const node: Record<string, unknown> = {
      eq: () => node,
      select: () => {
        calls.push(label);
        return Promise.resolve({ data: s.written, error: null });
      },
      // Awaiting without selecting is exactly what the old shape did, and
      // PostgREST resolves it clean with nothing to inspect. Kept so that
      // removing `.select('id')` fails the assertions rather than the harness.
      then: (resolve: (v: unknown) => unknown) => {
        calls.push(label);
        return resolve({ data: null, error: null });
      },
    };
    return node;
  }

  function makeUserClient() {
    return {
      from: () => ({
        select: () => {
          const node: Record<string, unknown> = {
            eq: () => node,
            order: () => {
              calls.push('list');
              return Promise.resolve({ data: [listRow], error: null });
            },
            maybeSingle: async () => {
              calls.push('lookup');
              return {
                data: s.lookupFirmId ? { firm_id: s.lookupFirmId } : null,
                error: null,
              };
            },
          };
          return node;
        },
        insert: () => ({
          select: () => ({
            single: async () => {
              calls.push('insert');
              return { data: { id: 'wh-new' }, error: null };
            },
          }),
        }),
        update: () => writeNode('update'),
        delete: () => writeNode('delete'),
      }),
    };
  }

  return { s, calls, makeUserClient };
});

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

// Null on purpose. These four actions must not need the service role: the
// import would still resolve if one of them reached for it, but every case
// here would then fail loudly rather than quietly widening.
vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  requireUser: async () => ({ id: 'user-1', email: 'a@example.com' }),
  createServerSupabase: () => h.makeUserClient(),
}));

vi.mock('../lib/firm-authz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callerIsFirmAdmin: async () => h.s.isAdmin,
  callerIsFirmMember: async () => true,
  callerHasFirmRole: async () => true,
  requireActiveFirm: async () => {},
}));

vi.mock('../lib/email', () => ({
  sendEmail: async () => {},
  buildMeetingInviteEmailHtml: () => '',
  buildSigningRequestEmailHtml: () => '',
  buildSigningCodeEmailHtml: () => '',
}));

const {
  listFirmWebhooksAction,
  createFirmWebhookAction,
  setFirmWebhookActiveAction,
  deleteFirmWebhookAction,
} = await import('../lib/firm-actions');

const NO_FIRM = 'You do not have access to this firm.';
const NO_WEBHOOK = 'That webhook is not available to you.';

function validForm(): FormData {
  const fd = new FormData();
  fd.set('kind', 'slack');
  fd.set('url', 'https://hooks.slack.com/services/T/B/x');
  fd.set('label', 'Ops');
  fd.set('includeBody', 'on');
  return fd;
}

beforeEach(() => {
  h.calls.length = 0;
  h.s.isAdmin = true;
  h.s.lookupFirmId = 'firm-1';
  h.s.written = [{ id: 'wh-1' }];
});

describe('listing another organization’s webhooks', () => {
  it('refuses a caller who does not administer the firm, and reads nothing', async () => {
    h.s.isAdmin = false;
    const res = await listFirmWebhooksAction('firm-victim');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NO_FIRM);
    // The URLs are the credential. A refusal that still ran the read would be
    // green on `ok` and would still have handed them over inside `webhooks`.
    expect(res.webhooks).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  it('still lists for an owner or an administrator', async () => {
    const res = await listFirmWebhooksAction('firm-1');
    expect(res.ok).toBe(true);
    expect(res.webhooks).toHaveLength(1);
    expect(res.webhooks?.[0].url).toBe('https://hooks.slack.com/services/T/B/x');
    expect(h.calls).toEqual(['list']);
  });
});

describe('planting a webhook on another organization', () => {
  it('refuses a caller who does not administer the firm, and writes nothing', async () => {
    h.s.isAdmin = false;
    const res = await createFirmWebhookAction('firm-victim', validForm());
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NO_FIRM);
    expect(res.webhookId).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  it('still creates for an owner or an administrator', async () => {
    const res = await createFirmWebhookAction('firm-1', validForm());
    expect(res.ok).toBe(true);
    expect(res.webhookId).toBe('wh-new');
    expect(h.calls).toEqual(['insert']);
  });

  it('refuses before it validates, so a stranger learns nothing from the message', async () => {
    h.s.isAdmin = false;
    const fd = new FormData();
    fd.set('kind', 'nonsense');
    const res = await createFirmWebhookAction('firm-victim', fd);
    expect(res.error).toBe(NO_FIRM);
    expect(h.calls).toEqual([]);
  });
});

describe('disabling a webhook by id', () => {
  it('refuses a caller who does not administer the webhook’s firm, and writes nothing', async () => {
    h.s.isAdmin = false;
    const res = await setFirmWebhookActiveAction('wh-1', false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NO_WEBHOOK);
    // Separate claim from the refusal: a gate moved below the write still
    // returns ok:false, and would leave 'update' in here.
    expect(h.calls).toEqual(['lookup']);
  });

  it('answers a webhook that does not exist exactly as it answers one the caller may not touch', async () => {
    h.s.lookupFirmId = null;
    const missing = await setFirmWebhookActiveAction('wh-nope', false);
    h.calls.length = 0;
    h.s.lookupFirmId = 'firm-1';
    h.s.isAdmin = false;
    const forbidden = await setFirmWebhookActiveAction('wh-1', false);
    expect(missing.error).toBe(forbidden.error);
    expect(missing.ok).toBe(false);
    expect(forbidden.ok).toBe(false);
  });

  it('still toggles for an owner or an administrator', async () => {
    const res = await setFirmWebhookActiveAction('wh-1', false);
    expect(res.ok).toBe(true);
    expect(h.calls).toEqual(['lookup', 'update']);
  });

  it('reports a write that matched no row rather than reporting success', async () => {
    h.s.written = [];
    const res = await setFirmWebhookActiveAction('wh-1', false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NO_WEBHOOK);
    expect(h.calls).toEqual(['lookup', 'update']);
  });
});

describe('deleting a webhook by id', () => {
  it('refuses a caller who does not administer the webhook’s firm, and writes nothing', async () => {
    h.s.isAdmin = false;
    const res = await deleteFirmWebhookAction('wh-1');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(NO_WEBHOOK);
    expect(h.calls).toEqual(['lookup']);
  });

  it('still deletes for an owner or an administrator', async () => {
    const res = await deleteFirmWebhookAction('wh-1');
    expect(res.ok).toBe(true);
    expect(h.calls).toEqual(['lookup', 'delete']);
  });

  it('reports a delete that matched no row rather than reporting success', async () => {
    h.s.written = [];
    const res = await deleteFirmWebhookAction('wh-1');
    expect(res.ok).toBe(false);
    expect(h.calls).toEqual(['lookup', 'delete']);
  });
});

/**
 * The gate is the action, not the page.
 *
 * app/counsel/settings/page.tsx has always redirected every role but owner and
 * admin, and that redirect is what made the missing predicate invisible for as
 * long as it was there. It is a courtesy to a browser: a `'use server'` export
 * is a public HTTP endpoint and stays callable regardless of what the page
 * does. This pins that each of the four names its own gate, so deleting one
 * and leaning on the redirect again is a red test rather than a quiet
 * regression. Comments are stripped first, because guards in this repository
 * have been satisfied by their own prose before.
 */
describe('every webhook action carries its own firm predicate', () => {
  const source = stripComments(
    readFileSync(fileURLToPath(new URL('../lib/firm-actions.ts', import.meta.url)), 'utf8'),
  );

  const bodyOf = (name: string) => {
    const start = source.indexOf(`export async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\nexport ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
  };

  for (const name of ['listFirmWebhooksAction', 'createFirmWebhookAction']) {
    it(`${name} checks callerIsFirmAdmin on the firm it was handed`, () => {
      expect(bodyOf(name)).toMatch(/callerIsFirmAdmin\(firmId\)/);
    });
  }

  for (const name of ['setFirmWebhookActiveAction', 'deleteFirmWebhookAction']) {
    it(`${name} resolves the webhook’s own firm before it writes`, () => {
      expect(bodyOf(name)).toMatch(/authorizeWebhook\(webhookId\)/);
    });
  }
});
