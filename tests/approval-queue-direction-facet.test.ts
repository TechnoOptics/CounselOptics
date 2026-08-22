import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DIRECTION_FACET_LABEL,
  QUEUE_DIRECTION_FACETS,
  approvalQueueHref,
  directionFacetCounts,
  inboundAuthorizationRow,
  inboundQueueStatus,
  matchesDirection,
  parseApprovalQueueParams,
  queueFraming,
  selectHistory,
  selectQueue,
  settledTally,
  type ApprovalQueueParams,
  type ApprovalRow,
} from '../lib/approval-queue';

/**
 * ONE QUEUE, ONE RECORD SHAPE, TWO FRAMINGS.
 *
 * A second queue would be a second place to look every morning and a second
 * gate to keep in step with the first, and the gate is the same function in
 * both directions. So the direction is a facet, and these are the properties
 * that make it one: the same selection expression produces the list and the
 * counts, the facet narrows the history as well as the queue, and an inbound
 * record survives the mapping onto the shared row without carrying the legal
 * team's working note into a client payload.
 */

const NOW = Date.parse('2026-08-22T12:00:00.000Z');

function outbound(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'sub-1',
    ticketNumber: 'REQ-0000001',
    templateName: 'Mutual NDA',
    category: 'NDA',
    submitterName: 'Dana Okafor',
    submitterEmail: 'dana@firm.test',
    recipientName: 'Acme Ltd',
    recipientEmail: 'legal@acme.test',
    status: 'pending',
    revision: 1,
    submittedAt: new Date(NOW - 3_600_000).toISOString(),
    decidedAt: null,
    releaseError: null,
    direction: 'outbound',
    href: '/counsel/forms/approvals/sub-1',
    ...over,
  };
}

const inbound = (over: Partial<Parameters<typeof inboundAuthorizationRow>[0]> = {}) =>
  inboundAuthorizationRow({
    id: 'req-1',
    documentName: 'Northwind services agreement',
    counterpartyName: 'Northwind Traders',
    counterpartyEmail: 'contracts@northwind.test',
    requestedByName: 'Dana Okafor',
    requestedByEmail: null,
    authorizationStatus: 'pending',
    createdAt: new Date(NOW - 7_200_000).toISOString(),
    authorizedAt: null,
    ticketNumber: null,
    ...over,
  });

const params = (over: Partial<ApprovalQueueParams> = {}): ApprovalQueueParams => ({
  view: 'waiting',
  q: '',
  sort: 'oldest',
  dir: 'all',
  ...over,
});

describe('an inbound request becomes a row of the same queue', () => {
  it('lands on the queue vocabulary rather than adding a fifth status', () => {
    expect(inboundQueueStatus('pending')).toBe('pending');
    expect(inboundQueueStatus('approved')).toBe('approved');
    expect(inboundQueueStatus('declined')).toBe('declined');
  });

  /**
   * Mutation: map 'not_required' onto a terminal status. This goes red.
   *
   * It cannot occur on an inbound row today, and if it ever did it would mean
   * an authorisation nobody recorded, which belongs in front of a reviewer
   * rather than in the history where it would read as decided.
   */
  it.each([undefined, null, 'not_required', 'nonsense'])(
    'puts an unrecorded authorisation (%s) in front of a reviewer',
    (raw) => {
      expect(inboundQueueStatus(raw)).toBe('pending');
    },
  );

  /**
   * Mutation: add `authorizationNote` to the mapper's input and put it on the
   * row. This goes red.
   *
   * The queue is a client component, so everything the row carries is
   * serialized into the page. The note is the legal team's working reasoning
   * on a document, and this is the same rule that keeps `documentText` off
   * the outbound row.
   */
  it('carries no note and no document wording', () => {
    const row = inbound();
    expect(Object.keys(row).sort()).toEqual(Object.keys(outbound()).sort());
    expect(JSON.stringify(row)).not.toContain('note');
  });

  it('opens the signing record rather than a submission that does not exist', () => {
    expect(inbound().href).toBe('/counsel/signing/req-1');
    expect(outbound().href).toBe('/counsel/forms/approvals/sub-1');
  });

  /**
   * An inbound authorisation sends nothing to anybody, so it can have no
   * delivery failure and must stay out of the 'failed' view, where a retry
   * could not act on it.
   */
  it('is never a failed delivery', () => {
    expect(inbound({ authorizationStatus: 'approved' }).releaseError).toBeNull();
    expect(selectQueue([inbound({ authorizationStatus: 'approved' })], params({ view: 'failed' }), NOW))
      .toHaveLength(0);
  });
});

describe('the facet narrows one list rather than opening a second', () => {
  const rows = [outbound(), inbound(), inbound({ id: 'req-2' })];

  it('shows both halves by default', () => {
    expect(selectQueue(rows, params(), NOW).map((r) => r.id).sort()).toEqual([
      'req-1',
      'req-2',
      'sub-1',
    ]);
  });

  it.each([
    ['outbound', ['sub-1']],
    ['inbound', ['req-1', 'req-2']],
  ] as const)('narrows to %s', (dir, ids) => {
    expect(selectQueue(rows, params({ dir }), NOW).map((r) => r.id).sort()).toEqual([...ids]);
  });

  it('reads an unrecognised facet in the URL as everything', () => {
    expect(parseApprovalQueueParams({ dir: 'sideways' }).dir).toBe('all');
    expect(parseApprovalQueueParams({}).dir).toBe('all');
    expect(parseApprovalQueueParams({ dir: 'inbound' }).dir).toBe('inbound');
  });

  it('keeps the facet in the URL, and out of it at the default', () => {
    expect(approvalQueueHref(params({ dir: 'inbound' }), {})).toBe(
      '/counsel/forms/approvals?dir=inbound',
    );
    expect(approvalQueueHref(params(), {})).toBe('/counsel/forms/approvals');
  });

  /**
   * Mutation: leave selectHistory unfiltered by direction. This goes red.
   *
   * A facet that narrows the queue and not the history under it is a screen
   * where a reviewer looking at one direction reads the other one's decisions
   * without being told.
   */
  it('narrows the decision history too', () => {
    const settled = [
      outbound({ id: 'sent', status: 'sent' }),
      inbound({ id: 'signed-off', authorizationStatus: 'approved' }),
    ];
    // 'approved' is not terminal, so the inbound row here is deliberately the
    // declined one for the history case.
    const declined = inbound({ id: 'no', authorizationStatus: 'declined' });
    const all = [...settled, declined];
    expect(selectHistory(all, params({ dir: 'outbound' })).map((r) => r.id)).toEqual(['sent']);
    expect(selectHistory(all, params({ dir: 'inbound' })).map((r) => r.id)).toEqual(['no']);
    expect(selectHistory(all, params()).map((r) => r.id).sort()).toEqual(['no', 'sent']);
  });
});

/**
 * THE COUNTS-ARE-COUNTS PROPERTY, APPLIED TO THE NEW STRIP.
 *
 * This repo has shipped a total tallied over a different set from the list
 * beneath it on four surfaces. The facet count therefore comes from
 * selectQueue itself, the same call the list is built from, and not from a
 * parallel predicate that happens to agree today.
 */
describe('a facet count is the length of the list its own tab would show', () => {
  const rows = [
    outbound({ id: 'a' }),
    outbound({ id: 'b', templateName: 'Vendor form' }),
    inbound({ id: 'c' }),
  ];

  it('agrees with the list, under a search and without one', () => {
    for (const p of [params(), params({ q: 'vendor' }), params({ q: 'northwind' })]) {
      const counts = directionFacetCounts(rows, p, NOW);
      for (const dir of QUEUE_DIRECTION_FACETS) {
        expect(counts[dir], `${dir} under q=${p.q}`).toBe(
          selectQueue(rows, { ...p, dir }, NOW).length,
        );
      }
    }
  });

  /**
   * Mutation: have settledTally keep using the server count while the facet
   * is narrowed. This goes red.
   *
   * The server's settled count is over firm_template_submissions alone, so it
   * cannot describe the inbound half or a narrowed mixed queue. Stating it
   * over a narrowed list is the exact defect this family of tests exists for.
   */
  it('does not state a server total over a narrowed list', () => {
    const counts = { waiting: 9, aging: 0, failed: 0, open: 9, settled: 412 };
    const settled = [outbound({ id: 'sent', status: 'sent' })];
    expect(settledTally(settled, counts, 'all').total).toBe(412);
    expect(settledTally(settled, counts, 'outbound').total).toBe(1);
    expect(settledTally(settled, counts, 'outbound').bounded).toBe(false);
  });
});

describe('the two framings', () => {
  it('never call the sender a recipient', () => {
    expect(queueFraming('outbound').partyColumn).toBe('Recipient');
    expect(queueFraming('inbound').partyColumn).toBe('Sent to us by');
    expect(matchesDirection(inbound(), 'inbound')).toBe(true);
    expect(matchesDirection(inbound(), 'outbound')).toBe(false);
    expect(matchesDirection(inbound(), 'all')).toBe(true);
  });

  it('names every facet, including the unnarrowed one', () => {
    for (const key of QUEUE_DIRECTION_FACETS) {
      expect(DIRECTION_FACET_LABEL[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

/**
 * The list is direction-blind except in one place, and that place is the
 * preposition. Comments are stripped before matching, because the block being
 * matched is surrounded by prose naming both words.
 */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('the row itself', () => {
  const src = () =>
    stripComments(
      readFileSync(
        fileURLToPath(new URL('../components/counsel/SubmissionList.tsx', import.meta.url)),
        'utf8',
      ),
    );

  /**
   * Mutation: hard-code the submission path back into the link. This goes
   * red, and it is the mutation that would send every inbound authorisation
   * to a page holding no such record.
   */
  it('links where the row says rather than where the id suggests', () => {
    const s = src();
    expect(s).toMatch(/href=\{s\.href\}/);
    expect(s).not.toContain('/counsel/forms/approvals/${s.id}');
  });

  /**
   * Mutation: drop the conditional and print "to" for both. This goes red.
   */
  it('says from when the document came to us', () => {
    expect(src()).toMatch(
      /s\.direction === 'inbound' \? <T>from<\/T> : <T>to<\/T>/,
    );
  });
});
