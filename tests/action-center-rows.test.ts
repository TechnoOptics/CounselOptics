import { describe, expect, it } from 'vitest';
import { firmCopy, firmVocabulary } from '../lib/firm-vocabulary';
import {
  actionCenterItems,
  actionCenterWorkItems,
  type DashboardTileData,
} from '../components/counsel/CounselDashboardTiles';

/**
 * The action center is the counsel dashboard's headline card: a list of
 * what is outstanding, under a title that states how much of it there is.
 * Both halves have shipped wrong, and both were wrong only at particular
 * counts, which is why looking at one populated screenshot never caught
 * them.
 *
 *   - The title once counted ROWS rather than the work behind them, so a
 *     card headed "1 thing needs a human" sat directly above a row
 *     reading "5 requests need attention".
 *   - The labels pluralised the noun and not the verb, so at exactly one
 *     item they read "1 request need attention" and "1 signing request
 *     you sent are still out". One is the count a small firm sits on most
 *     days.
 *
 * These are cheap to get right and invisible until somebody is looking at
 * the exact count that breaks, so the counts are enumerated here rather
 * than sampled.
 */

const BASE: DashboardTileData = {
  // A law firm, so this fixture keeps the ordinary nouns. What the vocabulary
  // does to those nouns is tested in tests/firm-vocabulary-reaches-the-page.ts;
  // here it is only the envelope's required field.
  vocab: firmVocabulary('firm'),
  copy: firmCopy('firm'),
  firmId: 'f1',
  firmName: 'Firm',
  userId: 'u1',
  userDisplayName: 'Dana',
  isAdmin: true,
  counts: {
    casesOpen: 0,
    casesTotal: 0,
    clients: 0,
    clientsActive: 0,
    members: 1,
    invitations: 0,
    documents: 0,
    signingPending: 0,
  },
  intake: {
    needsAttention: 0,
    inReview: 0,
    accepted: 0,
    closed: 0,
    newToday: 0,
    recentNew: [],
  },
  assigned: { cases: [], casesTotal: 0, clients: [], clientsTotal: 0 },
  signing: { mineAwaitingCount: 0 },
  meetings: [],
  deadlines: [],
  recentUploads: [],
};

function withSigning(n: number): DashboardTileData['signing'] {
  return { mineAwaitingCount: n };
}

describe('the action center title is the work, not the row count', () => {
  it('says nothing is waiting when nothing is', () => {
    expect(actionCenterItems(BASE)).toEqual([]);
    expect(actionCenterWorkItems(actionCenterItems(BASE))).toBe(0);
  });

  it('adds up the work behind every row, not the rows', () => {
    const data: DashboardTileData = {
      ...BASE,
      counts: { ...BASE.counts, invitations: 2 },
      intake: { ...BASE.intake, needsAttention: 5 },
      signing: withSigning(3),
    };
    const items = actionCenterItems(data);
    expect(items).toHaveLength(3);
    // The regression: three rows, ten work items. A title of 3 here is
    // the bug this arithmetic replaced.
    expect(actionCenterWorkItems(items)).toBe(10);
  });

  it('does not count a new arrival twice when it also needs attention', () => {
    // Arrivals in the last 24 hours span every lane, so they overlap the
    // attention lane. When both are non-zero the arrivals ride along in
    // the detail line and contribute nothing to the sum.
    const data: DashboardTileData = {
      ...BASE,
      intake: { ...BASE.intake, needsAttention: 4, newToday: 3 },
    };
    const items = actionCenterItems(data);
    expect(items).toHaveLength(1);
    expect(actionCenterWorkItems(items)).toBe(4);
    expect(items[0].detail).toContain('3 requests arrived in the last 24 hours');
  });

  it('still surfaces new arrivals when nothing needs attention', () => {
    const data: DashboardTileData = {
      ...BASE,
      intake: { ...BASE.intake, needsAttention: 0, newToday: 2 },
    };
    const items = actionCenterItems(data);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('2 new in the last 24 hours');
    expect(actionCenterWorkItems(items)).toBe(2);
  });

  it('shows pending invitations only to someone who can act on them', () => {
    const data: DashboardTileData = {
      ...BASE,
      isAdmin: false,
      counts: { ...BASE.counts, invitations: 2 },
    };
    expect(actionCenterItems(data)).toEqual([]);
    expect(
      actionCenterItems({ ...data, isAdmin: true }).map((i) => i.label),
    ).toEqual(['2 pending team invitations']);
  });
});

describe('every row agrees with itself about number', () => {
  const cases: Array<[string, DashboardTileData, string]> = [
    [
      'one request needing attention',
      { ...BASE, intake: { ...BASE.intake, needsAttention: 1 } },
      '1 request needs attention',
    ],
    [
      'two requests needing attention',
      { ...BASE, intake: { ...BASE.intake, needsAttention: 2 } },
      '2 requests need attention',
    ],
    [
      'one signature outstanding',
      { ...BASE, signing: withSigning(1) },
      '1 signing request you sent is still out',
    ],
    [
      'two signatures outstanding',
      { ...BASE, signing: withSigning(2) },
      '2 signing requests you sent are still out',
    ],
    [
      'one pending invitation',
      { ...BASE, counts: { ...BASE.counts, invitations: 1 } },
      '1 pending team invitation',
    ],
    [
      'two pending invitations',
      { ...BASE, counts: { ...BASE.counts, invitations: 2 } },
      '2 pending team invitations',
    ],
  ];

  for (const [name, data, expected] of cases) {
    it(`reads correctly with ${name}`, () => {
      expect(actionCenterItems(data)[0].label).toBe(expected);
    });
  }

  it('agrees in the detail line too, at one and at more than one', () => {
    const one = actionCenterItems({
      ...BASE,
      intake: { ...BASE.intake, needsAttention: 1, newToday: 1 },
    })[0];
    expect(one.detail).toContain('1 request arrived in the last 24 hours');
    const many = actionCenterItems({
      ...BASE,
      intake: { ...BASE.intake, needsAttention: 1, newToday: 5 },
    })[0];
    expect(many.detail).toContain('5 requests arrived in the last 24 hours');
  });

  it('never pairs a singular subject with a plural verb, at any count', () => {
    // The general form of both defects. A label that starts "1 " may not
    // carry a bare plural verb anywhere in it.
    const PLURAL_VERB = /\b(need|are|were|have)\b/;
    for (let n = 1; n <= 3; n += 1) {
      const data: DashboardTileData = {
        ...BASE,
        counts: { ...BASE.counts, invitations: n },
        intake: { ...BASE.intake, needsAttention: n, newToday: n },
        signing: withSigning(n),
      };
      for (const item of actionCenterItems(data)) {
        if (!item.label.startsWith('1 ')) continue;
        expect(
          PLURAL_VERB.test(item.label),
          `a singular row with a plural verb: "${item.label}"`,
        ).toBe(false);
      }
    }
  });
});
