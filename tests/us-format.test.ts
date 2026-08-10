import { describe, expect, it } from 'vitest';

import {
  US_LOCALE,
  formatDate,
  formatDateLong,
  formatDateNumeric,
  formatDateShort,
  formatDateTime,
  formatDateTimeLong,
  formatDateTimeNumeric,
  formatDateTimeShort,
  formatDateWith,
  formatDistanceFromMeters,
  formatMonthYear,
  formatNumber,
  formatNumberWith,
  formatTime,
  formatTimeWithSeconds,
  formatUsdFromCents,
  formatUsdFromDollars,
  milesFromKm,
} from '../lib/format';

// Noon UTC keeps the calendar day identical in every US time zone
// (UTC-4 through UTC-10), so a date-only assertion is stable wherever
// the suite runs.
const MAR_4 = '2026-03-04T12:00:00.000Z';

describe('locale pin', () => {
  it('pins en-US', () => {
    expect(US_LOCALE).toBe('en-US');
  });
});

describe('dates render month-first, never day-first', () => {
  it('formatDateNumeric renders 3/4/2026, not 4/3/2026', () => {
    expect(formatDateNumeric(MAR_4)).toBe('3/4/2026');
  });

  it('formatDate renders an unambiguous abbreviated month', () => {
    expect(formatDate(MAR_4)).toBe('Mar 4, 2026');
  });

  it('formatDateLong spells the month out', () => {
    expect(formatDateLong(MAR_4)).toBe('March 4, 2026');
  });

  it('formatDateShort drops the year', () => {
    expect(formatDateShort(MAR_4)).toBe('Mar 4');
  });

  it('formatMonthYear renders month and year only', () => {
    expect(formatMonthYear(MAR_4)).toBe('March 2026');
  });

  it('accepts a Date and a millisecond number as well as an ISO string', () => {
    expect(formatDate(new Date(MAR_4))).toBe('Mar 4, 2026');
    expect(formatDate(Date.parse(MAR_4))).toBe('Mar 4, 2026');
  });
});

describe('times are 12-hour with AM/PM, never 24-hour', () => {
  it('formatTime renders an afternoon hour with PM', () => {
    expect(formatTime(MAR_4, { timeZone: 'UTC' })).toBe('12:00 PM');
  });

  it('formatTime renders a morning hour with AM and no leading zero', () => {
    expect(formatTime('2026-03-04T09:05:00.000Z', { timeZone: 'UTC' })).toBe(
      '9:05 AM',
    );
  });

  it('formatTimeWithSeconds keeps the seconds and the meridiem', () => {
    expect(
      formatTimeWithSeconds('2026-03-04T15:04:05.000Z', { timeZone: 'UTC' }),
    ).toBe('3:04:05 PM');
  });

  it('formatDateTime pairs a US date with a 12-hour clock', () => {
    expect(formatDateTime(MAR_4, { timeZone: 'UTC' })).toBe(
      'Mar 4, 2026, 12:00 PM',
    );
  });

  it('formatDateTimeShort drops the year', () => {
    expect(formatDateTimeShort(MAR_4, { timeZone: 'UTC' })).toBe(
      'Mar 4, 12:00 PM',
    );
  });

  it('formatDateTimeNumeric renders month-first with AM/PM', () => {
    expect(formatDateTimeNumeric(MAR_4, { timeZone: 'UTC' })).toBe(
      '3/4/2026, 12:00:00 PM',
    );
  });

  it('formatDateTimeLong leads with the weekday', () => {
    expect(formatDateTimeLong(MAR_4, { timeZone: 'UTC' })).toBe(
      'Wednesday, March 4, 2026 at 12:00 PM',
    );
  });
});

describe('unusable input renders blank, never "Invalid Date"', () => {
  for (const bad of [null, undefined, '', 'not a date', Number.NaN]) {
    it(`returns '' for ${JSON.stringify(bad)}`, () => {
      expect(formatDate(bad as never)).toBe('');
      expect(formatDateTime(bad as never)).toBe('');
      expect(formatTime(bad as never)).toBe('');
    });
  }
});

describe('numbers group with commas', () => {
  it('groups thousands the US way', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('returns blank for a non-finite value', () => {
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(null)).toBe('');
  });

  it('formatNumberWith honours explicit options', () => {
    expect(formatNumberWith(0.5, { style: 'percent' })).toBe('50%');
  });
});

describe('money is USD with US grouping', () => {
  it('formats cents as grouped dollars', () => {
    expect(formatUsdFromCents(123456)).toBe('$1,234.56');
  });

  it('groups a large amount rather than running the digits together', () => {
    expect(formatUsdFromCents(1_000_000_00)).toBe('$1,000,000.00');
  });

  it('formats a negative amount', () => {
    expect(formatUsdFromCents(-2500)).toBe('-$25.00');
  });

  it('formats dollars directly', () => {
    expect(formatUsdFromDollars(1234.5)).toBe('$1,234.50');
  });

  it('returns blank for a non-finite amount', () => {
    expect(formatUsdFromCents(Number.NaN)).toBe('');
    expect(formatUsdFromCents(null)).toBe('');
  });
});

describe('distance is US customary, never metric', () => {
  it('renders short distances in feet', () => {
    expect(formatDistanceFromMeters(30)).toBe('98 ft');
  });

  it('switches to miles at about a tenth of a mile', () => {
    expect(formatDistanceFromMeters(1609.344)).toBe('1.0 mi');
  });

  it('keeps two decimals for a close-in mile reading', () => {
    expect(formatDistanceFromMeters(500)).toBe('0.31 mi');
  });

  it('picks the decimal count from the rounded value, not the raw one', () => {
    // 1609 m is 0.99979 mi. Choosing the precision from the raw value
    // renders "1.00 mi" here and "1.0 mi" one metre later.
    expect(formatDistanceFromMeters(1609)).toBe('1.0 mi');
  });

  it('drops to one decimal once the distance is long', () => {
    expect(formatDistanceFromMeters(80467.2)).toBe('50.0 mi');
  });

  it('groups a very long distance', () => {
    expect(formatDistanceFromMeters(1609344 * 2)).toBe('2,000.0 mi');
  });

  it('never renders the string "km"', () => {
    for (const m of [0, 1, 99, 1000, 5000, 100000]) {
      expect(formatDistanceFromMeters(m)).not.toMatch(/km|\bm\b/);
    }
  });

  it('returns blank for a non-finite distance', () => {
    expect(formatDistanceFromMeters(Number.NaN)).toBe('');
    expect(formatDistanceFromMeters(null)).toBe('');
  });

  it('converts kilometers to miles', () => {
    expect(milesFromKm(1.609344)).toBeCloseTo(1, 6);
  });
});

describe('escape hatch', () => {
  it('formatDateWith pins en-US even for one-off option sets', () => {
    expect(
      formatDateWith(MAR_4, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    ).toBe('Wed, Mar 4');
  });

  it('reuses one Intl instance for repeated identical options', () => {
    // Formatter construction is the expensive step; a list re-rendering
    // per row must not pay it per row.
    const opts = { month: 'short', day: 'numeric' } as const;
    const first = formatDateWith(MAR_4, opts);
    const second = formatDateWith(MAR_4, { ...opts });
    expect(first).toBe(second);
  });
});
