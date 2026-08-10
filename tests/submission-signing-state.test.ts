import { describe, expect, it } from 'vitest';
import {
  resolveSubmissionSigningState,
  type SubmissionSigning,
} from '../lib/template-submission-types';

/**
 * Whose turn it is on a submission that went out for signature, as the
 * employee's own page has to say it.
 *
 * The employee is the one person in this flow who has never been told
 * anything after they pressed send, so the sentence their page shows is the
 * whole of what they know. It has to be true for the three states that
 * actually occur (nobody has signed, the other side has signed and the
 * employee has not, everyone has signed) and it must not invent a fourth.
 *
 * The rule is pure and lives beside the shapes both UIs already share,
 * because the same three sentences are wanted on the portal page and in the
 * notification body, and two functions deciding "whose turn is it" is two
 * answers the moment one of them is edited.
 */

function signing(over: Partial<SubmissionSigning> = {}): SubmissionSigning {
  return {
    status: 'sent',
    signers: [],
    executedUrl: null,
    // The viewer's own signing link. Not part of any rule below: whose turn
    // it is, is decided from the signature rows, and a token is a route to
    // the ceremony rather than a fact about it.
    yourSignToken: null,
    // When it went out. Not part of any rule below: whose turn it is comes
    // off the signature rows, and the send time only ever answers how long
    // the quiet has lasted.
    sentAt: null,
    ...over,
  };
}

/* `activity` and `response` are on every signer now. Neither bears on whose
   turn it is, which is what this file is about, so they are null throughout
   and the rule must keep ignoring them. */
const COUNTERPARTY = {
  name: 'Dana Whitfield',
  email: 'dana@northwind.test',
  signedAt: null,
  activity: null,
  response: null,
};
const EMPLOYEE = {
  name: 'Sam Ortiz',
  email: 'sam@anderson.test',
  signedAt: null,
  activity: null,
  response: null,
};

describe('resolveSubmissionSigningState', () => {
  it('says who it is waiting on while nobody has signed', () => {
    const state = resolveSubmissionSigningState(
      signing({ status: 'sent', signers: [COUNTERPARTY] }),
      EMPLOYEE.email,
    );
    expect(state).toEqual({ kind: 'waiting', waitingOn: 'Dana Whitfield' });
  });

  /**
   * The counter-signature case. It is not reachable until the employee is
   * added as a second signer, and it is pinned now because the sentence it
   * produces is the one the employee acts on: their own signature is what the
   * document is waiting for.
   */
  it('tells the employee it is their turn once every other signer is in', () => {
    const state = resolveSubmissionSigningState(
      signing({
        status: 'partial',
        signers: [{ ...COUNTERPARTY, signedAt: '2026-08-07T10:00:00.000Z' }, EMPLOYEE],
      }),
      EMPLOYEE.email,
    );
    expect(state).toEqual({ kind: 'your_turn', signedBy: 'Dana Whitfield' });
  });

  /**
   * A viewer who is not a signer never gets told it is their turn, however
   * few signatures are outstanding. The legal team reads this page too.
   */
  it('waits rather than claiming a turn for someone who is not a signer', () => {
    const state = resolveSubmissionSigningState(
      signing({ status: 'sent', signers: [COUNTERPARTY] }),
      'legal@anderson.test',
    );
    expect(state).toEqual({ kind: 'waiting', waitingOn: 'Dana Whitfield' });
  });

  it('is complete only when the request itself says so', () => {
    expect(
      resolveSubmissionSigningState(
        signing({
          status: 'completed',
          signers: [{ ...COUNTERPARTY, signedAt: '2026-08-07T10:00:00.000Z' }],
        }),
        EMPLOYEE.email,
      ),
    ).toEqual({ kind: 'complete' });
  });

  /**
   * Every signature row is in but the parent status has not rolled over yet.
   * The status is the authority, so this is not complete: the executed copy
   * does not exist until the rollup writes it, and a page that says "fully
   * signed" beside nothing to download is the one thing this panel must never
   * do. It also cannot name anyone it is waiting on, because nobody is
   * outstanding, so it says it is waiting and names no one.
   */
  it('does not call it complete on the strength of the signature rows alone', () => {
    const state = resolveSubmissionSigningState(
      signing({
        status: 'partial',
        signers: [{ ...COUNTERPARTY, signedAt: '2026-08-07T10:00:00.000Z' }],
      }),
      EMPLOYEE.email,
    );
    expect(state).toEqual({ kind: 'waiting', waitingOn: null });
  });

  it('reports a canceled request as halted rather than as waiting', () => {
    expect(
      resolveSubmissionSigningState(
        signing({ status: 'canceled', signers: [COUNTERPARTY] }),
        EMPLOYEE.email,
      ),
    ).toEqual({ kind: 'halted' });
  });

  /** A draft was never sent, so there is nobody to be waiting on. */
  it('reports a draft request as halted', () => {
    expect(
      resolveSubmissionSigningState(
        signing({ status: 'draft', signers: [COUNTERPARTY] }),
        EMPLOYEE.email,
      ),
    ).toEqual({ kind: 'halted' });
  });

  /** Nothing to wait for is not the same as waiting for nobody. */
  it('reports a request with no signers as halted', () => {
    expect(
      resolveSubmissionSigningState(signing({ status: 'sent', signers: [] }), EMPLOYEE.email),
    ).toEqual({ kind: 'halted' });
  });

  it('falls back to the email address when a signer has no name', () => {
    const state = resolveSubmissionSigningState(
      signing({ status: 'sent', signers: [{ ...COUNTERPARTY, name: null }] }),
      EMPLOYEE.email,
    );
    expect(state).toEqual({ kind: 'waiting', waitingOn: 'dana@northwind.test' });
  });

  /**
   * Addresses are stored lowercased on the signature row and typed by a human
   * on the submission. A case difference must not cost the employee the
   * sentence that tells them to go and sign.
   */
  it('matches the viewer against the signer list case-insensitively', () => {
    const state = resolveSubmissionSigningState(
      signing({
        status: 'partial',
        signers: [
          { ...COUNTERPARTY, signedAt: '2026-08-07T10:00:00.000Z' },
          { ...EMPLOYEE, email: 'sam@anderson.test' },
        ],
      }),
      '  SAM@Anderson.test ',
    );
    expect(state).toEqual({ kind: 'your_turn', signedBy: 'Dana Whitfield' });
  });

  /**
   * With the migration unapplied there is no signing_request_id to follow, so
   * the page is handed no signing record at all. It must render exactly as it
   * does today rather than showing an empty panel.
   */
  it('has nothing to say when there is no signing record', () => {
    expect(resolveSubmissionSigningState(null, EMPLOYEE.email)).toBeNull();
  });
});
