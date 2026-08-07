import { describe, expect, it } from 'vitest';
import {
  checkDispatchable,
  counterSignatureParty,
  parseDeliveryMode,
  resolveDeliveryModeColumnFallback,
  DELIVERY_MODE_UNSAVED_ERROR,
  type DispatchCandidate,
} from '../lib/submission-dispatch';
import { checkReleasable } from '../lib/template-approval';

/**
 * The mode-aware gate in front of dispatch.
 *
 * tests/template-approval.test.ts pins checkReleasable, the one rule that
 * decides whether an approved document may leave the building at all. This
 * file pins the layer above it: which of the two deliveries an approved
 * submission takes, and the one refusal that only the signature mode has.
 *
 * The thing worth guarding here is that there is still ONE gate. If
 * checkDispatchable ever grew its own copy of the status, approver, recipient
 * and document checks, the two would drift and the copy that ran first would
 * become the real gate. So the tests below assert the shared refusals come
 * back with checkReleasable's own wording, character for character.
 */

const approved: DispatchCandidate = {
  status: 'approved',
  decidedBy: 'user-1',
  decidedAt: '2026-08-07T10:00:00.000Z',
  recipientEmail: 'counterparty@vendor.test',
  documentText: 'A document with words in it.',
  releasedAt: null,
  deliveryMode: 'share',
  documentId: null,
  signingRequestId: null,
};

describe('parseDeliveryMode', () => {
  it('reads the two modes the column may hold', () => {
    expect(parseDeliveryMode('share')).toBe('share');
    expect(parseDeliveryMode('signature')).toBe('signature');
  });

  /**
   * Absent is the case that matters most: the column arrives with a migration
   * the owner applies, so until then every read of it is undefined. Coercing
   * to 'share' is what makes this change do nothing at all on an unmigrated
   * database rather than sending documents down a path the firm never chose.
   */
  it('coerces anything it does not recognise to share', () => {
    expect(parseDeliveryMode(undefined)).toBe('share');
    expect(parseDeliveryMode(null)).toBe('share');
    expect(parseDeliveryMode('')).toBe('share');
    expect(parseDeliveryMode('sign')).toBe('share');
    expect(parseDeliveryMode(1)).toBe('share');
    expect(parseDeliveryMode({ mode: 'signature' })).toBe('share');
  });

  /**
   * Case-sensitive, deliberately, and in the fail-safe direction. This is the
   * same discipline sanitizeFields uses for an unknown field type: an
   * unrecognised value becomes the harmless one rather than being guessed at.
   */
  it('does not accept a differently-cased spelling', () => {
    expect(parseDeliveryMode('SIGNATURE')).toBe('share');
    expect(parseDeliveryMode('Signature')).toBe('share');
    expect(parseDeliveryMode(' signature ')).toBe('share');
  });
});

describe('checkDispatchable', () => {
  it('lets an approved share-mode submission through', () => {
    const out = checkDispatchable(approved);
    expect(out).toEqual({ ok: true, mode: 'share' });
  });

  it('lets an approved signature-mode submission through', () => {
    const out = checkDispatchable({ ...approved, deliveryMode: 'signature' });
    expect(out).toEqual({ ok: true, mode: 'signature' });
  });

  it('reports the mode it resolved even from an absent column', () => {
    const out = checkDispatchable({ ...approved, deliveryMode: undefined });
    expect(out).toEqual({ ok: true, mode: 'share' });
  });

  /**
   * Every shared refusal, in both modes, asserted against checkReleasable's
   * own answer rather than against a string typed twice. A second copy of the
   * gate would pass a test that hard-coded the wording; it cannot pass this
   * one.
   */
  const shared: Array<[string, Partial<DispatchCandidate>]> = [
    ['not approved', { status: 'pending' }],
    ['approved but withdrawn', { status: 'withdrawn' }],
    ['no approver recorded', { decidedBy: null }],
    ['no decision time recorded', { decidedAt: null }],
    ['already released', { releasedAt: '2026-08-07T11:00:00.000Z' }],
    ['no recipient', { recipientEmail: null }],
    ['a malformed recipient', { recipientEmail: 'not-an-address' }],
    ['no document', { documentText: '   ' }],
  ];

  for (const [name, patch] of shared) {
    for (const mode of ['share', 'signature'] as const) {
      it(`refuses ${name} in ${mode} mode, with the release gate's own reason`, () => {
        const record = { ...approved, ...patch, deliveryMode: mode };
        const expected = checkReleasable(record);
        expect(expected.ok).toBe(false);
        expect(checkDispatchable(record)).toEqual(expected);
      });
    }
  }

  /**
   * The one refusal that is the signature mode's alone. released_at guards a
   * share against going twice; the signing request id is what guards this
   * one, because a second dispatch would mean two executed PDFs and two audit
   * chains for a single instrument.
   */
  it('refuses a signature-mode submission that already has a signing request', () => {
    const out = checkDispatchable({
      ...approved,
      deliveryMode: 'signature',
      signingRequestId: 'req-1',
    });
    expect(out).toEqual({
      ok: false,
      reason: 'This document has already been sent for signature.',
    });
  });

  /**
   * And it is the signature mode's alone. A share-mode row carrying a stale
   * signing request id (the template was switched back after a dispatch) is
   * still refused, but by released_at, which is the share's own guard. If this
   * clause ever leaked into the share branch it would refuse a document that
   * has never been shared.
   */
  it('does not apply the signing-request clause to a share', () => {
    const out = checkDispatchable({
      ...approved,
      deliveryMode: 'share',
      signingRequestId: 'req-1',
    });
    expect(out).toEqual({ ok: true, mode: 'share' });
  });

  /**
   * A document id on its own is not a dispatch. The PDF is filed before the
   * signing request is created, so a run that stored the document and then
   * failed to create the request must stay retryable: refusing here would
   * strand it.
   */
  it('does not refuse a submission that only got as far as filing the PDF', () => {
    const out = checkDispatchable({
      ...approved,
      deliveryMode: 'signature',
      documentId: 'doc-1',
    });
    expect(out).toEqual({ ok: true, mode: 'signature' });
  });
});

describe('resolveDeliveryModeColumnFallback', () => {
  const missing = {
    code: 'PGRST204',
    message: "Could not find the 'delivery_mode' column of 'firm_templates'",
  };

  /**
   * The column arrives with a migration the owner applies. Until then a write
   * carrying it comes back with the column unknown, and the recovery is right
   * in exactly one direction, the same way resolveDownloadColumnFallback is.
   *
   * 'share' is what an absent column reads as, so retrying without it lands on
   * the behaviour the author chose and the template saves normally.
   */
  it('retries without the column when the author chose share', () => {
    expect(resolveDeliveryModeColumnFallback({ deliveryMode: 'share', error: missing })).toBe(
      'retry-without-column',
    );
  });

  /**
   * 'signature' is not. Dropping the column there would save a template that
   * reads as a read-only share while its author believes it asks for a
   * signature, and they would find out when a counterparty received a document
   * with nowhere to sign. Refusing is the honest answer.
   */
  it('aborts when the author chose signature', () => {
    expect(
      resolveDeliveryModeColumnFallback({ deliveryMode: 'signature', error: missing }),
    ).toBe('abort-mode-unsaved');
  });

  it('surfaces anything that is not a missing column', () => {
    expect(
      resolveDeliveryModeColumnFallback({
        deliveryMode: 'signature',
        error: { code: '23505', message: 'duplicate key value' },
      }),
    ).toBe('surface-error');
    expect(
      resolveDeliveryModeColumnFallback({ deliveryMode: 'signature', error: null }),
    ).toBe('surface-error');
    // A missing column that is not this one belongs to whoever asked for it.
    expect(
      resolveDeliveryModeColumnFallback({
        deliveryMode: 'signature',
        error: { code: 'PGRST204', message: "Could not find the 'category' column" },
      }),
    ).toBe('surface-error');
  });

  it('says what the abort means without naming a table or a column', () => {
    expect(DELIVERY_MODE_UNSAVED_ERROR).toMatch(/administrator/i);
    expect(DELIVERY_MODE_UNSAVED_ERROR).not.toMatch(/delivery_mode|PGRST/);
  });
});

/**
 * Who signs, and in what order.
 *
 * The client's sentence ends "the employee is then prompted to sign and date
 * their own part, completing the process". This is that sentence as a rule.
 * It is pure and it is tested because the alternative shape, a second signing
 * request for the employee, would give one agreement two executed PDFs and two
 * audit chains, and the thing standing between the product and that is this
 * function returning two signers rather than one caller remembering to.
 */
describe('counterSignatureParty', () => {
  const BOTH = {
    recipient_email: 'ops@acme.test',
    recipient_name: 'Acme Ops',
    submitter_email: 'dana@firm.test',
    submitter_name: 'Dana Reyes',
  };

  it('puts the counterparty first and the employee second', () => {
    expect(counterSignatureParty(BOTH)).toEqual([
      { email: 'ops@acme.test', name: 'Acme Ops', order: 1 },
      { email: 'dana@firm.test', name: 'Dana Reyes', order: 2 },
    ]);
  });

  it('numbers them, because an unnumbered pair is invited all at once', () => {
    // Null order is "no order" everywhere in lib/signer-order.ts, so an
    // omitted number here would email the employee their link at the same
    // moment as the counterparty and let them sign an unfinished instrument.
    const [first, second] = counterSignatureParty(BOTH);
    expect(first.order).toBe(1);
    expect(second.order).toBe(2);
    expect(second.order).toBeGreaterThan(first.order);
  });

  it('sends one signer when the record has no submitter address', () => {
    // Submissions filed before the column was populated have none, and there
    // is then nobody to counter-sign. That is today's behaviour, not an error
    // worth refusing an approved document over.
    expect(
      counterSignatureParty({ ...BOTH, submitter_email: null }),
    ).toEqual([{ email: 'ops@acme.test', name: 'Acme Ops', order: 1 }]);
    expect(
      counterSignatureParty({ ...BOTH, submitter_email: '   ' }),
    ).toHaveLength(1);
  });

  it('sends one signer when the employee IS the recipient', () => {
    // Two signature rows for one address would mean two links and two turns
    // for one person, and the second would sit waiting on the first forever.
    expect(
      counterSignatureParty({ ...BOTH, submitter_email: 'ops@acme.test' }),
    ).toHaveLength(1);
    expect(
      counterSignatureParty({ ...BOTH, submitter_email: '  OPS@Acme.TEST ' }),
    ).toHaveLength(1);
  });

  it('normalises the employee address it passes on', () => {
    const [, employee] = counterSignatureParty({
      ...BOTH,
      submitter_email: '  Dana@Firm.TEST ',
    });
    expect(employee.email).toBe('dana@firm.test');
  });

  it('omits a name rather than sending an empty one', () => {
    const signers = counterSignatureParty({
      recipient_email: 'ops@acme.test',
      recipient_name: null,
      submitter_email: 'dana@firm.test',
      submitter_name: null,
    });
    expect(signers[0].name).toBeUndefined();
    expect(signers[1].name).toBeUndefined();
  });
});
