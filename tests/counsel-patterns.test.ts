import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime, shortRef } from '../components/counsel/patterns';

/**
 * The two pure helpers behind the page patterns.
 *
 * relativeTime is worth pinning because three surfaces read it (the
 * matter list's Updated column, the matter header's provenance line,
 * and the action bar's next-deadline reading) and because its output is
 * deliberately coarse: a unit finer than a minute would render one
 * string on the server and a different one in the browser, and hydrate
 * with a mismatch.
 */

afterEach(() => {
  vi.useRealTimers();
});

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('relativeTime', () => {
  it('returns null for a missing or unparseable timestamp', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime(undefined)).toBeNull();
    expect(relativeTime('')).toBeNull();
    expect(relativeTime('not a date')).toBeNull();
  });

  it('says "just now" under a minute rather than counting seconds', () => {
    at('2026-08-08T12:00:30Z');
    expect(relativeTime('2026-08-08T12:00:00Z')).toBe('just now');
  });

  it('steps up through minutes, hours, days, months and years', () => {
    at('2026-08-08T12:00:00Z');
    expect(relativeTime('2026-08-08T11:55:00Z')).toBe('5m ago');
    expect(relativeTime('2026-08-08T09:00:00Z')).toBe('3h ago');
    expect(relativeTime('2026-08-04T12:00:00Z')).toBe('4d ago');
    expect(relativeTime('2026-05-08T12:00:00Z')).toBe('3mo ago');
    expect(relativeTime('2024-08-08T12:00:00Z')).toBe('2y ago');
  });

  it('reads a future timestamp forwards, which is what a deadline is', () => {
    at('2026-08-08T12:00:00Z');
    expect(relativeTime('2026-08-18T12:00:00Z')).toBe('in 10d');
    expect(relativeTime('2026-08-08T12:00:20Z')).toBe('shortly');
  });
});

describe('shortRef', () => {
  it('shows the leading segment of a uuid', () => {
    expect(shortRef('3f2a9c10-7b44-4d2e-9f01-a1b2c3d4e5f6')).toBe('3f2a9c10');
  });

  it('leaves an id with no segments alone', () => {
    expect(shortRef('abc123')).toBe('abc123');
  });
});
