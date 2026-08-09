import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * Closing a security event, which nothing could do.
 *
 * `security_events.acknowledged_at` was set at insert and never again, the
 * `integrity.open_events` control turns critical above five open rows, and a
 * single critical grades the whole Security Center a D. So the posture grade
 * could only fall. This is the write that lets it rise, and the gate on it.
 *
 * The load-bearing assertions are not the returned strings. They are that a
 * non-admin caller produced NO write at all, and that a write which matched
 * no row is reported as a failure - PostgREST returns `{ error: null }` for
 * an update that changed nothing, so "succeeded" and "matched nothing" are
 * the same value unless somebody counts the rows.
 */

const db = vi.hoisted(() => ({
  /** Every update() the action reached, so a refusal can be proved silent. */
  writes: [] as Array<Record<string, unknown>>,
  /** Rows the update reports back. Empty array = the filter matched nothing. */
  rows: [{ id: 'evt-1' }] as Array<{ id: string }> | null,
  error: null as { message: string } | null,
  serviceRole: true,
}));

const auth = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../lib/supabase/server', () => ({
  isCurrentUserAdmin: vi.fn(async () => auth.isAdmin),
}));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () =>
    db.serviceRole
      ? {
          from: () => ({
            update: (patch: Record<string, unknown>) => {
              db.writes.push(patch);
              const chain = {
                eq: () => chain,
                is: () => chain,
                select: async () => ({ data: db.rows, error: db.error }),
              };
              return chain;
            },
          }),
        }
      : null,
}));

const { acknowledgeSecurityEventAction } = await import(
  '../lib/security-event-actions'
);

beforeEach(() => {
  db.writes = [];
  db.rows = [{ id: 'evt-1' }];
  db.error = null;
  db.serviceRole = true;
  auth.isAdmin = true;
});

describe('only HQ can close a security event', () => {
  it('acknowledges the event for an admin', async () => {
    const res = await acknowledgeSecurityEventAction('evt-1');
    expect(res.ok).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(typeof db.writes[0].acknowledged_at).toBe('string');
  });

  it('refuses a non-admin and writes nothing', async () => {
    auth.isAdmin = false;
    const res = await acknowledgeSecurityEventAction('evt-1');
    expect(res.ok).toBe(false);
    // The refusal that matters: the row was never touched. An action that
    // says no in its message while still writing has failed completely.
    expect(db.writes).toEqual([]);
  });

  it('refuses an empty id without reaching the database', async () => {
    const res = await acknowledgeSecurityEventAction('   ');
    expect(res.ok).toBe(false);
    expect(db.writes).toEqual([]);
  });
});

describe('a write that changed nothing is reported as a failure', () => {
  it('fails when the filter matched no row', async () => {
    // Already acknowledged by somebody else, or gone. PostgREST reports no
    // error for this, so only the row count can tell the difference.
    db.rows = [];
    const res = await acknowledgeSecurityEventAction('evt-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/nothing was acknowledged/i);
  });

  it('fails when the update itself errored', async () => {
    db.error = { message: 'permission denied' };
    db.rows = null;
    const res = await acknowledgeSecurityEventAction('evt-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain('permission denied');
  });

  it('says so when there is no service role to write with', async () => {
    db.serviceRole = false;
    const res = await acknowledgeSecurityEventAction('evt-1');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/service-role/i);
  });
});

describe('the Security Center actually offers the control', () => {
  const src = stripComments(
    readFileSync(
      fileURLToPath(
        new URL('../app/admin/security-center/page.tsx', import.meta.url),
      ),
      'utf8',
    ),
  );

  it('reads the id an open row needs to be acknowledgeable', () => {
    expect(src).toContain(
      "select('id, kind, severity, occurred_at, acknowledged_at')",
    );
  });

  it('renders the acknowledge control on an open event', () => {
    expect(src).toContain('<AcknowledgeEventButton eventId={e.id} />');
  });

  it('sorts open events to the top so a backlog stays reachable', () => {
    expect(src).toContain("nullsFirst: true");
  });
});
