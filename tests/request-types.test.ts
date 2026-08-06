import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEEDED_REQUEST_TYPES,
  employeeRequestTypes,
  firmRequestTypes,
  requestTypesForMode,
  resolveRequestType,
  type FirmRequestType,
} from '../lib/request-types';

/**
 * The employee Hub renders these as clickable tiles, so each rule here
 * is load-bearing on what a firm's staff are shown:
 *
 *  - a 'client' type in an employee's grid offers them an outside-client
 *    matter they have no business filing;
 *  - a hidden type is one the firm deliberately retired;
 *  - the order is the firm's own, and it is what keeps the canonical
 *    twelve ahead of partner-app slugs.
 */

const t = (
  key: string,
  mode: 'client' | 'inhouse',
  sortOrder: number,
  hidden = false,
): FirmRequestType => ({ key, label: key.toUpperCase(), mode, sortOrder, hidden });

describe('requestTypesForMode', () => {
  it('drops client-mode types from the employee list', () => {
    const rows = [t('matter', 'client', 0), t('nda', 'inhouse', 5)];
    expect(requestTypesForMode(rows, 'inhouse').map((r) => r.key)).toEqual([
      'nda',
    ]);
  });

  it('drops hidden types', () => {
    const rows = [t('nda', 'inhouse', 5), t('retired', 'inhouse', 6, true)];
    expect(requestTypesForMode(rows, 'inhouse').map((r) => r.key)).toEqual([
      'nda',
    ]);
  });

  it('orders by sort_order, so the seeded twelve precede partner slugs', () => {
    const rows = [
      t('partner-slug', 'inhouse', 101),
      t('other', 'inhouse', 11),
      t('contract', 'inhouse', 1),
    ];
    expect(requestTypesForMode(rows, 'inhouse').map((r) => r.key)).toEqual([
      'contract',
      'other',
      'partner-slug',
    ]);
  });

  it('breaks a sort_order tie on label so the order is stable', () => {
    const rows = [t('zebra', 'inhouse', 101), t('alpha', 'inhouse', 101)];
    expect(requestTypesForMode(rows, 'inhouse').map((r) => r.key)).toEqual([
      'alpha',
      'zebra',
    ]);
  });

  it('leaves exactly one client-mode type in the seeded defaults', () => {
    // The fallback list stands in for the live table when it cannot be
    // read, so it has to obey the same shape: New case / matter is the
    // only outside-client type, and the employee never sees it.
    const employee = requestTypesForMode(SEEDED_REQUEST_TYPES, 'inhouse');
    expect(SEEDED_REQUEST_TYPES).toHaveLength(12);
    expect(employee).toHaveLength(11);
    expect(employee.some((r) => r.key === 'new_case_matter')).toBe(false);
  });
});

describe('resolveRequestType', () => {
  const types = requestTypesForMode(SEEDED_REQUEST_TYPES, 'inhouse');

  it('resolves the label a tile links with', () => {
    expect(resolveRequestType(types, 'NDA review')?.key).toBe('nda_review');
  });

  it('resolves a key, so an older link still opens the right form', () => {
    expect(resolveRequestType(types, 'nda_review')?.label).toBe('NDA review');
  });

  it('returns null for a missing or unrecognised parameter', () => {
    expect(resolveRequestType(types, undefined)).toBeNull();
    expect(resolveRequestType(types, '  ')).toBeNull();
    expect(resolveRequestType(types, 'anything at all')).toBeNull();
  });

  it('never resolves a client-mode type from an employee list', () => {
    expect(resolveRequestType(types, 'New case / matter')).toBeNull();
  });

  // A repeated query key (`?type=a&type=b`) arrives as an array. This
  // used to call .trim() on it and throw, and a server component that
  // throws is a 500 with no fallback - the exact outcome this function
  // exists to prevent.
  it('takes the first value when the query key is repeated', () => {
    expect(resolveRequestType(types, ['NDA review', 'nonsense'])?.key).toBe(
      'nda_review',
    );
  });

  it('returns null rather than throwing on an empty or junk array', () => {
    expect(resolveRequestType(types, [])).toBeNull();
    expect(resolveRequestType(types, ['nonsense', 'NDA review'])).toBeNull();
  });
});

/**
 * A stub that answers the one query firmRequestTypes makes. Typed
 * through `unknown` because the real client's surface is enormous and
 * none of the rest of it is reachable from here.
 */
function stubAdmin(result: {
  data?: unknown[] | null;
  error?: { message: string } | null;
}): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: result.data ?? null, error: result.error ?? null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const ROW = {
  key: 'nda_review',
  label: 'NDA review',
  mode: 'inhouse',
  sort_order: 5,
  hidden: false,
};

describe('firmRequestTypes', () => {
  let errors: string[];
  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('maps snake_case columns onto the camelCase row shape', async () => {
    const rows = await firmRequestTypes(stubAdmin({ data: [ROW] }), 'firm-1');
    expect(rows).toEqual([
      { key: 'nda_review', label: 'NDA review', mode: 'inhouse', sortOrder: 5, hidden: false },
    ]);
    expect(errors).toEqual([]);
  });

  /*
   * The safety-relevant line in the file. A row whose mode is NULL or
   * unrecognised is DROPPED, never guessed at, because the only guess
   * available ('inhouse', the majority value) is the guess that puts an
   * unclassified row in front of every employee in the firm. The
   * form-builder branch coerces instead; see the note in the module
   * header.
   */
  it.each([null, undefined, 'internal', '', 42])(
    'drops a row whose mode is %p rather than guessing inhouse',
    async (mode) => {
      const rows = await firmRequestTypes(
        stubAdmin({ data: [{ ...ROW, mode }, { ...ROW, key: 'ok' }] }),
        'firm-1',
      );
      expect(rows.map((r) => r.key)).toEqual(['ok']);
    },
  );

  it('drops a row with no key or no label', async () => {
    const rows = await firmRequestTypes(
      stubAdmin({
        data: [{ ...ROW, key: '  ' }, { ...ROW, label: null }, { ...ROW, key: 'ok' }],
      }),
      'firm-1',
    );
    expect(rows.map((r) => r.key)).toEqual(['ok']);
  });

  it('defaults a non-numeric sort_order to 0 and treats a non-true hidden as visible', async () => {
    const rows = await firmRequestTypes(
      stubAdmin({ data: [{ ...ROW, sort_order: null, hidden: null }] }),
      'firm-1',
    );
    expect(rows[0].sortOrder).toBe(0);
    expect(rows[0].hidden).toBe(false);
  });

  it('falls back to the seeded defaults with no client at all', async () => {
    expect(await firmRequestTypes(null, 'firm-1')).toEqual(SEEDED_REQUEST_TYPES);
  });

  // The three fallback paths look identical on screen. They must not
  // look identical in the log, or the only way to tell a broken table
  // from a misconfigured firm is to go and query the database by hand.
  it('logs a failed read distinctly from an empty table', async () => {
    await firmRequestTypes(stubAdmin({ error: { message: 'boom' } }), 'firm-1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('could not read');
    expect(errors[0]).toContain('boom');

    errors.length = 0;
    await firmRequestTypes(stubAdmin({ data: [] }), 'firm-1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no rows');
  });

  it('logs distinctly again when every row failed validation', async () => {
    const rows = await firmRequestTypes(
      stubAdmin({ data: [{ ...ROW, mode: 'nonsense' }] }),
      'firm-1',
    );
    expect(rows).toEqual(SEEDED_REQUEST_TYPES);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('failed validation');
  });
});

describe('employeeRequestTypes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies the three rules to whatever the table returned', async () => {
    const rows = await employeeRequestTypes(
      stubAdmin({
        data: [
          { ...ROW, key: 'partner', label: 'Partner slug', sort_order: 101 },
          { ...ROW, key: 'client_matter', mode: 'client', sort_order: 0 },
          { ...ROW, key: 'retired', hidden: true, sort_order: 1 },
          ROW,
        ],
      }),
      'firm-1',
    );
    expect(rows.map((r) => r.key)).toEqual(['nda_review', 'partner']);
  });
});
