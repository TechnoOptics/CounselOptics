import { describe, expect, it } from 'vitest';
import {
  NO_ACTIVITY,
  OPEN_ATTRIBUTION_KEY,
  SIGNING_QUIET_AFTER_DAYS,
  attributionOfEvent,
  automatedOpensSentence,
  classifyOpenAttribution,
  firmActivitySentence,
  opensSentence,
  projectActivityForSubmitter,
  resolveActivityVerdict,
  submitterActivitySentence,
  summarizeSignerActivity,
  verdictNeedsAttention,
  type ActivityEvent,
} from '../lib/signing-activity';

/**
 * What the product may tell a firm about a recipient it cannot see.
 *
 * The whole feature is a claim about another person's behaviour on a legal
 * matter, so the properties worth pinning are the ones that stop the claim
 * from being bigger than the evidence:
 *
 *   1. A machine open is never counted as a person's open. A mail client
 *      prefetch and a link scanner produce the same HTTP request a recipient
 *      does, and reporting one as "they opened it" is a false statement to a
 *      firm about somebody who did nothing.
 *   2. Never opened and opened-then-nothing stay different facts. A firm
 *      resends on the first and phones on the second, so collapsing them into
 *      "no response" destroys the only thing the record is for.
 *   3. The employee's projection cannot carry the recipient's IP or user
 *      agent. Asserted over rows that DO carry them, because a projection
 *      tested only against clean input proves nothing.
 *   4. No sentence anywhere says the recipient read, reviewed or saw the
 *      document. An open is an HTTP request.
 *   5. An open is attributed to the signer it belongs to and to no other.
 *
 * Mutations this file is meant to catch, each verified red:
 *   - classifyOpenAttribution returns 'unverified' for prefetch headers
 *   - classifyOpenAttribution drops the empty-user-agent rule
 *   - summarizeSignerActivity counts automated opens in `opens`
 *   - summarizeSignerActivity drops the per-email keying
 *   - projectActivityForSubmitter returns the whole activity object
 *   - resolveActivityVerdict returns one quiet verdict for both cases
 */

const UA_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------------------------------------------------------------------
// 1. A machine open is never a person's open
// ---------------------------------------------------------------------

describe('classifyOpenAttribution', () => {
  it('calls a browser prefetch automated, whatever the user agent says', () => {
    for (const headers of [
      { secPurpose: 'prefetch' },
      { secPurpose: 'prefetch;anonymous-client-ip' },
      { purpose: 'prefetch' },
      { xPurpose: 'preview' },
      { xMoz: 'prefetch' },
    ]) {
      expect(
        classifyOpenAttribution({ ...headers, userAgent: UA_CHROME }),
      ).toBe('automated');
    }
  });

  it('calls a link scanner automated by its user agent', () => {
    for (const agent of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'Proofpoint URL Defense',
      'Mimecast Link Scanner',
      'HeadlessChrome/126.0',
    ]) {
      expect(classifyOpenAttribution({ userAgent: agent })).toBe('automated');
    }
  });

  it('calls a request with no user agent at all automated', () => {
    // Every real browser sends one. Nothing that does is a script, and a
    // script is not the recipient.
    expect(classifyOpenAttribution({ userAgent: null })).toBe('automated');
    expect(classifyOpenAttribution({ userAgent: '   ' })).toBe('automated');
  });

  it('calls a user-activated navigation interactive', () => {
    expect(
      classifyOpenAttribution({
        secFetchUser: '?1',
        secFetchMode: 'navigate',
        userAgent: UA_CHROME,
      }),
    ).toBe('interactive');
  });

  it('calls an ordinary browser open unverified, not interactive', () => {
    // A browser with no Sec-Fetch-User is the common case when a link is
    // opened from a mail client, and nothing on the wire says a person was
    // behind it. Claiming otherwise is the overclaim this module exists to
    // prevent.
    expect(
      classifyOpenAttribution({
        secFetchMode: 'navigate',
        userAgent: UA_CHROME,
      }),
    ).toBe('unverified');
    expect(
      classifyOpenAttribution({
        secFetchUser: '?0',
        secFetchMode: 'navigate',
        userAgent: UA_CHROME,
      }),
    ).toBe('unverified');
  });

  it('reads an unrecognised or absent attribution back as unverified', () => {
    expect(attributionOfEvent(null)).toBe('unverified');
    expect(attributionOfEvent({})).toBe('unverified');
    expect(attributionOfEvent({ [OPEN_ATTRIBUTION_KEY]: 'nonsense' })).toBe(
      'unverified',
    );
    expect(attributionOfEvent({ [OPEN_ATTRIBUTION_KEY]: 'automated' })).toBe(
      'automated',
    );
  });
});

// ---------------------------------------------------------------------
// 2. Rolling up
// ---------------------------------------------------------------------

const event = (
  over: Partial<ActivityEvent> & Pick<ActivityEvent, 'event_type' | 'created_at'>,
): ActivityEvent => ({
  signer_email: 'counterparty@example.com',
  metadata: null,
  ...over,
});

describe('summarizeSignerActivity', () => {
  it('leaves an automated open out of the count a person is shown', () => {
    const rows = [
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-01T09:00:00.000Z',
        metadata: { [OPEN_ATTRIBUTION_KEY]: 'automated' },
      }),
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-02T09:00:00.000Z',
        metadata: { [OPEN_ATTRIBUTION_KEY]: 'interactive' },
      }),
    ];
    const one = summarizeSignerActivity(rows).get('counterparty@example.com')!;
    expect(one.opens).toBe(1);
    expect(one.interactiveOpens).toBe(1);
    expect(one.automatedOpens).toBe(1);
    // And the timestamps come from the human-attributable open, not the
    // scanner that got there a day earlier.
    expect(one.firstOpenedAt).toBe('2026-08-02T09:00:00.000Z');
    expect(one.lastOpenedAt).toBe('2026-08-02T09:00:00.000Z');
  });

  it('reports nothing at all when every open was a machine', () => {
    const rows = [
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-01T09:00:00.000Z',
        metadata: { [OPEN_ATTRIBUTION_KEY]: 'automated' },
      }),
    ];
    const one = summarizeSignerActivity(rows).get('counterparty@example.com')!;
    expect(one.opens).toBe(0);
    expect(one.lastOpenedAt).toBeNull();
    // Which is what makes the verdict below say "not opened", correctly.
    expect(
      resolveActivityVerdict({
        signedAt: null,
        response: null,
        sentAt: '2026-08-01T08:00:00.000Z',
        activity: one,
        now: new Date('2026-08-20T09:00:00.000Z'),
      }).kind,
    ).toBe('never_opened');
  });

  it('attributes an open to the signer it belongs to and to no other', () => {
    const rows = [
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-01T09:00:00.000Z',
        signer_email: 'Counterparty@Example.com',
      }),
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-01T10:00:00.000Z',
        signer_email: 'employee@firm.test',
      }),
      event({
        event_type: 'document_downloaded',
        created_at: '2026-08-01T11:00:00.000Z',
        signer_email: 'employee@firm.test',
      }),
    ];
    const map = summarizeSignerActivity(rows);
    // Case-insensitive on the address, because that is how the events store
    // it and how both surfaces look it up.
    expect(map.get('counterparty@example.com')!.opens).toBe(1);
    expect(map.get('counterparty@example.com')!.downloads).toBe(0);
    expect(map.get('employee@firm.test')!.opens).toBe(1);
    expect(map.get('employee@firm.test')!.downloads).toBe(1);
  });

  it('skips an event with no address rather than bucketing it somewhere', () => {
    const map = summarizeSignerActivity([
      event({
        event_type: 'link_viewed',
        created_at: '2026-08-01T09:00:00.000Z',
        signer_email: null,
      }),
    ]);
    expect(map.size).toBe(0);
  });

  it('ignores every event type that is not an open or a download', () => {
    const map = summarizeSignerActivity([
      event({ event_type: 'signed', created_at: '2026-08-01T09:00:00.000Z' }),
      event({ event_type: 'request_sent', created_at: '2026-08-01T09:00:00.000Z' }),
      event({ event_type: 'copy_downloaded', created_at: '2026-08-09T09:00:00.000Z' }),
    ]);
    // copy_downloaded is retrieval of an EXECUTED instrument after signing.
    // Counting it as a pre-signature download would report an open request
    // as having been downloaded when the thing downloaded was the receipt.
    expect(map.size).toBe(0);
  });

  it('holds the earliest open and the latest, whatever order the rows arrive in', () => {
    const map = summarizeSignerActivity([
      event({ event_type: 'link_viewed', created_at: '2026-08-05T09:00:00.000Z' }),
      event({ event_type: 'link_viewed', created_at: '2026-08-01T09:00:00.000Z' }),
      event({ event_type: 'link_viewed', created_at: '2026-08-03T09:00:00.000Z' }),
    ]);
    const one = map.get('counterparty@example.com')!;
    expect(one.opens).toBe(3);
    expect(one.firstOpenedAt).toBe('2026-08-01T09:00:00.000Z');
    expect(one.lastOpenedAt).toBe('2026-08-05T09:00:00.000Z');
  });
});

// ---------------------------------------------------------------------
// 3. The employee cannot see more than they should
// ---------------------------------------------------------------------

describe('projectActivityForSubmitter', () => {
  it('carries no trace of the recipient as a person', () => {
    // Built from events that DO carry an address and an agent, because a
    // projection tested against clean input proves nothing.
    const rows: ActivityEvent[] = [
      {
        event_type: 'link_viewed',
        signer_email: 'counterparty@example.com',
        created_at: '2026-08-02T09:00:00.000Z',
        metadata: {
          [OPEN_ATTRIBUTION_KEY]: 'interactive',
          ip_address: '203.0.113.9',
          user_agent: UA_CHROME,
        },
      },
      {
        event_type: 'document_downloaded',
        signer_email: 'counterparty@example.com',
        created_at: '2026-08-02T09:05:00.000Z',
        metadata: { ip_address: '203.0.113.9', user_agent: UA_CHROME },
      },
    ];
    const full = summarizeSignerActivity(rows).get('counterparty@example.com')!;
    const shown = projectActivityForSubmitter(full);
    const serialized = JSON.stringify(shown);

    expect(serialized).not.toContain('203.0.113.9');
    expect(serialized).not.toContain('Chrome');
    expect(serialized).not.toContain('Mozilla');
    // Nor the forensic detail that invites a reader to weigh one open
    // against another.
    expect(Object.keys(shown).sort()).toEqual(
      [
        'downloads',
        'firstOpenedAt',
        'lastDownloadedAt',
        'lastOpenedAt',
        'opens',
      ].sort(),
    );
    expect(shown).not.toHaveProperty('interactiveOpens');
    expect(shown).not.toHaveProperty('automatedOpens');

    // The facts they ARE owed survive the projection.
    expect(shown.opens).toBe(1);
    expect(shown.downloads).toBe(1);
    expect(shown.lastDownloadedAt).toBe('2026-08-02T09:05:00.000Z');
  });

  it('never widens what the firm sees either: no ip or agent on the full roll-up', () => {
    const full = summarizeSignerActivity([
      {
        event_type: 'link_viewed',
        signer_email: 'counterparty@example.com',
        created_at: '2026-08-02T09:00:00.000Z',
        metadata: { ip_address: '203.0.113.9', user_agent: UA_CHROME },
      },
    ]).get('counterparty@example.com')!;
    // The firm is entitled to both, and reads them from the event rows on
    // the audit trail. They are not smuggled through this summary, which is
    // the object the portal renders from.
    expect(JSON.stringify(full)).not.toContain('203.0.113.9');
    expect(JSON.stringify(full)).not.toContain('Mozilla');
  });
});

// ---------------------------------------------------------------------
// 4. Silence, and which kind
// ---------------------------------------------------------------------

const NOW = new Date('2026-08-20T12:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('resolveActivityVerdict', () => {
  it('separates never opened from opened and gone quiet', () => {
    const neverOpened = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(12),
      activity: NO_ACTIVITY,
      now: NOW,
    });
    const openedQuiet = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(12),
      activity: { ...NO_ACTIVITY, opens: 2, lastOpenedAt: daysAgo(9) },
      now: NOW,
    });

    expect(neverOpened).toEqual({ kind: 'never_opened', daysSinceSent: 12 });
    expect(openedQuiet).toEqual({ kind: 'opened_quiet', daysSinceOpened: 9 });
    // Both need attention, and both say something a firm would act on
    // differently. If these two ever return the same kind, the record has
    // stopped being worth keeping.
    expect(verdictNeedsAttention(neverOpened)).toBe(true);
    expect(verdictNeedsAttention(openedQuiet)).toBe(true);
    expect(neverOpened.kind).not.toBe(openedQuiet.kind);
    expect(firmActivitySentence(neverOpened)).not.toBe(
      firmActivitySentence(openedQuiet),
    );
  });

  it('says nothing is wrong inside the window', () => {
    const waiting = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(SIGNING_QUIET_AFTER_DAYS - 1),
      activity: NO_ACTIVITY,
      now: NOW,
    });
    expect(waiting.kind).toBe('waiting');
    expect(verdictNeedsAttention(waiting)).toBe(false);

    const recent = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(20),
      activity: { ...NO_ACTIVITY, opens: 1, lastOpenedAt: daysAgo(1) },
      now: NOW,
    });
    expect(recent.kind).toBe('opened_recently');
    expect(verdictNeedsAttention(recent)).toBe(false);
  });

  it('measures the quiet from the last open, not from the send', () => {
    // A document sent a month ago and opened yesterday is not stalled.
    const verdict = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(30),
      activity: { ...NO_ACTIVITY, opens: 4, lastOpenedAt: daysAgo(1) },
      now: NOW,
    });
    expect(verdict).toEqual({ kind: 'opened_recently', daysSinceOpened: 1 });
  });

  it('does not call a signed or answered request quiet', () => {
    expect(
      resolveActivityVerdict({
        signedAt: daysAgo(30),
        response: null,
        sentAt: daysAgo(40),
        activity: NO_ACTIVITY,
        now: NOW,
      }).kind,
    ).toBe('signed');
    expect(
      resolveActivityVerdict({
        signedAt: null,
        response: 'rejected',
        sentAt: daysAgo(40),
        activity: NO_ACTIVITY,
        now: NOW,
      }).kind,
    ).toBe('responded');
  });

  it('does not report a request that never went out as unopened', () => {
    // Nobody failed to open a document nobody was sent.
    expect(
      resolveActivityVerdict({
        signedAt: null,
        response: null,
        sentAt: null,
        activity: NO_ACTIVITY,
        now: NOW,
      }),
    ).toEqual({ kind: 'not_sent' });
  });

  it('treats an unparseable sent_at as inside the window', () => {
    const verdict = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: 'not a date',
      activity: NO_ACTIVITY,
      now: NOW,
    });
    expect(verdict).toEqual({ kind: 'waiting', daysSinceSent: 0 });
  });
});

// ---------------------------------------------------------------------
// 5. Nothing claims the recipient read anything
// ---------------------------------------------------------------------

describe('the sentences', () => {
  const everyVerdict = [
    { signedAt: daysAgo(1), response: null, sentAt: daysAgo(4) },
    { signedAt: null, response: 'rejected', sentAt: daysAgo(4) },
    { signedAt: null, response: null, sentAt: null },
    { signedAt: null, response: null, sentAt: daysAgo(1) },
    { signedAt: null, response: null, sentAt: daysAgo(30) },
  ] as const;

  it('never tells anyone the recipient read, reviewed or saw the document', () => {
    const forbidden = /\b(read|reviewed|reviewing|seen|saw|viewed)\b/i;
    const said: string[] = [];
    for (const base of everyVerdict) {
      for (const activity of [
        NO_ACTIVITY,
        { ...NO_ACTIVITY, opens: 3, lastOpenedAt: daysAgo(9) },
        { ...NO_ACTIVITY, opens: 1, lastOpenedAt: daysAgo(1), downloads: 2 },
      ]) {
        const verdict = resolveActivityVerdict({ ...base, activity, now: NOW });
        said.push(firmActivitySentence(verdict));
        said.push(submitterActivitySentence(verdict));
        const opens = opensSentence(activity);
        if (opens) said.push(opens);
      }
    }
    said.push(
      automatedOpensSentence({ ...NO_ACTIVITY, automatedOpens: 3 }) ?? '',
    );
    for (const sentence of said) {
      expect(sentence, sentence).not.toMatch(forbidden);
    }
    // And the set is not accidentally empty, which would pass the loop above
    // while asserting nothing.
    expect(said.filter(Boolean).length).toBeGreaterThan(20);
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(opensSentence(NO_ACTIVITY)).toBeNull();
    expect(automatedOpensSentence(NO_ACTIVITY)).toBeNull();
  });

  it('names the machine opens as machine opens for the firm', () => {
    const sentence = automatedOpensSentence({
      ...NO_ACTIVITY,
      automatedOpens: 2,
    });
    expect(sentence).toContain('link scanner');
    expect(sentence).toContain('not counted');
  });

  it('does not tell the employee to chase the recipient themselves', () => {
    // Chasing a counterparty is the legal team's job. The firm's copy names
    // the move; the employee's points at their legal team.
    const quiet = resolveActivityVerdict({
      signedAt: null,
      response: null,
      sentAt: daysAgo(30),
      activity: { ...NO_ACTIVITY, opens: 1, lastOpenedAt: daysAgo(20) },
      now: NOW,
    });
    expect(submitterActivitySentence(quiet)).toContain('legal team');
    expect(firmActivitySentence(quiet)).not.toContain('legal team');
  });
});
