import { describe, expect, it } from 'vitest';
import {
  SIGNER_ALREADY_SIGNED_SENTENCE,
  SIGNER_COPY_RETENTION_DAYS,
  SIGNER_COPY_RETENTION_EXPIRED_COPY,
  resolveSignerCopyRetention,
  signerRetentionSentence,
} from '../lib/signer-retention';

/**
 * The retention rule, and the sentence that states it.
 *
 * The client asked for the signing link to be killed the moment it is
 * used. That cannot be done, and the reason is not technical: E-SIGN at
 * 15 USC 7001(a)(1) and (d) condition the validity of an electronic
 * record on the person bound by it being able to retain it, and this
 * link is the signer's retention path. So the product does the honest
 * thing instead: the request cannot be signed twice, and the copy stays
 * reachable for a stated period rather than forever or for no time at
 * all.
 *
 * Everything below is a decision that could be wrong on its own, which
 * is why it is a pure function over plain values rather than a branch
 * inside a route handler.
 */

const DAY = 24 * 60 * 60 * 1000;
const COMPLETED = '2026-08-01T12:00:00.000Z';
const completedMs = Date.parse(COMPLETED);

describe('the retention window', () => {
  it('is a fixed number of whole days, stated as a number and not derived', () => {
    // The sentence the signer reads interpolates this. If it ever
    // becomes a computed or per-firm value, the sentence has to be
    // re-read as well, so pinning it here is what makes that a visible
    // change rather than a quiet one.
    expect(SIGNER_COPY_RETENTION_DAYS).toBe(90);
    expect(Number.isInteger(SIGNER_COPY_RETENTION_DAYS)).toBe(true);
  });

  it('is still available one millisecond before the window closes', () => {
    expect(
      resolveSignerCopyRetention({
        completedAt: COMPLETED,
        now: new Date(completedMs + SIGNER_COPY_RETENTION_DAYS * DAY - 1),
      }),
    ).toBe('available');
  });

  it('is expired at the exact millisecond the window closes', () => {
    // Both sides of the boundary, because "expires in 90 days" read as
    // "expires on day 91" is the sort of off-by-one that only shows up
    // in front of the one signer it locks out.
    expect(
      resolveSignerCopyRetention({
        completedAt: COMPLETED,
        now: new Date(completedMs + SIGNER_COPY_RETENTION_DAYS * DAY),
      }),
    ).toBe('expired');
  });

  it('is available at the moment of completion', () => {
    expect(
      resolveSignerCopyRetention({ completedAt: COMPLETED, now: new Date(completedMs) }),
    ).toBe('available');
  });

  it('treats a missing completion time as available', () => {
    // Fail OPEN on retention, and only on retention. Every other gate on
    // this surface fails closed, but refusing a signer the record they
    // signed is the one failure E-SIGN does not tolerate, and a null
    // completed_at means the clock has not started: either the other
    // party has not signed yet, or the column was never written.
    for (const completedAt of [null, undefined, '', 'not a date']) {
      expect(
        resolveSignerCopyRetention({ completedAt, now: new Date('2099-01-01') }),
      ).toBe('available');
    }
  });

  it('is available for a completion time in the future', () => {
    // A clock skew between the database and this process must not read
    // as an expiry.
    expect(
      resolveSignerCopyRetention({
        completedAt: COMPLETED,
        now: new Date(completedMs - 5 * DAY),
      }),
    ).toBe('available');
  });

  it('defaults `now` to the current time rather than to the epoch', () => {
    // A missing `now` defaulting to 0 would read as "the window closed
    // in 1970" and refuse every signer.
    expect(resolveSignerCopyRetention({ completedAt: new Date().toISOString() })).toBe(
      'available',
    );
  });
});

describe('the sentence the signer reads', () => {
  it('opens by saying what cannot happen again, not that the link is gone', () => {
    // The whole point of this slice. The link is not dead, deleted or
    // expired at the moment of signing, and saying so would be false.
    const sentence = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: false,
      now: new Date(completedMs),
    });
    expect(sentence.startsWith(SIGNER_ALREADY_SIGNED_SENTENCE)).toBe(true);
    expect(SIGNER_ALREADY_SIGNED_SENTENCE).toBe(
      'This document has been signed and cannot be signed again.',
    );
  });

  it('states the window in days, and counts down as it runs', () => {
    const atCompletion = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: false,
      now: new Date(completedMs),
    });
    expect(atCompletion).toBe(
      'This document has been signed and cannot be signed again. This page ' +
        'stays available to you for 90 more days so you can keep your copy.',
    );

    const nearlyOver = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: false,
      now: new Date(completedMs + 89 * DAY),
    });
    expect(nearlyOver).toContain('for 1 more day so you can keep your copy.');
    // Singular, because "1 more days" is the kind of thing that makes a
    // legal surface look unattended.
    expect(nearlyOver).not.toContain('1 more days');
  });

  it('says "at least" while the clock has not started', () => {
    // This signer has signed but the other party has not, so completed_at
    // is null and the window has not begun. The page must not understate
    // OR overstate: it will be at least this long, and probably longer.
    const sentence = signerRetentionSentence({
      completedAt: null,
      accessCodeRequired: false,
      now: new Date(),
    });
    expect(sentence).toBe(
      'This document has been signed and cannot be signed again. This page ' +
        'stays available to you for at least 90 days after everyone has ' +
        'signed, so you can keep your copy.',
    );
  });

  it('mentions the access code only to a signer who has one', () => {
    // The repo's standing rule on this surface: a claim is made only
    // when it is true. An internal signer has no access_code_hash, so
    // telling them to fetch a code they were never sent would send them
    // looking through their inbox for nothing.
    const external = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: true,
      now: new Date(completedMs),
    });
    expect(external.endsWith('You will need your access code to open it.')).toBe(true);

    const internal = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: false,
      now: new Date(completedMs),
    });
    expect(internal).not.toContain('access code');
  });

  it('says what is still possible once the window has passed, not what is forbidden', () => {
    const sentence = signerRetentionSentence({
      completedAt: COMPLETED,
      accessCodeRequired: true,
      now: new Date(completedMs + 200 * DAY),
    });
    expect(sentence.startsWith(SIGNER_ALREADY_SIGNED_SENTENCE)).toBe(true);
    expect(sentence).toContain(SIGNER_COPY_RETENTION_EXPIRED_COPY);
    expect(sentence).toContain('The firm can send you a copy at any time.');
    // No code sentence: there is nothing left here to open.
    expect(sentence).not.toContain('access code');
  });

  it('never claims the link stops existing, or that screenshots are stopped', () => {
    // Two claims this repo has decided, in writing, that it will not
    // make. components/NoCapture.tsx and app/globals.css both say a
    // browser cannot block a screenshot, and the link demonstrably
    // still resolves after signing, because that is the retention path.
    const forbidden =
      /\b(deleted|destroyed|dead|disabled|revoked|invalid|screenshot|screen recording|expired immediately|no longer exists|stops working)\b/i;
    for (const accessCodeRequired of [true, false]) {
      for (const completedAt of [null, COMPLETED]) {
        for (const now of [
          new Date(completedMs),
          new Date(completedMs + 89 * DAY),
          new Date(completedMs + 200 * DAY),
        ]) {
          const sentence = signerRetentionSentence({
            completedAt,
            accessCodeRequired,
            now,
          });
          expect(sentence).not.toMatch(forbidden);
        }
      }
    }
    expect(SIGNER_COPY_RETENTION_EXPIRED_COPY).not.toMatch(forbidden);
    expect(SIGNER_ALREADY_SIGNED_SENTENCE).not.toMatch(forbidden);
  });

  it('is free of em dashes and emoji, like every other sentence on this surface', () => {
    const all = [
      SIGNER_ALREADY_SIGNED_SENTENCE,
      SIGNER_COPY_RETENTION_EXPIRED_COPY,
      signerRetentionSentence({
        completedAt: COMPLETED,
        accessCodeRequired: true,
        now: new Date(completedMs),
      }),
      signerRetentionSentence({
        completedAt: null,
        accessCodeRequired: false,
        now: new Date(),
      }),
    ];
    for (const s of all) {
      // Written as an escape so the character itself does not appear in
      // this repo's source, which is the rule this line enforces.
      expect(s).not.toContain('\u2014');
      expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
