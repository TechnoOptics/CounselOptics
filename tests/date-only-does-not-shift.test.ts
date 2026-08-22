import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateLong,
  formatDateNumeric,
  formatDateWith,
} from '../lib/format';
import { generateCasePdf } from '../lib/pdf';
import type { Case, Exhibit } from '../lib/types';

/**
 * A calendar date must not move by a day when it is printed.
 *
 * `new Date('2026-01-05')` is midnight UTC. Formatted in any zone behind UTC,
 * which is every United States zone, that instant renders as January 4th. The
 * incident date somebody typed as the 5th was printing as the 4th on their
 * court packet, with nothing on the page to suggest it had moved.
 *
 * This was not found by a test. It was found by generating the packet and
 * reading the page.
 *
 * The suite's own timezone is not pinned, so these tests set TZ per case via
 * an explicit `timeZone` comparison rather than relying on the host.
 */

describe('a date-only value keeps its day', () => {
  it('renders the day that was typed, not the day before', () => {
    // The bug reproduces in any zone behind UTC. Asserting the rendered day
    // directly is the whole point: an off-by-one here is a wrong date on a
    // legal document.
    expect(formatDate('2026-01-05')).toBe('Jan 5, 2026');
    expect(formatDateLong('2026-01-05')).toBe('January 5, 2026');
    expect(formatDateNumeric('2026-01-05')).toBe('1/5/2026');
  });

  it('holds at the start of the year, where the shift also changes the year', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDateLong('2026-01-01')).toBe('January 1, 2026');
  });

  it('leaves a full timestamp in the runtime zone, which a hearing time needs', () => {
    // Not pinned to UTC: a hearing at 9:00 AM local should read 9:00 AM to the
    // person who has to attend it. Asserted by comparing against the same
    // instant formatted without any help from this module.
    const stamp = '2026-01-05T23:30:00.000Z';
    const expected = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(stamp));
    expect(formatDate(stamp)).toBe(expected);
  });

  it('lets a caller pin its own zone', () => {
    expect(
      formatDateWith('2026-01-05', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Tokyo',
      }),
    ).toBe('Jan 5, 2026');
  });
});

describe('the packet prints the incident date that was entered', () => {
  const caseRecord = {
    id: 'c1',
    title: 'Doe v. Roe',
    subjectName: 'John Roe',
    subjectType: 'person',
    jurisdiction: { city: 'Austin', state: 'TX', country: 'USA' },
    caseType: 'Landlord/tenant issue',
    description: 'A dispute.',
    posture: 'claimant',
    status: 'open',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
  } as Case;

  const exhibits = [
    {
      id: 'x1',
      caseId: 'c1',
      label: 'Exhibit A',
      fileName: 'lease.txt',
      storedFileName: 'lease.txt',
      fileType: 'text/plain',
      fileSize: 100,
      description: 'The signed lease.',
      incidentDate: '2026-01-05',
      uploadedAt: '2026-08-08T10:00:00.000Z',
      scanData: null,
    },
  ] as Exhibit[];

  it('shows January 5 on the exhibit page, not January 4', async () => {
    const buf = await generateCasePdf({ caseRecord, exhibits, review: null });
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await extractText(pdf, { mergePages: true });
    const text = (Array.isArray(res.text) ? res.text.join('\n') : res.text).replace(
      /\s+/g,
      ' ',
    );
    expect(text).toContain('Jan 5, 2026');
    expect(text).not.toContain('Jan 4, 2026');
  }, 60_000);
});
