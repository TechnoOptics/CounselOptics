import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DashboardTileRenderer,
  type DashboardTileData,
} from '../components/counsel/CounselDashboardTiles';
import { CaseActivityStream } from '../components/counsel/CaseActivityStream';
import type { CaseActivityEvent } from '../lib/case-activity-log';
import {
  FIRM_COPY,
  FIRM_VOCABULARY,
  firmCopy,
  firmVocabulary,
} from '../lib/firm-vocabulary';
import { FIRM_TYPES, type FirmType } from '../lib/firm-types';

/**
 * An in-house legal team must not be told the people it advises are clients.
 *
 * Zinpro's team has no clients. It has employees, it does not invoice anybody,
 * and the word "client" on its dashboard is not a cosmetic complaint: it is the
 * product describing the team's own colleagues as outsiders.
 *
 * `firms.firm_type` has carried the answer since the token-economy schema and
 * lib/firm-vocabulary.ts has held the nouns since the workspace-shape change.
 * The gap this closes is the one in between: a map can be correct and still
 * reach nothing. That is the failure shape this repo keeps producing, and a
 * test asserting the map's contents would reproduce it exactly, because it
 * would pass with every call site deleted.
 *
 * So these RENDER. They call the real tile renderer through
 * renderToStaticMarkup and read the HTML that comes out. A word only counts if
 * it is in the markup a person would see.
 *
 * Mutations that turn them red:
 *   - revert `eyebrow={data.vocab.clients}` on the roster tile to the literal
 *     "Clients": "an in-house dashboard never says client" goes red.
 *   - revert any of the three `data.copy.*` wraps in AssignedToMeTile: the same
 *     test goes red on whichever sentence was reverted.
 *   - drop `copy` or `vocab` from the envelope the page builds: tsc fails, and
 *     if the field were made optional, "a law firm's dashboard is unchanged"
 *     goes red because the fallback would print undefined.
 *   - point CORPORATE_COPY at BASE_COPY: every corporate expectation goes red.
 *   - point BASE_COPY at CORPORATE_COPY: "a law firm's dashboard is unchanged"
 *     goes red, so the in-house wording cannot be delivered by renaming things
 *     for everybody.
 */

/** An envelope with enough in it for the two tiles under test to draw. */
function envelope(
  firmType: FirmType,
  assigned: DashboardTileData['assigned'],
): DashboardTileData {
  return {
    vocab: firmVocabulary(firmType),
    copy: firmCopy(firmType),
    firmId: 'f1',
    firmName: 'Anderson Foundation',
    userId: 'u1',
    userDisplayName: 'Dana',
    isAdmin: true,
    counts: {
      casesOpen: 2,
      casesTotal: 4,
      clients: 7,
      clientsActive: 5,
      members: 3,
      invitations: 0,
      documents: 9,
      signingPending: 1,
    },
    intake: {
      needsAttention: 0,
      inReview: 0,
      accepted: 0,
      closed: 0,
      newToday: 0,
      recentNew: [],
    },
    assigned,
    signing: { mineAwaitingCount: 0 },
    meetings: [],
    deadlines: [],
    recentUploads: [],
  };
}

const NOTHING: DashboardTileData['assigned'] = {
  cases: [],
  casesTotal: 0,
  clients: [],
  clientsTotal: 0,
};

/**
 * "Assigned to me" collapses to a single line when the person has nothing at
 * all, so its two per-column empty states only exist when ONE column is
 * populated. Both arrangements are rendered, or two of the four sentences
 * under test would never appear and the assertions on them would be vacuous.
 */
const ONLY_A_CASE: DashboardTileData['assigned'] = {
  cases: [{ id: 'c1', title: 'Supplier dispute', status: 'open' }],
  casesTotal: 1,
  clients: [],
  clientsTotal: 0,
};

const ONLY_A_PERSON: DashboardTileData['assigned'] = {
  cases: [],
  casesTotal: 0,
  clients: [{ id: 'p1', displayName: 'Ana Reyes', status: 'active' }],
  clientsTotal: 1,
};

/**
 * The words a person READS, with the markup taken away.
 *
 * Tags and attributes are stripped deliberately. `/counsel/clients` is the
 * route these tiles link at, and the route is not going to be renamed per firm
 * type; asserting over raw HTML would fail on that href and say nothing about
 * what anyone sees. Entities are decoded because React escapes the apostrophe
 * in "it'll", and an assertion that missed on `&#x27;` would look like a copy
 * bug rather than an encoding one.
 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What every tile arrangement that names the people a firm helps says out loud. */
function dashboardText(firmType: FirmType): string {
  const parts: string[] = [];
  for (const assigned of [NOTHING, ONLY_A_CASE, ONLY_A_PERSON]) {
    const data = envelope(firmType, assigned);
    for (const id of ['clients-overview', 'assigned-to-me'] as const) {
      parts.push(
        visibleText(
          renderToStaticMarkup(
            createElement(DashboardTileRenderer, { id, data }),
          ),
        ),
      );
    }
  }
  return parts.join('\n');
}

describe('the dashboard uses the team\'s own word for the people it helps', () => {
  it('an in-house dashboard never says client, and does say employee', () => {
    const html = dashboardText('corporate');
    expect(html).not.toMatch(/client/i);
    expect(html).toMatch(/Employees/);
    expect(html).toContain('Invite an employee and they stay linked to your team.');
    expect(html).toContain('Your employees');
    expect(html).toContain('No matters tied to your employees yet.');
    expect(html).toContain('Nobody is assigned to you yet.');
    expect(html).toContain(
      "When an employee or a matter is assigned to you, it'll show up here for quick access.",
    );
  });

  it('a law firm\'s dashboard is unchanged, and never says employee', () => {
    const html = dashboardText('firm');
    expect(html).toMatch(/Clients/);
    expect(html).toContain('Invite a client and they stay linked to your firm.');
    expect(html).toContain('Your clients');
    expect(html).toContain('No cases tied to your clients yet.');
    // "Employees" is the DIRECTORY for a law firm, a different surface. It has
    // no business on the roster tile, and if the two vocabularies were ever
    // swapped this is what would catch it.
    expect(html).not.toMatch(/employee/i);
  });

  it('every firm type renders a complete tile, with no undefined text', () => {
    // A type added to the enum without a row in FIRM_COPY would print the
    // string "undefined" into the markup rather than failing loudly.
    for (const firmType of FIRM_TYPES) {
      const html = dashboardText(firmType);
      expect(html, `${firmType} rendered undefined copy`).not.toContain(
        'undefined',
      );
      expect(html.length, `${firmType} rendered nothing`).toBeGreaterThan(100);
    }
  });

  it('only the in-house type departs from the ordinary words', () => {
    // The design's promise: no existing firm's workspace changes wording until
    // somebody changes its type. Guessing at a vocabulary for legal aid or a
    // government office would take the ordinary word away from an organization
    // that uses it correctly.
    const base = dashboardText('firm');
    for (const firmType of FIRM_TYPES) {
      if (firmType === 'corporate') continue;
      expect(dashboardText(firmType), `${firmType} drifted from the base`).toBe(
        base,
      );
    }
    expect(dashboardText('corporate')).not.toBe(base);
  });
});

/**
 * The per-matter activity feed labels each row with the actor's capacity. Three
 * of the four capacities are attorney-side and read the same at any firm; the
 * fourth is the person the matter is FOR, which is the one word a type changes.
 */
const ACTIVITY: CaseActivityEvent[] = [
  {
    id: 'a1',
    action: 'section_open',
    actorKind: 'client',
    actorLabel: 'Ana Reyes',
    actorEmail: 'ana@example.com',
    detail: {},
    createdAt: '2026-08-01T09:00:00.000Z',
  },
  {
    id: 'a2',
    action: 'section_open',
    actorKind: 'guest',
    actorLabel: 'Outside counsel',
    actorEmail: 'oc@example.com',
    detail: {},
    createdAt: '2026-08-01T10:00:00.000Z',
  },
];

function activityText(firmType: FirmType): string {
  return visibleText(
    renderToStaticMarkup(
      createElement(CaseActivityStream, {
        events: ACTIVITY,
        vocab: firmVocabulary(firmType),
      }),
    ),
  );
}

describe('the matter activity feed names the actor in the team\'s own words', () => {
  it('an in-house feed says Employee, never Client', () => {
    const html = activityText('corporate');
    expect(html).toContain('Employee');
    expect(html).not.toMatch(/\bClient\b/);
    // The attorney-side capacity is untouched, so this is a rename of one row
    // rather than of the whole legend.
    expect(html).toContain('Co-counsel');
  });

  it("a law firm's feed is unchanged", () => {
    const html = activityText('firm');
    expect(html).toContain('Client');
    expect(html).toContain('Co-counsel');
    expect(html).not.toMatch(/\bEmployee\b/);
  });
});

describe('the copy deck has no field that nothing reads', () => {
  /**
   * A copy deck rots in one direction: a key is added, the call site is
   * forgotten, and the deck grows entries that describe a screen nobody sees.
   * The render tests above cover the surfaces that can be driven headlessly;
   * this covers the rest by asking, of every key, whether ANY module outside
   * lib/firm-vocabulary.ts names it.
   *
   * It proves wiring exists, not that the wiring is correct. That is why it
   * sits BESIDE the render tests rather than instead of them.
   */
  it('every FirmCopy and FirmVocabulary field is read by something', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(full)) {
          // lib/firm-vocabulary.ts is scanned too, deliberately. The `.field`
          // pattern below matches only a READ: a definition is
          // `directory: 'Employees',` and the type is `directory: string;`,
          // neither with a leading dot. Excluding the module hid
          // menuLabelsForType, which is the real (and only) consumer of
          // `directory` and `caseload` and is what puts them in the rail.
          sources.push(readFileSync(full, 'utf8'));
        }
      }
    };
    for (const dir of ['app', 'components', 'lib']) walk(dir);
    const haystack = sources.join('\n');

    const fields = [
      ...Object.keys(FIRM_COPY.firm),
      ...Object.keys(FIRM_VOCABULARY.firm),
    ];
    const orphans = fields.filter((f) => !haystack.includes(`.${f}`));
    expect(orphans, `copy fields nothing reads: ${orphans.join(', ')}`).toEqual([]);
  });
});
