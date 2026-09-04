import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';
import {
  hasCapability,
  offerableMetricIds,
  type DashboardViewerContext,
} from '../lib/counsel-dashboard';
import { buildCounselMetricBands, type CounselMetricInput } from '../lib/counsel-metrics';

/**
 * The owner's rule for an in-house workspace: "there should be no matters
 * unless a case is opened." The dashboard used to gate matter figures by
 * role alone, so a general-counsel team with no open case still saw a Matter
 * health band and matter tiles as if it were a litigation firm. Presence now
 * follows the live case count, for every firm type, and routes are never
 * gated by it.
 */
const ctx = (over: Partial<DashboardViewerContext>): DashboardViewerContext => ({
  role: 'owner',
  hideTimeBilling: false,
  firmType: 'corporate',
  liveCaseCount: 0,
  ...over,
});

const input = (over: Partial<CounselMetricInput>): CounselMetricInput => ({
  matters: [],
  mattersVisible: true,
  meId: 'me',
  approvals: { waiting: 0, aging: 0 },
  signing: { out: 0, attention: 0 },
  documents: { overdue: 0, unfiled: 0 },
  people: { invitationsPending: 0, clientsInvited: 0 },
  money: null,
  now: Date.UTC(2026, 7, 24),
  ...over,
});

describe("the 'matters' capability", () => {
  it.each([
    ['corporate', 0, 'owner', false],
    ['corporate', 1, 'owner', true],
    ['firm', 0, 'owner', false],
    ['firm', 1, 'owner', true],
    ['corporate', 1, 'staff', false],
    ['firm', 5, 'staff', false],
  ] as const)('%s firm, %i live cases, role %s -> %s', (firmType, liveCaseCount, role, expected) => {
    expect(hasCapability('matters', ctx({ firmType, liveCaseCount, role }))).toBe(expected);
  });

  it('leaves documents on role alone, so a workspace with no case still sees its documents', () => {
    expect(hasCapability('documents', ctx({ liveCaseCount: 0 }))).toBe(true);
  });

  it('withholds the matter tiles from the picker when hidden, so nobody can pin a tile that will not render', () => {
    const hidden = offerableMetricIds(ctx({ liveCaseCount: 0 }));
    const shown = offerableMetricIds(ctx({ liveCaseCount: 1 }));
    expect(hidden.filter((id) => id.startsWith('matters-'))).toEqual([]);
    expect(shown.filter((id) => id.startsWith('matters-')).length).toBeGreaterThan(0);
  });
});

describe('the metric board when matters are hidden', () => {
  it('carries no matter metric and does not throw', () => {
    const bands = buildCounselMetricBands(input({ mattersVisible: false }));
    const ids = bands.flatMap((b) => b.metrics.map((m) => m.id));
    expect(ids.some((id) => id.startsWith('matters-'))).toBe(false);
    expect(ids).toContain('approvals-waiting');
  });

  it('carries them when visible', () => {
    const bands = buildCounselMetricBands(input({ mattersVisible: true }));
    const ids = bands.flatMap((b) => b.metrics.map((m) => m.id));
    expect(ids).toContain('matters-unassigned');
    expect(ids).toContain('matters-hearing');
  });
});

describe('the dashboard page', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = stripComments(readFileSync(join(root, 'app/counsel/page.tsx'), 'utf8'));

  it('passes both facts into the viewer, so the rule cannot be defeated by a page that forgets one', () => {
    expect(page).toMatch(/firmType:\s*surfaces\.firmType/);
    expect(page).toMatch(/liveCaseCount:\s*openMatters/);
  });

  it('asks the capability rather than restating it when building the board', () => {
    expect(page).toMatch(/mattersVisible:\s*hasCapability\('matters', viewer\)/);
  });
});
