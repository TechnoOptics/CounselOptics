import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { generateTimelineExhibitPdf, type TimelineExhibitData } from '../lib/pdf';

// A real PNG shipped in the repo, so this exercises the actual image-embed path.
const png = readFileSync('public/icon-192.png');

function sample(entryCount: number): TimelineExhibitData {
  return {
    caseTitle: 'Doe v. Roe: Unlawful Eviction',
    caseRef: 'AB12CD34',
    subjectName: 'Jane Doe',
    preparedBy: 'Test Attorney',
    generatedAt: new Date('2026-07-07T12:00:00Z').toISOString(),
    narrative: {
      summary: 'Executive summary of the matter.',
      narrative: 'A chronological account of the events. '.repeat(6),
      conclusion: 'The reasoned conclusion.',
    },
    entities: [
      {
        name: 'John Roe',
        kind: 'person',
        roleLabel: 'Opposing party',
        aliases: ['J.R.'],
        notes: 'Landlord of record.',
        photo: png,
        appearances: 3,
      },
      {
        name: 'Acme Property Management',
        kind: 'organization',
        roleLabel: 'Organization',
        aliases: [],
        notes: 'Referenced in 2 items',
        photo: null,
        appearances: 2,
      },
    ],
    entries: Array.from({ length: entryCount }, (_, i) => ({
      index: i + 1,
      when: 'March 14, 2023',
      kind: 'Photo',
      title: `Text message from landlord #${i + 1}`,
      context: 'Context describing the item and why it matters. '.repeat(8),
      summary: 'Bella factual summary of the item.',
      sourceLabel: 'WhatsApp export',
      people: ['John Roe'],
      exhibits: [
        { name: `photo-${i}.png`, mime: 'image/png', sizeBytes: png.length, sha256: 'a'.repeat(64), image: png },
        { name: `statement-${i}.pdf`, mime: 'application/pdf', sizeBytes: 45678, sha256: 'b'.repeat(64), image: null },
      ],
      coreDetails: [
        { label: 'Device', value: 'Apple iPhone 14 Pro' },
        { label: 'Captured', value: 'Mar 14, 2023, 4:12 PM' },
        { label: 'GPS', value: '44.833400, -93.526600' },
      ],
    })),
  };
}

function pageCount(buf: Buffer): number {
  const s = buf.toString('latin1');
  const counts = (s.match(/\/Count\s+(\d+)/g) || []).map((x) => parseInt(x.replace(/\D/g, ''), 10));
  return Math.max(0, ...counts);
}

describe('generateTimelineExhibitPdf', () => {
  it('produces a valid PDF that embeds evidence images', async () => {
    const buf = await generateTimelineExhibitPdf(sample(3));
    expect(buf.toString('latin1', 0, 5)).toBe('%PDF-');
    // Embedded raster images appear as Image XObjects (dict is uncompressed).
    expect(buf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
    expect(buf.length).toBeGreaterThan(8000);
  });

  it('does not explode into blank pages: page count tracks content', async () => {
    const small = pageCount(await generateTimelineExhibitPdf(sample(2)));
    const big = pageCount(await generateTimelineExhibitPdf(sample(10)));
    // Sane bounds: cover + cert + POI + chronology + narrative + conclusion +
    // disclaimer is ~6 base pages; each image entry adds roughly a page.
    expect(small).toBeGreaterThanOrEqual(5);
    expect(small).toBeLessThanOrEqual(12);
    // More entries → more pages, but proportionally (no per-entry blank).
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThanOrEqual(small + 12);
  });

  it('renders with no persons/orgs and no narrative (minimal path)', async () => {
    const data = sample(1);
    data.entities = [];
    data.narrative = null;
    const buf = await generateTimelineExhibitPdf(data);
    expect(buf.toString('latin1', 0, 5)).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThanOrEqual(3);
  });
});
