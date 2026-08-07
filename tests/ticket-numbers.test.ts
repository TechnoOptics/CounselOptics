import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_PREFIX,
  TICKET_MAX,
  TICKET_PAD,
  displayTicket,
  formatTicketNumber,
  nextTicketSeq,
  normalizeTicketPrefix,
  parseTicketSeq,
} from '../lib/ticket-numbers';
import { ticketRef } from '../lib/intake-conversation-types';

/**
 * The per-firm ticket number, as pure rules.
 *
 * These functions exist to be tested. The allocator around them
 * (lib/ticket-allocator.ts) talks to the database and cannot run under
 * `environment: 'node'`, so everything that could be got wrong arithmetically
 * lives here instead: the width of the pad, the ordering that width buys, the
 * point at which the series has to refuse, and what a firm's prefix is allowed
 * to be.
 */

describe('formatTicketNumber', () => {
  /**
   * Seven digits, from the owner, confirmed. The pad is not a formatting
   * preference: the allocator reads the highest existing number back with a
   * TEXT sort, and only a fixed width makes that sort agree with the numbers
   * it is standing in for. See the ordering test below.
   */
  it('pads to exactly seven digits', () => {
    expect(TICKET_PAD).toBe(7);
    expect(formatTicketNumber('REQ', 1)).toBe('REQ-0000001');
    expect(formatTicketNumber('REQ', 412)).toBe('REQ-0000412');
    expect(formatTicketNumber('REQ', TICKET_MAX)).toBe('REQ-9999999');
  });

  /** The prefix is normalised on the way in, so no caller can widen it. */
  it('normalises the prefix it is handed', () => {
    expect(formatTicketNumber('nda-', 7)).toBe('NDA-0000007');
    expect(formatTicketNumber('', 7)).toBe('REQ-0000007');
  });

  /**
   * The series starts at 0000000 in the client's words, which is the resting
   * state of a firm that has filed nothing. The first ticket actually issued
   * is 0000001, because 0000000 is what the counter reads before it moves.
   */
  it('leaves 0000000 as the unissued state', () => {
    expect(formatTicketNumber('REQ', 0)).toBe('REQ-0000000');
    expect(nextTicketSeq(null)).toEqual({ ok: true, seq: 1 });
  });
});

describe('the ordering the fixed pad buys', () => {
  /**
   * THIS IS THE TEST THAT PROTECTS THE ALLOCATOR. It reads the highest number
   * for a firm with `.order('ticket_number', { ascending: false })`, which is
   * a text sort in Postgres, and then trusts that row to be the numeric
   * maximum. That is only true while every number in the series is the same
   * width. An eighth digit would sort 'REQ-10000000' below 'REQ-9999999', the
   * allocator would read a used number as the highest, and it would re-issue
   * numbers that are already on the record. Refusing at TICKET_MAX is what
   * keeps this property true, so the two tests belong together.
   */
  it('sorts as text exactly as it sorts as numbers', () => {
    const seqs = [1, 2, 9, 10, 11, 99, 100, 999, 1000, 54321, 999999, 1000000, TICKET_MAX];
    const shuffled = [...seqs].reverse();
    const byText = shuffled
      .map((n) => formatTicketNumber('REQ', n))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byNumber = [...seqs].sort((a, b) => a - b).map((n) => formatTicketNumber('REQ', n));
    expect(byText).toEqual(byNumber);
  });
});

describe('parseTicketSeq', () => {
  /**
   * Prefix-agnostic on purpose. A firm may change its prefix, and when it
   * does the series has to carry on rather than reset onto numbers that are
   * already on filed documents. The parser therefore reads the trailing
   * digits and ignores everything in front of them, which is the same
   * `/(\d+)\s*$/` the invoice allocator has used since 2026-07-03.
   */
  it('reads the trailing digits whatever the prefix is', () => {
    expect(parseTicketSeq('REQ-0000412')).toBe(412);
    expect(parseTicketSeq('ACME-0000412')).toBe(412);
    expect(parseTicketSeq('X2-9999999')).toBe(9999999);
    expect(parseTicketSeq('REQ-0000412 ')).toBe(412);
  });

  it('reads anything unparseable as zero, so a firm starts at one', () => {
    expect(parseTicketSeq(null)).toBe(0);
    expect(parseTicketSeq(undefined)).toBe(0);
    expect(parseTicketSeq('')).toBe(0);
    expect(parseTicketSeq('REQ-')).toBe(0);
    expect(parseTicketSeq('no digits here')).toBe(0);
    expect(parseTicketSeq('REQ-0000000')).toBe(0);
  });
});

describe('nextTicketSeq', () => {
  it('is one past the highest number already filed', () => {
    expect(nextTicketSeq('REQ-0000000')).toEqual({ ok: true, seq: 1 });
    expect(nextTicketSeq('REQ-0000411')).toEqual({ ok: true, seq: 412 });
    expect(nextTicketSeq('ACME-0009998')).toEqual({ ok: true, seq: 9999 });
  });

  /**
   * REFUSE, DO NOT WRAP. An eighth digit breaks the text ordering above and
   * makes the allocator re-issue numbers that are already on filed documents.
   * Wrapping would do the same thing without even the courtesy of an error.
   * A firm that has filed ten million documents is told plainly; nothing
   * silently produces a number that sorts in the wrong place.
   */
  it('refuses at the end of the series rather than wrapping', () => {
    const at = nextTicketSeq(`REQ-${TICKET_MAX}`);
    expect(at.ok).toBe(false);
    if (!at.ok) expect(at.reason).toContain('9999999');

    // And it stays refused if a row somehow already holds an eighth digit,
    // rather than quietly carrying on from it.
    expect(nextTicketSeq('REQ-10000000').ok).toBe(false);
  });

  it('allows the last number in the series', () => {
    expect(nextTicketSeq(`REQ-${TICKET_MAX - 1}`)).toEqual({ ok: true, seq: TICKET_MAX });
  });
});

describe('normalizeTicketPrefix', () => {
  it('uppercases and strips anything that is not a letter or a digit', () => {
    expect(normalizeTicketPrefix('acme')).toBe('ACME');
    expect(normalizeTicketPrefix(' n.d.a ')).toBe('NDA');
    expect(normalizeTicketPrefix('req-')).toBe('REQ');
    expect(normalizeTicketPrefix('A1')).toBe('A1');
  });

  /**
   * Two to eight characters. Below two there is nothing to recognise a
   * document by; above eight the reference stops being quotable on a phone
   * call, which is the whole point of having one.
   */
  it('falls back to the default for anything outside two to eight characters', () => {
    expect(DEFAULT_TICKET_PREFIX).toBe('REQ');
    expect(normalizeTicketPrefix('')).toBe('REQ');
    expect(normalizeTicketPrefix('A')).toBe('REQ');
    expect(normalizeTicketPrefix('!!')).toBe('REQ');
    expect(normalizeTicketPrefix('ABCDEFGHI')).toBe('REQ');
    expect(normalizeTicketPrefix(null)).toBe('REQ');
    expect(normalizeTicketPrefix(undefined)).toBe('REQ');
    expect(normalizeTicketPrefix(12345)).toBe('REQ');
    expect(normalizeTicketPrefix('ABCDEFGH')).toBe('ABCDEFGH');
  });
});

describe('displayTicket', () => {
  /**
   * One helper, so a document is never quoted two different ways. A row that
   * has a real number shows it; a row filed before the allocator existed
   * shows the same derived reference the rest of the product has always used
   * for a record with no number of its own. Numbers are never backfilled, so
   * which of the two a given record shows is fixed for its lifetime.
   */
  it('prefers the stored number', () => {
    expect(displayTicket({ ticketNumber: 'ACME-0000412', id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toBe(
      'ACME-0000412',
    );
  });

  it('falls back to the derived reference when there is no number', () => {
    const id = '4f2a9c00-0000-4000-8000-000000000000';
    expect(displayTicket({ ticketNumber: null, id })).toBe(ticketRef(id));
    expect(displayTicket({ id })).toBe(ticketRef(id));
    expect(displayTicket({ ticketNumber: '   ', id })).toBe(ticketRef(id));
  });
});
