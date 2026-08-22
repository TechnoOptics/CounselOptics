import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXHIBIT_EDITABLE_COLUMNS,
  EXHIBIT_IMMUTABLE_COLUMNS,
  MAX_EXHIBIT_DESCRIPTION,
  MAX_EXHIBIT_SOURCE,
  WITHDRAWN_COLUMN_MISSING_ERROR,
  activeExhibits,
  buildExhibitDetailsPatch,
  isExhibitWithdrawn,
  normalizeExhibitDetails,
  resolveWithdrawnColumnFallback,
  withdrawConfirmLines,
  withdrawnExhibits,
} from '../lib/exhibit-withdrawal';
import { buildChronology, resolveExhibitDate } from '../lib/exhibit-chronology';

/**
 * The pure half of editing and withdrawing an exhibit.
 *
 * Everything a wrong answer here could put in front of a judge is asserted on
 * a value, not on a rendered page: which columns a details edit may write,
 * whether a withdrawn exhibit is still in a packet's input, and whether a date
 * typed as the 5th is still the 5th when it is printed in a US timezone.
 */

describe('withdrawal state', () => {
  it('reads an absent column as not withdrawn', () => {
    // This is the pre-migration case and it has to be the safe one. A database
    // without exhibits.withdrawn_at returns no field at all, and nothing on
    // such a database can have been withdrawn.
    expect(isExhibitWithdrawn({})).toBe(false);
    expect(isExhibitWithdrawn({ withdrawnAt: null })).toBe(false);
    expect(isExhibitWithdrawn({ withdrawnAt: '' })).toBe(false);
    expect(isExhibitWithdrawn({ withdrawnAt: '   ' })).toBe(false);
    expect(isExhibitWithdrawn(null)).toBe(false);
    expect(isExhibitWithdrawn(undefined)).toBe(false);
  });

  it('reads a timestamp as withdrawn', () => {
    expect(isExhibitWithdrawn({ withdrawnAt: '2026-08-22T10:00:00.000Z' })).toBe(true);
  });

  it('splits a list without reordering either half', () => {
    const list = [
      { id: 'a' },
      { id: 'b', withdrawnAt: '2026-08-22T10:00:00.000Z' },
      { id: 'c' },
      { id: 'd', withdrawnAt: '2026-08-01T10:00:00.000Z' },
      { id: 'e' },
    ];
    expect(activeExhibits(list).map((e) => e.id)).toEqual(['a', 'c', 'e']);
    expect(withdrawnExhibits(list).map((e) => e.id)).toEqual(['b', 'd']);
  });
});

describe('a withdrawn exhibit is not on the chronology', () => {
  /**
   * The chronology is the ordered list a court timeline is built from. This
   * asserts the join between the two modules on real shapes: filter first,
   * then build. The duplicate that prompted the feature is the second copy of
   * a July statement, so that is what is withdrawn here.
   */
  const exhibits = [
    { id: 'p', label: 'Exhibit P', incidentDate: '2026-07-01', withdrawnAt: null },
    {
      id: 's',
      label: 'Exhibit S',
      incidentDate: '2026-07-01',
      withdrawnAt: '2026-08-22T10:00:00.000Z',
    },
    { id: 't', label: 'Exhibit T', incidentDate: '2026-07-09', withdrawnAt: null },
  ];

  it('leaves the withdrawn copy out of the dated rows', () => {
    const chron = buildChronology(activeExhibits(exhibits), (e) =>
      resolveExhibitDate({ incidentDate: e.incidentDate, uploadedAt: null }),
    );
    expect(chron.dated.map((d) => d.item.label)).toEqual(['Exhibit P', 'Exhibit T']);
    expect(chron.undated).toHaveLength(0);
  });

  it('does not park it in the undated list instead', () => {
    // Filtering, not re-dating. An exhibit dropped into `undated` would still
    // be printed on the packet under its own heading.
    const chron = buildChronology(activeExhibits(exhibits), (e) =>
      resolveExhibitDate({ incidentDate: e.incidentDate, uploadedAt: null }),
    );
    const all = [...chron.dated, ...chron.undated].map((d) => d.item.id);
    expect(all).not.toContain('s');
  });

  it('keeps the labels of the exhibits that remain', () => {
    // The whole reason withdrawal is not a delete. P stays P and T stays T.
    const kept = activeExhibits(exhibits).map((e) => e.label);
    expect(kept).toEqual(['Exhibit P', 'Exhibit T']);
  });
});

describe('what an edit is allowed to write', () => {
  const patch = buildExhibitDetailsPatch({
    description: 'The July statement',
    incidentDate: '2026-07-01',
    source: 'Bank portal',
    category: 'Document',
  });

  it('writes exactly the four detail columns and nothing else', () => {
    expect(Object.keys(patch).sort()).toEqual(
      [...EXHIBIT_EDITABLE_COLUMNS].sort(),
    );
  });

  it('never names a column that carries the evidence or the label', () => {
    // Named one at a time rather than as a set difference, so a failure says
    // which column got in.
    for (const column of EXHIBIT_IMMUTABLE_COLUMNS) {
      expect(Object.keys(patch)).not.toContain(column);
    }
  });

  it('lists the bytes and the label among the columns it must never write', () => {
    // Guards the guard: if EXHIBIT_IMMUTABLE_COLUMNS were emptied, the loop
    // above would pass over nothing.
    for (const column of [
      'label',
      'storage_path',
      'file_name',
      'file_size',
      'file_type',
      'scan_data',
    ]) {
      expect(EXHIBIT_IMMUTABLE_COLUMNS as readonly string[]).toContain(column);
    }
  });

  it('carries a cleared field through as null rather than dropping the key', () => {
    // A dropped key would leave the old value in place while the person is
    // looking at an empty box they just cleared.
    const cleared = buildExhibitDetailsPatch({
      description: '',
      incidentDate: null,
      source: null,
      category: null,
    });
    expect(Object.keys(cleared).sort()).toEqual([...EXHIBIT_EDITABLE_COLUMNS].sort());
    expect(cleared.incident_date).toBeNull();
    expect(cleared.source).toBeNull();
    expect(cleared.category).toBeNull();
    expect(cleared.description).toBe('');
  });
});

describe('normalizing what came off the form', () => {
  it('trims and keeps the four details', () => {
    const r = normalizeExhibitDetails({
      description: '  The July statement  ',
      incidentDate: '2026-07-01',
      source: '  Bank portal ',
      category: 'Document',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      description: 'The July statement',
      incidentDate: '2026-07-01',
      source: 'Bank portal',
      category: 'Document',
    });
  });

  it('accepts the US date form the rest of the product uses', () => {
    const r = normalizeExhibitDetails({ incidentDate: '3/5/2026' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.incidentDate).toBe('2026-03-05');
  });

  it('refuses a date that does not name one specific day', () => {
    // "July 2026" would otherwise become 2026-07-01 through Date.parse, which
    // invents a day the person never stated onto a legal exhibit.
    for (const bad of ['July 2026', '2026', 'on or about March', '2026-02-30']) {
      const r = normalizeExhibitDetails({ incidentDate: bad });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toContain('Nothing was changed');
    }
  });

  it('treats an empty date as no date rather than as an error', () => {
    const r = normalizeExhibitDetails({ incidentDate: '   ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.incidentDate).toBeNull();
  });

  it('refuses a category that is not on the list', () => {
    const r = normalizeExhibitDetails({ category: 'Anything' });
    expect(r.ok).toBe(false);
  });

  it('lets an exhibit keep a category it already has', () => {
    // Otherwise a legacy value would block an unrelated description fix and
    // the person would have no way to tell why.
    const r = normalizeExhibitDetails({
      category: 'Legacy value',
      currentCategory: 'Legacy value',
    });
    expect(r.ok).toBe(true);
  });

  it('refuses text past the limits and says nothing was changed', () => {
    const long = normalizeExhibitDetails({
      description: 'x'.repeat(MAX_EXHIBIT_DESCRIPTION + 1),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain('Nothing was changed');

    const src = normalizeExhibitDetails({ source: 'y'.repeat(MAX_EXHIBIT_SOURCE + 1) });
    expect(src.ok).toBe(false);
  });
});

describe('a stated date keeps its day in a United States timezone', () => {
  /**
   * The failure this pins: a date typed as the 5th printing as the 4th.
   *
   * `new Date('2026-03-05')` is midnight UTC, and midnight UTC formatted in
   * any zone behind UTC is the previous day. lib/format pins a date-only
   * string to UTC for exactly this reason, so the value that reaches it has to
   * STAY date-only: a normalizer that returned '2026-03-05T00:00:00.000Z'
   * would look identical in a log and print a day early on the packet.
   *
   * The host timezone is not pinned by this suite, so it is set here and put
   * back afterwards, and lib/format is imported after the change so none of
   * its memoized formatters can have been built under the host's zone.
   */
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Chicago';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('proves the timezone is actually in effect', () => {
    // A positive control. Without it, a test environment that ignored TZ would
    // pass every assertion below while proving nothing.
    const naive = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date('2026-03-05'));
    expect(naive).toBe('Mar 4, 2026');
  });

  it('reads back as the fifth, all the way to the printed page', async () => {
    const normalized = normalizeExhibitDetails({ incidentDate: '2026-03-05' });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const stored = buildExhibitDetailsPatch(normalized.value).incident_date;
    expect(stored).toBe('2026-03-05');

    const resolved = resolveExhibitDate({ incidentDate: stored, uploadedAt: null });
    expect(resolved.known).toBe(true);
    if (!resolved.known) return;
    expect(resolved.iso).toBe('2026-03-05');

    const { formatDate, formatDateLong, formatDateNumeric } = await import(
      '../lib/format'
    );
    expect(formatDate(resolved.iso)).toBe('Mar 5, 2026');
    expect(formatDateLong(resolved.iso)).toBe('March 5, 2026');
    expect(formatDateNumeric(resolved.iso)).toBe('3/5/2026');
  });

  it('holds on New Year, where a shift also changes the year', async () => {
    const normalized = normalizeExhibitDetails({ incidentDate: '2026-01-01' });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const { formatDateLong } = await import('../lib/format');
    expect(formatDateLong(normalized.value.incidentDate as string)).toBe(
      'January 1, 2026',
    );
  });
});

describe('a database without the column yet', () => {
  it('refuses the withdrawal rather than reporting one that did not happen', () => {
    for (const code of ['PGRST204', '42703']) {
      expect(
        resolveWithdrawnColumnFallback({
          error: { code, message: "Could not find the 'withdrawn_at' column" },
        }),
      ).toBe('abort-not-withdrawn');
    }
  });

  it('does not mistake a different missing column for this one', () => {
    expect(
      resolveWithdrawnColumnFallback({
        error: { code: 'PGRST204', message: "Could not find the 'delivery_mode' column" },
      }),
    ).toBe('surface-error');
  });

  it('leaves every other failure to the caller', () => {
    expect(resolveWithdrawnColumnFallback({ error: null })).toBe('surface-error');
    expect(
      resolveWithdrawnColumnFallback({
        error: { code: '42501', message: 'permission denied for table exhibits' },
      }),
    ).toBe('surface-error');
  });

  it('says plainly that the exhibit is still in the packet', () => {
    expect(WITHDRAWN_COLUMN_MISSING_ERROR).toContain('was not withdrawn');
    expect(WITHDRAWN_COLUMN_MISSING_ERROR).toContain('still');
    expect(WITHDRAWN_COLUMN_MISSING_ERROR).toContain('packet');
  });
});

describe('the confirm a person reads before withdrawing', () => {
  const lines = withdrawConfirmLines('Exhibit K');

  it('says the file is not deleted and the label is kept', () => {
    const all = lines.join(' ');
    expect(all).toContain('keeps its label');
    expect(all).toContain('not deleted');
  });

  it('names what it does change', () => {
    const all = lines.join(' ');
    expect(all).toContain('packet');
    expect(all).toContain('chronology');
  });

  it('says it can be undone', () => {
    expect(lines.join(' ')).toContain('put it back');
  });

  it('names the exhibit the person clicked', () => {
    expect(lines[0]).toContain('Exhibit K');
  });

  it('carries no dash characters that this codebase forbids', () => {
    // Positive control first, so a sweep that matched nothing cannot pass.
    expect(/[–—]/.test('a — b')).toBe(true);
    for (const line of lines) expect(/[–—]/.test(line)).toBe(false);
    expect(/[–—]/.test(WITHDRAWN_COLUMN_MISSING_ERROR)).toBe(false);
  });
});
