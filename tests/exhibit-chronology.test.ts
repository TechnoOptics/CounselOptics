import { describe, expect, it } from 'vitest';
import {
  buildChronology,
  countByDateSource,
  parseExactCalendarDate,
  resolveExhibitDate,
  type DatableExhibit,
} from '../lib/exhibit-chronology';

/**
 * The ordering rule for a court timeline.
 *
 * Every assertion here is about a document that a judge may read. The failure
 * these tests exist to prevent is not a crash: it is a packet that prints an
 * upload timestamp in a column headed "Date", or that places an exhibit nobody
 * could date at the top of the chronology as though the top were a fact.
 */

const RECEIVED = '2026-08-08T09:30:00.000Z';

function ex(over: Partial<DatableExhibit> = {}): DatableExhibit {
  return { incidentDate: null, uploadedAt: RECEIVED, scanDates: null, scanIsReal: false, ...over };
}

describe('parseExactCalendarDate accepts only a specific day', () => {
  it('reads the four full-date shapes this product produces', () => {
    expect(parseExactCalendarDate('2026-03-04')?.iso).toBe('2026-03-04');
    expect(parseExactCalendarDate('2026-03-04T18:22:01.000Z')?.iso).toBe('2026-03-04');
    expect(parseExactCalendarDate('3/4/2026')?.iso).toBe('2026-03-04');
    expect(parseExactCalendarDate('March 4, 2026')?.iso).toBe('2026-03-04');
    expect(parseExactCalendarDate('Mar. 4 2026')?.iso).toBe('2026-03-04');
    expect(parseExactCalendarDate('4 March 2026')?.iso).toBe('2026-03-04');
  });

  it('refuses a partial date rather than inventing the missing day', () => {
    // Date.parse('January 2026') is 2026-01-01. That day was never stated by
    // the source, and on an exhibit it would be a fabricated fact.
    for (const partial of ['January 2026', '2026', 'Jan 2026', '03/2026', 'Q1 2026']) {
      expect(parseExactCalendarDate(partial)).toBeNull();
    }
  });

  it('refuses hedged and open-ended text', () => {
    for (const hedged of [
      'on or about March 2026',
      'March 4 to March 9, 2026',
      'sometime in the spring',
      'undated',
      '',
      '   ',
    ]) {
      expect(parseExactCalendarDate(hedged)).toBeNull();
    }
  });

  it('refuses a day that does not exist instead of rolling it into next month', () => {
    expect(parseExactCalendarDate('2026-02-30')).toBeNull();
    expect(parseExactCalendarDate('2026-13-01')).toBeNull();
  });

  it('orders by a timezone-independent key', () => {
    const a = parseExactCalendarDate('2026-03-04');
    const b = parseExactCalendarDate('3/5/2026');
    expect(a && b && a.sortKey < b.sortKey).toBe(true);
  });
});

describe('resolveExhibitDate prefers the event over the upload', () => {
  it('uses the date the person stated, and says so', () => {
    const r = resolveExhibitDate(ex({ incidentDate: '2026-01-05' }));
    expect(r.known && r.iso).toBe('2026-01-05');
    expect(r.source).toBe('stated');
  });

  it('falls back to a date the scan read off the document', () => {
    const r = resolveExhibitDate(
      ex({
        scanIsReal: true,
        scanDates: [
          { label: 'Payment due', value: '2026-02-14' },
          { label: 'Date issued', value: '2026-01-20' },
        ],
      }),
    );
    expect(r.known && r.iso).toBe('2026-01-20');
    expect(r.source).toBe('document');
    // The reader has to be able to check which line produced it.
    expect(r.known && r.rawLabel).toBe('Date issued');
    expect(r.known && r.rawValue).toBe('2026-01-20');
  });

  it('ignores dates from a scan that never read the file', () => {
    // A demo scan's summary literally says the document was not scanned. Any
    // date next to it is placeholder text, not evidence.
    const r = resolveExhibitDate(
      ex({ scanIsReal: false, scanDates: [{ label: 'Date issued', value: '2026-01-20' }] }),
    );
    expect(r.source).toBe('received');
  });

  it('ignores a partial document date and keeps falling back', () => {
    const r = resolveExhibitDate(
      ex({ scanIsReal: true, scanDates: [{ label: 'Filed', value: 'January 2026' }] }),
    );
    expect(r.source).toBe('received');
  });

  it('labels an upload date as a received date, never as the event', () => {
    const r = resolveExhibitDate(ex());
    expect(r.known && r.iso).toBe('2026-08-08');
    expect(r.source).toBe('received');
    expect(r.sourceLabel.toLowerCase()).toContain('not the date of the event');
  });

  it('reports no date at all rather than guessing one', () => {
    const r = resolveExhibitDate(ex({ uploadedAt: null }));
    expect(r.known).toBe(false);
    expect(r.source).toBe('unknown');
  });

  it('does not treat an unparseable incident date as a stated date', () => {
    const r = resolveExhibitDate(ex({ incidentDate: 'last summer' }));
    expect(r.source).toBe('received');
  });
});

describe('buildChronology never implies a date it does not have', () => {
  type Item = { id: string } & DatableExhibit;
  const items: Item[] = [
    { id: 'late', incidentDate: '2026-06-01', uploadedAt: RECEIVED },
    { id: 'nodate', incidentDate: null, uploadedAt: null },
    { id: 'early', incidentDate: '2026-01-01', uploadedAt: RECEIVED },
    { id: 'alsonodate', incidentDate: null, uploadedAt: 'not a date' },
  ];

  it('orders the dated items earliest first', () => {
    const c = buildChronology(items, resolveExhibitDate);
    expect(c.dated.map((e) => e.item.id)).toEqual(['early', 'late']);
  });

  /**
   * THE LOAD-BEARING ONE. An item with no known date must not appear at either
   * end of the dated list. Both ends of a chronology are claims: the top says
   * "this happened first", the bottom says "this happened last". Neither was
   * established for these items, so they come back in their own list and a
   * caller has to render them under their own heading.
   */
  it('returns undated items separately, at neither end of the dated list', () => {
    const c = buildChronology(items, resolveExhibitDate);
    const datedIds = c.dated.map((e) => e.item.id);
    expect(datedIds).not.toContain('nodate');
    expect(datedIds).not.toContain('alsonodate');
    expect(c.undated.map((e) => e.item.id)).toEqual(['nodate', 'alsonodate']);
    expect(c.undated.every((e) => e.date.known === false)).toBe(true);
  });

  it('keeps input order for items stated as the same day', () => {
    const sameDay: Item[] = [
      { id: 'second-filed', incidentDate: '2026-01-01', uploadedAt: RECEIVED },
      { id: 'first-filed', incidentDate: '2026-01-01', uploadedAt: RECEIVED },
    ];
    const c = buildChronology(sameDay, resolveExhibitDate);
    expect(c.dated.map((e) => e.item.id)).toEqual(['second-filed', 'first-filed']);
  });

  it('counts how many rows rest on an upload date', () => {
    const counts = countByDateSource(buildChronology(items, resolveExhibitDate));
    expect(counts).toEqual({ stated: 2, document: 0, received: 0, unknown: 2 });
  });

  it('an upload-dated exhibit is counted as received, not as stated', () => {
    const counts = countByDateSource(
      buildChronology([{ id: 'u', incidentDate: null, uploadedAt: RECEIVED }], resolveExhibitDate),
    );
    expect(counts.received).toBe(1);
    expect(counts.stated).toBe(0);
  });
});
