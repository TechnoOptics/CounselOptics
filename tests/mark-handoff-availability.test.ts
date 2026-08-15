import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUnknownTableError } from '../lib/signer-view';

/**
 * Whether the phone handoff exists at all, which is a different question from
 * whether the firm allows it.
 *
 * 20260815_mark_handoffs.sql is unapplied, so firm_mark_handoffs is absent in
 * production while every line of code that uses it is deployed. The surface
 * decided whether to offer the phone from firm_templates.signature_methods,
 * and that column is ALSO absent, which reads as "no restriction recorded"
 * and therefore as "the phone is allowed". A fail-open default meant for
 * "which methods may be used" was answering "does this feature exist", so the
 * form offered a route the server could not honour.
 *
 * This file covers the probe that answers the second question on its own, and
 * the error classification it rests on.
 */

const state: {
  error: { code?: string; message?: string } | null;
  throws: boolean;
  admin: boolean;
  tables: string[];
} = { error: null, throws: false, admin: true, tables: [] };

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    if (!state.admin) return null;
    return {
      from: (table: string) => {
        state.tables.push(table);
        const result = async () => {
          if (state.throws) throw new Error('socket hang up');
          return { data: state.error ? null : [], error: state.error };
        };
        return {
          select: () => ({ limit: result }),
          insert: () => ({
            select: () => ({
              maybeSingle: async () => {
                if (state.throws) throw new Error('socket hang up');
                return {
                  data: state.error ? null : { id: 'h1' },
                  error: state.error,
                };
              },
            }),
          }),
        };
      },
    };
  },
}));

const { createMarkHandoff, markHandoffFeatureAvailable } = await import(
  '../lib/mark-handoff-queries'
);

beforeEach(() => {
  state.error = null;
  state.throws = false;
  state.admin = true;
  state.tables = [];
});

const errors: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors.length = 0;
  spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
});
afterEach(() => spy.mockRestore());

describe('isUnknownTableError', () => {
  it('recognises the Postgres undefined_table code for the named table', () => {
    expect(
      isUnknownTableError(
        {
          code: '42P01',
          message: 'relation "public.firm_mark_handoffs" does not exist',
        },
        'firm_mark_handoffs',
      ),
    ).toBe(true);
  });

  it("recognises PostgREST's own missing-table code", () => {
    expect(
      isUnknownTableError(
        {
          code: 'PGRST205',
          message:
            "Could not find the table 'public.firm_mark_handoffs' in the schema cache",
        },
        'firm_mark_handoffs',
      ),
    ).toBe(true);
  });

  it('does not read a different table going missing as this one', () => {
    expect(
      isUnknownTableError(
        { code: '42P01', message: 'relation "public.firm_widgets" does not exist' },
        'firm_mark_handoffs',
      ),
    ).toBe(false);
  });

  it('is not a missing COLUMN, which is a different recovery', () => {
    expect(
      isUnknownTableError(
        {
          code: '42703',
          message: 'column firm_mark_handoffs.mark_png does not exist',
        },
        'firm_mark_handoffs',
      ),
    ).toBe(false);
  });

  it('is false for no error at all', () => {
    expect(isUnknownTableError(null, 'firm_mark_handoffs')).toBe(false);
    expect(isUnknownTableError(undefined, 'firm_mark_handoffs')).toBe(false);
  });
});

describe('markHandoffFeatureAvailable', () => {
  it('is false when the table has not been created yet', async () => {
    state.error = {
      code: '42P01',
      message: 'relation "public.firm_mark_handoffs" does not exist',
    };
    await expect(markHandoffFeatureAvailable()).resolves.toBe(false);
    expect(state.tables).toEqual(['firm_mark_handoffs']);
  });

  it('is false when PostgREST has never seen the table', async () => {
    state.error = {
      code: 'PGRST205',
      message:
        "Could not find the table 'public.firm_mark_handoffs' in the schema cache",
    };
    await expect(markHandoffFeatureAvailable()).resolves.toBe(false);
  });

  it('is true once the table is there', async () => {
    await expect(markHandoffFeatureAvailable()).resolves.toBe(true);
  });

  /**
   * The offer is only made when it can be honoured, so a probe that could not
   * establish anything is not an offer. The pad on the same page is untouched.
   */
  it('is false when the probe itself failed for some other reason', async () => {
    state.error = { code: '08006', message: 'connection failure' };
    await expect(markHandoffFeatureAvailable()).resolves.toBe(false);
  });

  it('does not throw when the client does', async () => {
    state.throws = true;
    await expect(markHandoffFeatureAvailable()).resolves.toBe(false);
  });

  it('is false with no service-role client to probe with', async () => {
    state.admin = false;
    await expect(markHandoffFeatureAvailable()).resolves.toBe(false);
  });

  it('leaves an operator something to quote when the table is missing', async () => {
    state.error = {
      code: '42P01',
      message: 'relation "public.firm_mark_handoffs" does not exist',
    };
    await markHandoffFeatureAvailable();
    const line = errors.join('\n');
    expect(line).toContain('[mark-handoff]');
    expect(line).toContain('20260815_mark_handoffs.sql');
    expect(line).toContain('42P01');
  });

  it('says which code came back when the probe failed some other way', async () => {
    state.error = { code: '08006', message: 'connection failure' };
    await markHandoffFeatureAvailable();
    const line = errors.join('\n');
    expect(line).toContain('[mark-handoff]');
    expect(line).toContain('08006');
  });

  /** Nothing to report on the ordinary path. */
  it('logs nothing when the table is there', async () => {
    await markHandoffFeatureAvailable();
    expect(errors).toEqual([]);
  });
});

/**
 * The probe should mean nobody ever gets here with the table missing, but a
 * refused mint is the last thing an operator can see before an employee is
 * told the phone is unavailable, and it used to say nothing at all.
 */
describe('a mint that could not write its row', () => {
  const owner = { firmId: 'f1', userId: 'u1', templateId: 't1' };

  it('reports the database code rather than failing quietly', async () => {
    state.error = { code: '42P01', message: 'relation "x" does not exist' };
    await expect(createMarkHandoff(owner)).resolves.toEqual({ ok: false });
    const line = errors.join('\n');
    expect(line).toContain('[mark-handoff]');
    expect(line).toContain('42P01');
  });

  it('says nothing on a mint that worked', async () => {
    await expect(createMarkHandoff(owner)).resolves.toMatchObject({
      ok: true,
      handoffId: 'h1',
    });
    expect(errors).toEqual([]);
  });
});
