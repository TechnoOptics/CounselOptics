// tests/firm-front-door.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The enterprise page: a forest cover that keeps `enterprise-shell`, then
 * the same cream file, sections in the order a matter moves, one stamp,
 * the sector tabs and the inquiry form kept, the mocks and the compare
 * table gone.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/enterprise/page.tsx'), 'utf8'));
const TABS = stripComments(readFileSync(join(ROOT, 'components/EnterpriseSectorTabs.tsx'), 'utf8'));

describe('the cover', () => {
  it('keeps enterprise-shell on the dark cover and nowhere else', () => {
    expect(PAGE.match(/enterprise-shell/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<section className="enterprise-shell[^"]*bg-forest-950/);
  });
  it('spends the one gold on the request-number stamp', () => {
    expect(PAGE.match(/<Stamp\b/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<Stamp line1="Request" line2="REQ-0000412"/);
    expect(PAGE).not.toMatch(/\b(?:bg|text|ring|border)-gold-|gold-metal|gold-shine|gold-pan|italic/);
  });
});

describe('the file below', () => {
  it('walks one matter in order', () => {
    const order = ['Intake', 'Review', 'Rooms', 'Signing', 'Packet'].map((s) => PAGE.indexOf(`tab="${s}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('keeps the sector tabs, the case-law review and the inquiry form', () => {
    expect(PAGE).toMatch(/<EnterpriseSectorTabs \/>/);
    expect(PAGE).toMatch(/<Sheet[^>]*>[\s\S]{0,200}<LegalReviewMock \/>/);
    expect(PAGE).toMatch(/<EnterpriseInquiryForm \/>/);
  });
  it('dropped the mocks, the frames and the compare table', () => {
    expect(PAGE).not.toMatch(/BrowserFrame|EsignMock|MeetingsMock|BellaAgentMock|TeamChatMock|IoltaMock|AuditChainMock|DiscoveryMock|CompareTable|FirmDashboardMock|AudienceSplit/);
  });
});

describe('the sector tabs', () => {
  it('are a Courier toggle and definitions, with no gold and no cards', () => {
    expect(TABS).toMatch(/font-courier/);
    expect(TABS).not.toMatch(/gold-|rounded-2xl|rounded-full|backdrop-blur|font-display/);
    expect(TABS).toMatch(/useState<SectorKey>\('firm'\)/);
  });
});
