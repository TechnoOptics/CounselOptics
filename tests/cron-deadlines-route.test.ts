import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/cron/deadlines.
 *
 * This route sends deadline reminders. `createNotification` fans
 * `case_hearing_reminder` out to email, so a request that reaches the sweep
 * causes real mail to real attorneys and clients, and the JSON it returns
 * reports how many deadlines are sitting inside the 90/30/7 day windows.
 *
 * It previously guarded itself with `if (expected && got !== expected)`, which
 * looks like an auth check and is not one: with CRON_SECRET unset the whole
 * condition is false and any anonymous GET runs the sweep. The tests below hold
 * down that the refusal happens BEFORE the sweep, in all three of the cases
 * that matter - no secret configured, no header sent, wrong header - and each
 * asserts the sweep was not called rather than only asserting a status code.
 */

const sweep = vi.hoisted(() => ({
  calls: 0,
  reset() {
    this.calls = 0;
  },
}));

vi.mock('@/lib/deadlines', () => ({
  sweepDeadlineAlerts: async () => {
    sweep.calls += 1;
    return { scanned: 3, fired: 2 };
  },
}));

const { GET } = await import('@/app/api/cron/deadlines/route');

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new Request('https://example.test/api/cron/deadlines', {
    headers: authorization ? { authorization } : {},
  }) as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  sweep.reset();
  process.env.CRON_SECRET = 'the-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('the deadline cron refuses when it cannot authenticate the caller', () => {
  it('refuses, and sends nothing, when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request('Bearer anything'));
    expect(res.status).toBe(503);
    expect(sweep.calls).toBe(0);
  });

  it('refuses, and sends nothing, when CRON_SECRET is set to blank space', async () => {
    process.env.CRON_SECRET = '   ';
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(sweep.calls).toBe(0);
  });

  it('refuses an anonymous caller with no Authorization header', async () => {
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(sweep.calls).toBe(0);
  });

  it('refuses a wrong secret', async () => {
    const res = await GET(request('Bearer not-the-secret'));
    expect(res.status).toBe(403);
    expect(sweep.calls).toBe(0);
  });

  it('refuses the bare secret without the Bearer scheme', async () => {
    const res = await GET(request('the-secret'));
    expect(res.status).toBe(403);
    expect(sweep.calls).toBe(0);
  });

  it('tells the caller nothing about the deadlines when it refuses', async () => {
    delete process.env.CRON_SECRET;
    const body = await (await GET(request())).json();
    expect(body).not.toHaveProperty('scanned');
    expect(body).not.toHaveProperty('fired');
  });
});

describe('the deadline cron runs for Vercel Cron', () => {
  it('sweeps once and reports the counts', async () => {
    const res = await GET(request('Bearer the-secret'));
    expect(res.status).toBe(200);
    expect(sweep.calls).toBe(1);
    expect(await res.json()).toEqual({ ok: true, scanned: 3, fired: 2 });
  });
});
