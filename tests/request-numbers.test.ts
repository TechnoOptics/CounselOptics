import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_PREFIX,
  FIRST_REQUEST_SEQ,
  TICKET_MAX,
  TICKET_PAD,
  displayRequest,
  formatRequestNumber,
  nextRequestSeq,
  normalizeRequestPrefix,
  parseRequestSeq,
} from '../lib/ticket-numbers';
import { ticketRef } from '../lib/intake-conversation-types';

/**
 * The reference on a legal request, as pure rules.
 *
 * The owner's example is ZT0001000, and it differs from the two series this
 * product already runs in two ways that this file pins: there is NO separator,
 * and the series starts at 1000 rather than at 1.
 */

describe('the shape the owner asked for', () => {
  it('renders the example exactly: ZT0001000', () => {
    expect(formatRequestNumber('ZT', 1000)).toBe('ZT0001000');
  });

  it('has no separator, unlike the submission and matter series', () => {
    expect(formatRequestNumber('ZT', 1000)).not.toContain('-');
  });

  it('pads every number to the same seven digits', () => {
    expect(formatRequestNumber('ZT', 1)).toBe('ZT0000001');
    expect(formatRequestNumber('ZT', 9999999)).toBe('ZT9999999');
    for (const seq of [1, 42, 1000, 999999]) {
      expect(formatRequestNumber('ZT', seq).slice(-TICKET_PAD)).toHaveLength(TICKET_PAD);
    }
  });
});

describe('the prefix', () => {
  it('falls back to the default when a firm has set none', () => {
    expect(normalizeRequestPrefix(null)).toBe(DEFAULT_REQUEST_PREFIX);
    expect(normalizeRequestPrefix('')).toBe(DEFAULT_REQUEST_PREFIX);
  });

  /**
   * Not REQ and not MAT. Those are the submission and matter defaults, and two
   * counters sharing one prefix eventually issue the same reference for two
   * different kinds of record.
   */
  it('does not default to another series prefix', () => {
    expect(DEFAULT_REQUEST_PREFIX).not.toBe('REQ');
    expect(DEFAULT_REQUEST_PREFIX).not.toBe('MAT');
  });

  it('uppercases and strips punctuation rather than refusing it', () => {
    expect(normalizeRequestPrefix('z.t.')).toBe('ZT');
    expect(normalizeRequestPrefix(' zin ')).toBe('ZIN');
  });

  it('falls back when the result is too short or too long to quote', () => {
    expect(normalizeRequestPrefix('Z')).toBe(DEFAULT_REQUEST_PREFIX);
    expect(normalizeRequestPrefix('ABCDEFGHI')).toBe(DEFAULT_REQUEST_PREFIX);
  });
});

describe('where a firm starts', () => {
  it("gives a firm with nothing filed the owner's starting number", () => {
    expect(FIRST_REQUEST_SEQ).toBe(1000);
    expect(nextRequestSeq(null)).toEqual({ ok: true, seq: 1000 });
  });

  it('carries on from the highest number the firm already has', () => {
    expect(nextRequestSeq('ZT0001000')).toEqual({ ok: true, seq: 1001 });
    expect(nextRequestSeq('ZT0009999')).toEqual({ ok: true, seq: 10000 });
  });

  it('refuses at the end of the series rather than growing an eighth digit', () => {
    const res = nextRequestSeq(`ZT${String(TICKET_MAX)}`);
    expect(res.ok).toBe(false);
  });
});

/**
 * THE PROPERTY THE MISSING SEPARATOR CREATES.
 *
 * The two existing series read their sequence with /(\d+)\s*$/, every trailing
 * digit. That is safe only because a hyphen always stands between the prefix
 * and the number. With no separator a prefix is allowed to end in a digit, and
 * that rule would read the prefix as part of the number: 'A1' + 0001000 would
 * parse as ten million, the series would jump to the end and refuse.
 *
 * So this series parses a FIXED WIDTH: the last seven characters, and only
 * when all seven are digits.
 */
describe('reading the number back out', () => {
  it('is not fooled by a prefix that ends in a digit', () => {
    expect(parseRequestSeq('A10001000')).toBe(1000);
    expect(parseRequestSeq(formatRequestNumber('A1', 1000))).toBe(1000);
  });

  it('continues the series correctly for a digit-bearing prefix', () => {
    expect(nextRequestSeq(formatRequestNumber('A1', 1000))).toEqual({ ok: true, seq: 1001 });
  });

  it('reads an ordinary number', () => {
    expect(parseRequestSeq('ZT0001000')).toBe(1000);
    expect(parseRequestSeq('TKT0000001')).toBe(1);
  });

  it('reads anything unparseable as nothing filed yet', () => {
    expect(parseRequestSeq(null)).toBe(0);
    expect(parseRequestSeq('')).toBe(0);
    expect(parseRequestSeq('REQ-4F2A9C')).toBe(0);
  });
});

/**
 * The allocator finds the next number with ORDER BY on a TEXT column, so a
 * text sort has to agree with a numeric one. It does only while every number
 * is the same width, which is what the fixed pad buys.
 */
describe('the text sort the allocator depends on', () => {
  it('orders the series the same way numbers order', () => {
    const seqs = [1, 2, 9, 10, 99, 100, 1000, 1001, 9999, 999999, 9999999];
    const formatted = seqs.map((s) => formatRequestNumber('ZT', s));
    expect([...formatted].sort()).toEqual(formatted);
  });
});

/**
 * NEVER BACKFILLED, and this is the property that protects mail already sent.
 *
 * A request filed before the column existed keeps the derived reference it was
 * emailed under. Which of the two a given request shows is fixed for its whole
 * life, so nobody is ever handed two references for one request.
 */
describe('displayRequest', () => {
  const id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  it('shows the allocated number when the request has one', () => {
    expect(displayRequest({ requestNumber: 'ZT0001000', id })).toBe('ZT0001000');
  });

  it('shows the reference already sent when the request has no number', () => {
    expect(displayRequest({ requestNumber: null, id })).toBe(ticketRef(id));
    expect(displayRequest({ id })).toBe(ticketRef(id));
    expect(displayRequest({ requestNumber: '   ', id })).toBe(ticketRef(id));
  });

  /**
   * Stated as its own test because it is the whole argument for not
   * backfilling: an email sent yesterday quoting REQ-FFFFFF still names this
   * request, and the counsel inbox's reference filter still finds it.
   */
  it('leaves an already-sent reference resolvable', () => {
    const sentYesterday = ticketRef(id);
    expect(displayRequest({ requestNumber: null, id })).toBe(sentYesterday);
  });
});
