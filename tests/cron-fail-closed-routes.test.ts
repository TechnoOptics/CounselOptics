import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three remaining cron routes that guarded themselves with
 * `if (expected && got !== expected)`.
 *
 * That shape reads as an auth check and is not one: with CRON_SECRET unset the
 * condition is false and any anonymous GET runs the job. app/api/cron/health
 * and app/api/cron/deadlines already refuse in that case, and these three now
 * match them.
 *
 * Every fake below is deliberately PERMISSIVE. Each of these routes has a
 * second gate right behind the auth check - analyze-evidence bails when the AI
 * is not configured, partner-reminders bails when there is no admin client -
 * and a test that let those fire would pass whether or not the auth check
 * exists. So the AI reads as configured, the admin client reads as available,
 * and the only thing left that can refuse is the guard under test. Each case
 * asserts the job's own side effect never happened, not merely a status code.
 */

const spy = vi.hoisted(() => ({
  analyzed: 0,
  purged: 0,
  adminClients: 0,
  reset() {
    this.analyzed = 0;
    this.purged = 0;
    this.adminClients = 0;
  },
}));

// A permissive stand-in for the admin Supabase client. The query chain the
// partner-reminders sweep builds resolves to zero rows, so if the sweep is
// ever reached it completes normally rather than throwing - which would be its
// own reason for a non-200 and would muddy what the assertions prove.
function adminStub() {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'in', 'not', 'order', 'eq', 'update']) {
    chain[method] = () => chain;
  }
  chain.limit = async () => ({ data: [] });
  chain.maybeSingle = async () => ({ data: null });
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    spy.adminClients += 1;
    return adminStub();
  },
  isServiceRoleConfigured: () => true,
}));

vi.mock('@/lib/timeline-ai', () => ({
  aiConfigured: () => true,
}));

vi.mock('@/lib/case-evidence', () => ({
  analyzePendingEvidence: async () => {
    spy.analyzed += 1;
    return { analyzed: 2, failed: 0, picked: 2, remaining: false };
  },
}));

vi.mock('@/lib/community-retention', () => ({
  purgeScheduledIdImages: async () => {
    spy.purged += 1;
    return { deleted: 4 };
  },
}));

vi.mock('@/lib/partner-config-core', () => ({
  readPartnerConfig: () => ({ remindAfterHours: 24 }),
}));

vi.mock('@/lib/partner-notify', () => ({
  partnerTicketEvent: async () => undefined,
}));

const analyzeEvidence = (await import('@/app/api/cron/analyze-evidence/route')).GET;
const partnerReminders = (await import('@/app/api/cron/partner-reminders/route')).GET;
const purgeCommunityIds = (await import('@/app/api/cron/purge-community-ids/route')).GET;

// Each route returns its own JSON shape, so the handlers only share the
// contract this file exercises: take a request, resolve to a Response.
type CronRequest = Parameters<typeof analyzeEvidence>[0];
type Handler = (req: CronRequest) => Promise<Response>;

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(path: string, authorization?: string) {
  return new Request(`https://example.test${path}`, {
    headers: authorization ? { authorization } : {},
  }) as unknown as CronRequest;
}

beforeEach(() => {
  spy.reset();
  process.env.CRON_SECRET = 'the-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

/**
 * `sideEffects` is what the route actually does to the world. Reading it as 0
 * is the assertion that carries the weight - a status code alone would still
 * pass if the job had already run and then returned an error.
 */
const routes: Array<{
  name: string;
  path: string;
  handler: Handler;
  sideEffects: () => number;
}> = [
  {
    name: 'analyze-evidence (spends model tokens)',
    path: '/api/cron/analyze-evidence',
    handler: analyzeEvidence,
    sideEffects: () => spy.analyzed,
  },
  {
    name: 'partner-reminders (mails a firm legal team)',
    path: '/api/cron/partner-reminders',
    handler: partnerReminders,
    sideEffects: () => spy.adminClients,
  },
  {
    name: 'purge-community-ids (deletes supporter ID images)',
    path: '/api/cron/purge-community-ids',
    handler: purgeCommunityIds,
    sideEffects: () => spy.purged,
  },
];

describe.each(routes)('$name refuses when it cannot authenticate the caller', (route) => {
  it('refuses, and does nothing, when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = await route.handler(request(route.path, 'Bearer anything'));
    expect(res.status).toBe(503);
    expect(route.sideEffects()).toBe(0);
  });

  it('refuses, and does nothing, when CRON_SECRET is set to blank space', async () => {
    process.env.CRON_SECRET = '   ';
    const res = await route.handler(request(route.path));
    expect(res.status).toBe(503);
    expect(route.sideEffects()).toBe(0);
  });

  it('refuses an anonymous caller with no Authorization header', async () => {
    const res = await route.handler(request(route.path));
    expect(res.status).toBe(403);
    expect(route.sideEffects()).toBe(0);
  });

  it('refuses a wrong secret', async () => {
    const res = await route.handler(request(route.path, 'Bearer not-the-secret'));
    expect(res.status).toBe(403);
    expect(route.sideEffects()).toBe(0);
  });

  it('refuses the bare secret without the Bearer scheme', async () => {
    const res = await route.handler(request(route.path, 'the-secret'));
    expect(res.status).toBe(403);
    expect(route.sideEffects()).toBe(0);
  });

  it('says only that the server is misconfigured, and reports no counts', async () => {
    delete process.env.CRON_SECRET;
    const body = await (await route.handler(request(route.path))).json();
    expect(body).toEqual({ error: 'Server misconfigured: CRON_SECRET is not set' });
  });

  // The other half of the guard: with the secret present and correct the job
  // must still run. Without this, a guard that refused unconditionally would
  // pass every assertion above.
  it('runs for Vercel Cron when the secret matches', async () => {
    const res = await route.handler(request(route.path, 'Bearer the-secret'));
    expect(res.status).toBe(200);
    expect(route.sideEffects()).toBeGreaterThan(0);
  });
});
