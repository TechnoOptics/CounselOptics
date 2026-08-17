import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The authorization on the employee's phone handoff, which is a set of FILTERS
 * and not a set of ifs.
 *
 * Every function under test reaches firm_mark_handoffs through the service
 * role and therefore past RLS, so what stands between one employee and
 * another's handoff is the `.eq()` chain on each statement. That makes those
 * chains the control, and a control nothing exercises is a control nobody
 * knows is still there: this repo has already found guards passing while the
 * thing they protected had been deleted.
 *
 * So the Supabase client is replaced with a recorder and the assertions are
 * about the statement that was actually built. No database, and no pretending
 * a grep over the source is a test.
 */

const calls: {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
  filters: string[];
  selected?: string;
}[] = [];

let nextResult: unknown = null;

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    const build = (call: (typeof calls)[number]) => {
      const b: Record<string, unknown> = {};
      b.eq = (c: string, v: unknown) => {
        call.filters.push(`eq ${c}=${String(v)}`);
        return b;
      };
      b.is = (c: string, v: unknown) => {
        call.filters.push(`is ${c}=${String(v)}`);
        return b;
      };
      b.not = (c: string, op: string, v: unknown) => {
        call.filters.push(`not ${c} ${op} ${String(v)}`);
        return b;
      };
      b.select = (cols: string) => {
        call.selected = cols;
        return b;
      };
      b.maybeSingle = async () => ({ data: nextResult, error: null });
      b.single = async () => ({ data: nextResult, error: null });
      return b;
    };
    return {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => {
          const call = { table, op: 'update', payload, filters: [] as string[] };
          calls.push(call);
          return build(call);
        },
        insert: (payload: Record<string, unknown>) => {
          const call = { table, op: 'insert', payload, filters: [] as string[] };
          calls.push(call);
          return build(call);
        },
        select: (cols: string) => {
          const call = {
            table,
            op: 'select',
            filters: [] as string[],
            selected: cols,
          };
          calls.push(call);
          return build(call);
        },
      }),
    };
  },
}));

const {
  collectMarkForOwner,
  createMarkHandoff,
  spendPhoneMarkAttestation,
  storeMarkForHandoff,
} = await import('../lib/mark-handoff-queries');

/** The eight bytes that begin every PNG, which is what decodeSignaturePng
 *  actually checks, plus a little body. */
const PNG = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('advottic'),
]).toString('base64')}`;

/** sha256 of those same bytes, computed the way the module computes it. */
const PNG_SHA = (await import('node:crypto'))
  .createHash('sha256')
  .update(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('advottic'),
    ]),
  )
  .digest('hex');

beforeEach(() => {
  calls.length = 0;
  nextResult = null;
});

const only = (op: string) => calls.filter((c) => c.op === op);

describe('spendPhoneMarkAttestation', () => {
  const input = {
    handoffId: 'h1',
    userId: 'u1',
    firmId: 'f1',
    templateId: 't1',
    signatureDataUrl: PNG,
  };

  it('finds its row under the caller session, not by id alone', async () => {
    nextResult = { id: 'h1' };
    expect(await spendPhoneMarkAttestation(input)).toBe(true);

    const update = only('update')[0];
    expect(update.table).toBe('firm_mark_handoffs');
    // Every one of these is load-bearing. The id is a uuid a caller supplies,
    // so on its own it proves nothing: without the user and firm filters this
    // endpoint would let one employee spend another's phone mark.
    expect(update.filters).toContain('eq id=h1');
    expect(update.filters).toContain('eq user_id=u1');
    expect(update.filters).toContain('eq firm_id=f1');
    expect(update.filters).toContain('eq template_id=t1');
  });

  /** The bytes have to be the ones the bound phone drew. */
  it('matches the submitted image against the fingerprint the phone left', async () => {
    nextResult = { id: 'h1' };
    await spendPhoneMarkAttestation(input);
    expect(only('update')[0].filters).toContain(`eq mark_sha256=${PNG_SHA}`);
  });

  it('refuses a desk that drew its own mark and named a real handoff', async () => {
    // Nothing matches a fingerprint of different bytes, so PostgREST updates
    // no row and the read-back is empty.
    nextResult = null;
    expect(await spendPhoneMarkAttestation(input)).toBe(false);
  });

  it('refuses an image that is not a PNG at all, without a statement', async () => {
    expect(
      await spendPhoneMarkAttestation({ ...input, signatureDataUrl: 'nope' }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  /** One phone mark signs one document. */
  it('spends the attestation, and only an unspent one', async () => {
    nextResult = { id: 'h1' };
    await spendPhoneMarkAttestation(input);
    const update = only('update')[0];
    expect(update.filters).toContain('is used_at=null');
    expect(update.payload?.used_at).toEqual(expect.any(String));
  });

  /**
   * PostgREST resolves with { error } and treats zero matched rows as a
   * success, so the answer to "did that update anything" is only in the
   * read-back. Without the select this function would report true for every
   * call, including the ones the filters above just rejected.
   */
  it('reads the write back rather than assuming it landed', async () => {
    nextResult = { id: 'h1' };
    await spendPhoneMarkAttestation(input);
    expect(only('update')[0].selected).toBe('id');
  });
});

describe('collectMarkForOwner', () => {
  const input = { handoffId: 'h1', userId: 'u1', firmId: 'f1' };

  it('finds the row under the caller session on BOTH of its statements', async () => {
    nextResult = { mark_png: PNG };
    expect(await collectMarkForOwner(input)).toEqual({
      mark: PNG,
      scanned: true,
      collected: false,
    });

    // The read and the claim are separate statements now (see the note on the
    // function: reading a column in the statement that nulls it returned the
    // null). That makes the scoping two chains rather than one, and a chain
    // nothing exercises is a chain somebody deletes.
    for (const call of [only('select')[0], only('update')[0]]) {
      expect(call.table).toBe('firm_mark_handoffs');
      expect(call.filters).toContain('eq id=h1');
      expect(call.filters).toContain('eq user_id=u1');
      expect(call.filters).toContain('eq firm_id=f1');
    }
  });

  it('hands it over once', async () => {
    nextResult = { mark_png: PNG };
    await collectMarkForOwner(input);
    const update = only('update')[0];
    // Two overlapping polls both read the picture; only one can satisfy this
    // filter, and the update is read back, so only one is told it has it.
    expect(update.filters).toContain('is collected_at=null');
    expect(update.payload?.collected_at).toEqual(expect.any(String));
  });

  /**
   * The image is in flight, not at rest. Both the comment on this function and
   * the migration justify holding a signature PNG in a column rather than a
   * bucket on the grounds that collection nulls it, and for a while it did
   * not: every employee signature ever handed off would have sat there with
   * nothing to sweep it. What stays behind is the fingerprint, which is all
   * the submission gate needs.
   */
  it('clears the picture on the statement that claims the row', async () => {
    nextResult = { mark_png: PNG };
    await collectMarkForOwner(input);
    expect(only('update')[0].payload).toHaveProperty('mark_png', null);
    // And reads the picture on an EARLIER statement, which is the whole fix:
    // an UPDATE ... RETURNING reports the row as it is after the update.
    expect(calls.map((c) => c.op)).toEqual(['select', 'update']);
    expect(only('update')[0].selected).toBe('id');
  });

  it('writes nothing at all when the phone has not drawn yet', async () => {
    nextResult = null;
    expect(await collectMarkForOwner(input)).toEqual({
      mark: null,
      scanned: false,
      collected: false,
    });
    // Not merely "no picture returned". A handoff that is asked about must not
    // be spent by the asking, or every poll would burn the code.
    expect(only('update')).toEqual([]);
  });

  it('never stamps a row that has no picture as collected', async () => {
    nextResult = { mark_png: PNG };
    await collectMarkForOwner(input);
    expect(only('update')[0].filters).toContain('not mark_png is null');
  });
});

describe('storeMarkForHandoff', () => {
  it('resolves its row from the token and the cookie, never from an argument', async () => {
    // No row matches the token, which is what a stranger presenting any string
    // gets. Nothing is written.
    nextResult = null;
    const res = await storeMarkForHandoff({
      rawToken: 'whatever',
      presentedSessionSecret: 'whatever',
      signatureDataUrl: PNG,
      intentAffirmedAt: null,
    });
    expect(res).toEqual({ ok: false, state: 'consumed' });
    expect(only('update')).toEqual([]);
    // The lookup was by the hash of the token and by nothing else.
    const lookup = only('select')[0];
    expect(lookup.table).toBe('firm_mark_handoffs');
    expect(lookup.filters).toHaveLength(1);
    expect(lookup.filters[0]).toMatch(/^eq token_hash=/);
    // And never by the raw token, which is not stored.
    expect(lookup.filters[0]).not.toContain('whatever');
  });
});

describe('createMarkHandoff', () => {
  it('refuses to hand out a code for a row that was not written', async () => {
    // PostgREST does not throw, so an insert that failed comes back as an
    // empty read. Reporting ok here would put a QR on screen encoding a token
    // no row will ever match, and the employee would scan it and wait.
    nextResult = null;
    expect(
      await createMarkHandoff({ firmId: 'f1', userId: 'u1', templateId: 't1' }),
    ).toEqual({ ok: false });
  });

  it('stores only the hash of the token it hands back', async () => {
    nextResult = { id: 'h1' };
    const made = await createMarkHandoff({
      firmId: 'f1',
      userId: 'u1',
      templateId: 't1',
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    const insert = only('insert')[0];
    expect(insert.payload?.firm_id).toBe('f1');
    expect(insert.payload?.user_id).toBe('u1');
    expect(insert.payload?.template_id).toBe('t1');
    // A row here is a live bearer credential for the window it stays valid, so
    // a leaked backup must not hand out a usable secret.
    expect(insert.payload?.token_hash).not.toBe(made.rawToken);
    expect(JSON.stringify(insert.payload)).not.toContain(made.rawToken);
  });
});
