import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A phone signature must not be destroyed by the act of collecting it.
 *
 * Observed in production, with the row and the browser console open at the
 * same time. firm_mark_handoffs recorded created_at 02:26:30, consumed_at
 * 02:26:48, mark_at 02:26:54 and collected_at 02:26:55, so every server step
 * ran and the mark was collected. The laptop showed no error, no signature,
 * and the QR code still on screen. The desk had been handed nothing, and
 * because the row was now stamped collected the picture could never be handed
 * over again: a signature on a legal document, gone.
 *
 * The cause is that `UPDATE ... RETURNING` reports the row as it is AFTER the
 * statement. collectMarkForOwner nulled mark_png and read mark_png back in the
 * one statement, so the read-back was the null it had just written.
 *
 * WHY THE FAKE BELOW MODELS THAT, rather than replaying a canned answer. The
 * sibling suite (tests/mark-handoff-queries.test.ts) records the statement and
 * hands back a fixed row, which is the right shape for asserting on filters and
 * is exactly why it could not see this: a recorder that answers with whatever
 * the test set cannot tell you what PostgREST would have answered. So this fake
 * holds a row, applies the update to it, and returns the post-update
 * representation the way PostgREST does. That is the whole bug.
 */

type Row = Record<string, unknown>;

/** The single firm_mark_handoffs row under test. */
let row: Row | null = null;

/** Every statement the module built, in order, for the ordering assertions. */
const statements: { op: 'select' | 'update'; payload?: Row }[] = [];

function project(source: Row, cols: string | undefined): Row {
  if (!cols) return { ...source };
  const out: Row = {};
  for (const c of cols.split(',').map((s) => s.trim())) out[c] = source[c] ?? null;
  return out;
}

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from: (_table: string) => ({
      select: (cols: string) => builder('select', undefined, cols),
      update: (payload: Row) => builder('update', payload),
      insert: () => builder('update'),
    }),
  }),
}));

function builder(op: 'select' | 'update', payload?: Row, initialCols?: string) {
  const tests: ((r: Row) => boolean)[] = [];
  let cols = initialCols;
  statements.push({ op, payload });

  const q = {
    eq(column: string, value: unknown) {
      tests.push((r) => r[column] === value);
      return q;
    },
    is(column: string, value: unknown) {
      tests.push((r) => (r[column] ?? null) === value);
      return q;
    },
    not(column: string, _op: string, _value: unknown) {
      // The only form the module uses is `.not(col, 'is', null)`.
      tests.push((r) => (r[column] ?? null) !== null);
      return q;
    },
    select(c: string) {
      cols = c;
      return q;
    },
    async maybeSingle() {
      const matched = row && tests.every((t) => t(row as Row)) ? row : null;
      if (!matched) return { data: null, error: null };
      if (op === 'select') return { data: project(matched, cols), error: null };
      // PostgREST returns the row as it is AFTER the update, which is the
      // whole point of this fake.
      Object.assign(matched, payload ?? {});
      return { data: project(matched, cols), error: null };
    },
  };
  return q;
}

const { collectMarkForOwner } = await import('../lib/mark-handoff-queries');

const OWNER = { handoffId: 'h1', userId: 'u1', firmId: 'f1' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A handoff whose phone has scanned the code and drawn a signature. */
function drawn(): Row {
  return {
    id: 'h1',
    user_id: 'u1',
    firm_id: 'f1',
    consumed_at: '2026-08-16T02:26:48.000Z',
    mark_png: PNG,
    mark_sha256: 'abc',
    mark_at: '2026-08-16T02:26:54.000Z',
    collected_at: null,
  };
}

beforeEach(() => {
  row = null;
  statements.length = 0;
});

describe('collecting the mark the phone drew', () => {
  it('hands the desk the picture, not the null it just wrote over it', async () => {
    row = drawn();
    const res = await collectMarkForOwner(OWNER);
    expect(res.mark).toBe(PNG);
  });

  it('leaves the mark collectable when the collection hands back nothing', async () => {
    // The invariant. collected_at is what makes a mark unreachable forever, so
    // it may only be stamped on a call that actually carried the picture out.
    // Reproduces the production loss directly: the first poll came back empty
    // and the second could never succeed.
    row = drawn();
    const first = await collectMarkForOwner(OWNER);
    if (!first.mark) {
      const second = await collectMarkForOwner(OWNER);
      expect(
        second.mark,
        'the first collection returned no mark and destroyed it anyway',
      ).toBe(PNG);
    }
    expect(row.collected_at, 'stamped collected while returning no mark').not.toBeNull();
  });

  it('hands it over once', async () => {
    row = drawn();
    expect((await collectMarkForOwner(OWNER)).mark).toBe(PNG);
    // A second poll, or a second tab, must not be given the picture again, and
    // the image must not stay at rest in the column afterwards.
    expect((await collectMarkForOwner(OWNER)).mark).toBe(null);
    expect(row.mark_png).toBe(null);
    expect(row.collected_at).toEqual(expect.any(String));
  });

  it('reports the code as scanned while the phone is still drawing', async () => {
    // consumed_at without mark_at: somebody is signing on their phone right
    // now. The desk needs this to stop showing a code that can no longer be
    // scanned by anybody.
    row = { ...drawn(), mark_png: null, mark_sha256: null, mark_at: null };
    const res = await collectMarkForOwner(OWNER);
    expect(res).toEqual({ mark: null, markAt: null, scanned: true, collected: false });
    // And nothing was written: an unscanned, undrawn handoff is not spent by
    // being asked about.
    expect(statements.filter((s) => s.op === 'update')).toEqual([]);
  });

  it('says nothing has happened before the code is scanned', async () => {
    row = { ...drawn(), consumed_at: null, mark_png: null, mark_at: null };
    expect(await collectMarkForOwner(OWNER)).toEqual({
      mark: null,
      markAt: null,
      scanned: false,
      collected: false,
    });
  });

  it('reports a row it can never collect from again, rather than a shrug', async () => {
    // The state the production row was left in. Whatever put it there, the
    // desk asking about it is a signature that went missing, and the client
    // logs it rather than polling on in silence.
    row = { ...drawn(), mark_png: null, collected_at: '2026-08-16T02:26:55.000Z' };
    const res = await collectMarkForOwner(OWNER);
    expect(res.mark).toBe(null);
    expect(res.collected).toBe(true);
  });

  it('finds its row under the caller session and never by id alone', async () => {
    row = drawn();
    expect((await collectMarkForOwner({ ...OWNER, userId: 'someone-else' })).mark).toBe(
      null,
    );
    expect((await collectMarkForOwner({ ...OWNER, firmId: 'another-firm' })).mark).toBe(
      null,
    );
    // Untouched by either attempt.
    expect(row.mark_png).toBe(PNG);
    expect(row.collected_at).toBe(null);
  });
});
