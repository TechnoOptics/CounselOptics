import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two endpoints whose response IS the claim, and which made it unread.
 *
 *   POST /api/safe/stop answers `{ ok: true }`, and the app turns that
 *   into "your location is no longer being shared". This is the safety
 *   feature; there is no second screen where the person finds out.
 *
 *   DELETE /api/scim/v2/Users/:id answers 204, and the IdP takes that as
 *   final: the user is marked deprovisioned upstream and stops being
 *   reconciled. It was the only write on that resource that dropped its
 *   result, and it is the offboarding one.
 *
 * Both writes go through the service-role client, so RLS is not the
 * hazard here - a zero-row match means the row genuinely was not there,
 * and a rejected write means the database said no. PostgREST reports both
 * as `error: null` when nothing is read back, which is why an unread
 * write could answer ok/204 for a change that never happened.
 */

type Row = Record<string, unknown>;

const world = {
  tables: {} as Record<string, Row[]>,
  unmatched: new Set<string>(),
  failing: new Set<string>(),
  reset() {
    this.tables = { safe_witness_alerts: [], firm_employees: [] };
    this.unmatched = new Set<string>();
    this.failing = new Set<string>();
  },
};

function builder(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' = 'select';
  let payload: Row = {};
  let selected = false;
  const rows = () => (world.tables[table] ??= []);

  const run = (): { data: unknown; error: unknown } => {
    if (op === 'update') {
      if (world.failing.has(table)) {
        return { data: null, error: { message: `${table} write rejected` } };
      }
      const hits = world.unmatched.has(table)
        ? []
        : rows().filter((r) => preds.every((p) => p(r)));
      for (const r of hits) Object.assign(r, payload);
      return { data: selected ? hits.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: rows().filter((r) => preds.every((p) => p(r))), error: null };
  };

  const api: Record<string, unknown> = {
    select() {
      selected = true;
      return api;
    },
    update(p: Row) {
      op = 'update';
      payload = p;
      return api;
    },
    eq(col: string, val: unknown) {
      preds.push((r) => r[col] === val);
      return api;
    },
    is(col: string, val: unknown) {
      preds.push((r) => (r[col] ?? null) === val);
      return api;
    },
    async maybeSingle() {
      const { data, error } = run();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    },
    async single() {
      const { data, error } = run();
      const row = Array.isArray(data) ? (data[0] ?? null) : data;
      return row
        ? { data: row, error: null }
        : { data: null, error: { message: 'no rows' } };
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return api;
}

const admin = { from: (t: string) => builder(t) };

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => admin }));
// The watcher's token is valid and carries the scope, so the only gate
// left standing in front of the write is the one under test.
vi.mock('@/lib/api-tokens', () => ({
  verifyApiToken: async () => ({
    id: 'tok-1',
    firmId: null,
    userId: 'watcher-1',
    scopes: ['read'],
  }),
  tokenHasScope: () => true,
}));

const ALERT = '11111111-2222-3333-4444-555555555555';

const { POST: stopPost } = await import('../app/api/safe/stop/route');

function stopRequest() {
  return new Request('https://advottic.test/api/safe/stop', {
    method: 'POST',
    headers: { authorization: 'Bearer adv_test', 'content-type': 'application/json' },
    body: JSON.stringify({ alert_id: ALERT, source: 'watch' }),
  }) as unknown as Parameters<typeof stopPost>[0];
}

beforeEach(() => {
  world.reset();
  world.tables.safe_witness_alerts.push({
    id: ALERT,
    user_id: 'watcher-1',
    live_tracking: true,
    tracking_stopped_at: null,
    tracking_stopped_by: null,
  });
});

describe('POST /api/safe/stop', () => {
  it('does not answer ok when tracking is still running', async () => {
    world.unmatched.add('safe_witness_alerts');

    const res = await stopPost(stopRequest());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('could not be stopped'),
    });
    // The assertion that matters on its own: the position feed is still
    // open, which is what the caller would have been told was closed.
    expect(world.tables.safe_witness_alerts[0].live_tracking).toBe(true);
    expect(world.tables.safe_witness_alerts[0].tracking_stopped_at).toBeNull();
  });

  it('does not answer ok when the write is rejected', async () => {
    world.failing.add('safe_witness_alerts');

    const res = await stopPost(stopRequest());

    expect(res.status).toBe(500);
    expect(world.tables.safe_witness_alerts[0].live_tracking).toBe(true);
  });

  it('stops tracking, and says so, when the row really moves', async () => {
    const res = await stopPost(stopRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(world.tables.safe_witness_alerts[0].live_tracking).toBe(false);
    expect(world.tables.safe_witness_alerts[0].tracking_stopped_by).toBe('watch');
  });

  it('still short-circuits an alert that was already stopped', async () => {
    world.tables.safe_witness_alerts[0].tracking_stopped_at = '2026-08-09T10:00:00Z';

    const res = await stopPost(stopRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, already_stopped: true });
  });
});

describe('DELETE /api/scim/v2/Users/:id', () => {
  it('does not answer 204 for an employee who is still active', async () => {
    world.tables.firm_employees.push({
      id: 'emp-1',
      firm_id: 'firm-1',
      email: 'dana@firm.test',
      display_name: 'Dana Reyes',
      external_id: 'ext-1',
      deactivated_at: null,
      created_at: '2026-01-01T00:00:00Z',
      department: null,
    });
    world.unmatched.add('firm_employees');

    const { DELETE } = await import('../app/api/scim/v2/Users/[id]/route');
    const res = await DELETE(
      new Request('https://advottic.test/scim/v2/Users/emp-1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer scim-token' },
      }),
      { params: { id: 'emp-1' } },
    );

    // 500 is what makes the IdP retry; 204 is what makes it stop.
    expect(res.status).toBe(500);
    expect(world.tables.firm_employees[0].deactivated_at).toBeNull();
  });

  it('answers 204 once the employee really is deactivated', async () => {
    world.tables.firm_employees.push({
      id: 'emp-1',
      firm_id: 'firm-1',
      email: 'dana@firm.test',
      display_name: 'Dana Reyes',
      external_id: 'ext-1',
      deactivated_at: null,
      created_at: '2026-01-01T00:00:00Z',
      department: null,
    });

    const { DELETE } = await import('../app/api/scim/v2/Users/[id]/route');
    const res = await DELETE(
      new Request('https://advottic.test/scim/v2/Users/emp-1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer scim-token' },
      }),
      { params: { id: 'emp-1' } },
    );

    expect(res.status).toBe(204);
    expect(world.tables.firm_employees[0].deactivated_at).toEqual(
      expect.any(String),
    );
  });
});

vi.mock('@/lib/scim', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    // A valid SCIM bearer token for firm-1, so the only gate left in front
    // of the deprovisioning write is the one under test.
    authenticateScim: async () => ({ firmId: 'firm-1', admin }),
  };
});
