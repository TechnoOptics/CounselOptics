import { describe, it, expect } from 'vitest';
import { formatOccurred, PRECISION_GRAINS } from '../lib/timeline-types';

// A fixed UTC instant: 2023-03-14 14:07:33 UTC.
const ISO = '2023-03-14T14:07:33Z';

describe('formatOccurred honours the fine grains', () => {
  it('second shows the exact second', () => {
    expect(formatOccurred(ISO, 'second')).toContain('2:07:33');
  });
  it('minute shows hours:minutes but not seconds', () => {
    const s = formatOccurred(ISO, 'minute');
    expect(s).toContain('2:07');
    expect(s).not.toContain('2:07:33');
  });
  it('hour shows the hour without minutes', () => {
    const s = formatOccurred(ISO, 'hour');
    expect(s).toContain('2');
    expect(s).not.toContain('2:07');
  });
  it('week is prefixed with "Week of"', () => {
    expect(formatOccurred(ISO, 'week')).toMatch(/^Week of /);
  });
  it('day / month / year stay coarse', () => {
    expect(formatOccurred(ISO, 'day')).toBe('March 14, 2023');
    expect(formatOccurred(ISO, 'month')).toBe('March 2023');
    expect(formatOccurred(ISO, 'year')).toBe('2023');
  });
  it('exact remains a minute-level alias for legacy rows', () => {
    expect(formatOccurred(ISO, 'exact')).toBe(formatOccurred(ISO, 'minute'));
  });
  it('unknown / null are Undated', () => {
    expect(formatOccurred(ISO, 'unknown')).toBe('Undated');
    expect(formatOccurred(null, 'day')).toBe('Undated');
  });
});

describe('PRECISION_GRAINS', () => {
  it('exposes the full grain ladder to the picker', () => {
    const values = PRECISION_GRAINS.map((g) => g.value);
    for (const v of ['second', 'minute', 'hour', 'day', 'week', 'month', 'year', 'unknown']) {
      expect(values).toContain(v);
    }
  });
});
