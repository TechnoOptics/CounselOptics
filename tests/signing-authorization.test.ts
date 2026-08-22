import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AUTHORIZATION_STATUS_COLUMN,
  DIRECTION_COLUMN,
  INBOUND_AUTHORIZATION_UNSAVED_ERROR,
  INBOUND_AUTHORIZE_HEADING,
  inboundAuthorizeBody,
  inboundEmployeeLabel,
  inboundEmployeeMessage,
  inboundEmployeeState,
  isInboundRequest,
  readAuthorizationStatus,
  readSigningDirection,
  resolveSignerGate,
  resolveSigningDirectionColumnFallback,
} from '../lib/signing-authorization';

/**
 * supabase/migrations/20260822_signing_request_direction.sql is NOT applied,
 * so absent-column and null are what every reader will meet for now. These
 * are the property, not padding.
 */
describe('which way a signing request runs', () => {
  /**
   * Mutation: flip readSigningDirection to `raw === 'outbound' ? 'outbound'
   * : 'inbound'`. Every case here goes red.
   */
  it.each([
    ['an absent column', undefined],
    ['a null column', null],
    ['an empty string', ''],
    ['the value spelled out', 'outbound'],
    ['a value nobody has heard of', 'incoming'],
    ['a near miss on the real value', 'Inbound'],
    ['a number', 1],
    ['an object', {}],
  ])('reads %s as outbound', (_label, raw) => {
    expect(readSigningDirection(raw)).toBe('outbound');
    expect(isInboundRequest(raw)).toBe(false);
  });

  it('reads the one exact value as inbound', () => {
    expect(readSigningDirection('inbound')).toBe('inbound');
    expect(isInboundRequest('inbound')).toBe(true);
  });
});

describe('the authorisation on a request', () => {
  it.each([
    ['an absent column', undefined],
    ['a null column', null],
    ['an empty string', ''],
    ['a value nobody has heard of', 'authorised'],
    ['a near miss', 'Approved'],
    ['a boolean', true],
  ])('reads %s as not_required', (_label, raw) => {
    expect(readAuthorizationStatus(raw)).toBe('not_required');
  });

  it('reads the three real values as themselves', () => {
    expect(readAuthorizationStatus('pending')).toBe('pending');
    expect(readAuthorizationStatus('approved')).toBe('approved');
    expect(readAuthorizationStatus('declined')).toBe('declined');
  });
});

/**
 * THE GATE. Everything above exists for this.
 *
 * The permissive reading of an unrecognised authorisation is only safe
 * because this refuses an inbound request on anything but an exact
 * 'approved', so the two are tested together rather than separately.
 */
describe('whether a signer link may open', () => {
  it('lets every outbound request through, whatever the authorisation says', () => {
    for (const authorizationStatus of [
      undefined,
      null,
      'not_required',
      'pending',
      'declined',
      'approved',
      'nonsense',
    ]) {
      for (const direction of [undefined, null, 'outbound', 'sideways', '']) {
        expect(resolveSignerGate({ direction, authorizationStatus }).ok).toBe(true);
      }
    }
  });

  /**
   * Mutation: return { ok: true } unconditionally, or accept 'not_required'
   * on an inbound request. Both go red here.
   */
  it.each([
    ['an absent column', undefined],
    ['a null column', null],
    ['not_required, which is what an unapplied migration looks like', 'not_required'],
    ['pending', 'pending'],
    ['declined', 'declined'],
    ['a value nobody has heard of', 'signed-off'],
  ])('refuses an inbound request on %s', (_label, authorizationStatus) => {
    const gate = resolveSignerGate({ direction: 'inbound', authorizationStatus });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.heading.length).toBeGreaterThan(0);
    expect(gate.reason.length).toBeGreaterThan(0);
  });

  it('opens an inbound request on an exact approval and on nothing else', () => {
    expect(resolveSignerGate({ direction: 'inbound', authorizationStatus: 'approved' }).ok).toBe(
      true,
    );
  });

  it('says something different when it was declined than when it is waiting', () => {
    const waiting = resolveSignerGate({ direction: 'inbound', authorizationStatus: 'pending' });
    const declined = resolveSignerGate({ direction: 'inbound', authorizationStatus: 'declined' });
    expect(waiting.ok).toBe(false);
    expect(declined.ok).toBe(false);
    if (waiting.ok || declined.ok) return;
    expect(waiting.heading).not.toBe(declined.heading);
    expect(waiting.reason).not.toBe(declined.reason);
  });
});

describe('what the legal team reads on the authorisation panel', () => {
  it('is the owner wording, with both names in it', () => {
    expect(INBOUND_AUTHORIZE_HEADING).toBe('Authorise this signature');
    const [first, second] = inboundAuthorizeBody({
      counterparty: 'Northwind Traders',
      signatoryName: 'Dana Whitfield',
    });
    expect(first).toBe(
      'Northwind Traders sent this and has asked us to sign it. It is their ' +
        'document and nothing in it has been changed, so the only thing added ' +
        'is the signature line.',
    );
    expect(second).toBe(
      'Approving lets Dana Whitfield sign it. If it should not be signed as ' +
        'it stands, send it back with a note saying what would need to change.',
    );
  });

  it('still reads as a sentence when neither name is known', () => {
    const [first, second] = inboundAuthorizeBody({ counterparty: '  ', signatoryName: null });
    expect(first.startsWith('The other party sent this')).toBe(true);
    expect(second.startsWith('Approving lets the named signatory sign it.')).toBe(true);
  });
});

/**
 * THE EMPLOYEE'S SIDE. The labels are the owner's, verbatim, and the tone is
 * the one components/portal/SubmissionStatusPill.tsx already sets: about the
 * document, never about the colleague.
 */
describe('what the colleague who filed it reads', () => {
  it('uses the four given labels', () => {
    expect(inboundEmployeeLabel('pending')).toBe('With legal to review');
    expect(inboundEmployeeLabel('approved')).toBe('Approved to sign');
    expect(inboundEmployeeLabel('signed')).toBe('Signed and returned');
    expect(inboundEmployeeLabel('declined')).toBe('Not being signed as written');
  });

  it('never calls a decision a rejection or a failure', () => {
    const words = /reject|refus|fail|denied|invalid|error/i;
    for (const state of ['pending', 'approved', 'signed', 'declined'] as const) {
      expect(inboundEmployeeLabel(state)).not.toMatch(words);
      expect(inboundEmployeeMessage(state, 'Northwind Traders')).not.toMatch(words);
    }
  });

  /**
   * A signed document is finished, so it must not read "Approved to sign" and
   * send the colleague looking for something to do.
   *
   * Mutation: drop the signedAt check. This goes red.
   */
  it('reads a signed document as signed even though it is also approved', () => {
    expect(
      inboundEmployeeState({ authorizationStatus: 'approved', signedAt: '2026-08-22T10:00:00Z' }),
    ).toBe('signed');
    expect(inboundEmployeeState({ authorizationStatus: 'approved', signedAt: null })).toBe(
      'approved',
    );
  });

  it('reads an unrecorded authorisation as still with legal', () => {
    for (const raw of [undefined, null, 'not_required', 'nonsense']) {
      expect(inboundEmployeeState({ authorizationStatus: raw, signedAt: null })).toBe('pending');
    }
  });

  it('is the owner wording for the three states he wrote', () => {
    expect(inboundEmployeeMessage('pending', 'Northwind Traders')).toBe(
      'Your legal team is reading the document Northwind Traders sent. ' +
        'Nothing has been signed, and there is nothing you need to do while ' +
        'it is with them.',
    );
    expect(inboundEmployeeMessage('signed', 'Northwind Traders')).toBe(
      'Your legal team has signed this. The signed copy is below, and the ' +
        'version Northwind Traders sent is kept beside it.',
    );
    expect(inboundEmployeeMessage('declined', 'Northwind Traders')).toBe(
      'Your legal team is not signing this as it is written. There is a note ' +
        'below on what would need to change first. Nothing has been sent back.',
    );
  });

  it('reassures that nothing went out, while it is still open', () => {
    for (const state of ['pending', 'approved'] as const) {
      expect(inboundEmployeeMessage(state, 'Northwind Traders')).toMatch(/Nothing has been/);
    }
  });
});

describe('a request that cannot be recorded as gated', () => {
  const unknownColumn = (
    error: { code?: string | null; message?: string | null } | null | undefined,
    column: string,
  ) =>
    (error?.code === 'PGRST204' || error?.code === '42703') &&
    (error?.message ?? '').includes(column);

  /**
   * Mutation: return 'retry-without-columns' for inbound. This goes red, and
   * it is the mutation that matters: retrying would mint a live signer link
   * on a counterparty's document with no gate on it at all.
   */
  it.each([DIRECTION_COLUMN, AUTHORIZATION_STATUS_COLUMN])(
    'aborts an inbound request when %s is missing',
    (column) => {
      expect(
        resolveSigningDirectionColumnFallback({
          direction: 'inbound',
          error: { code: 'PGRST204', message: `Could not find the '${column}' column` },
          isUnknownColumn: unknownColumn,
        }),
      ).toBe('abort-authorization-unsaved');
    },
  );

  it('retries an outbound request, which loses nothing', () => {
    expect(
      resolveSigningDirectionColumnFallback({
        direction: 'outbound',
        error: {
          code: 'PGRST204',
          message: `Could not find the '${DIRECTION_COLUMN}' column`,
        },
        isUnknownColumn: unknownColumn,
      }),
    ).toBe('retry-without-columns');
  });

  it('leaves every other failure to the caller, in both directions', () => {
    for (const direction of ['inbound', 'outbound'] as const) {
      for (const error of [
        null,
        undefined,
        { code: '23503', message: 'insert or update violates foreign key constraint' },
        { code: 'PGRST204', message: "Could not find the 'signature_methods' column" },
        { code: '42501', message: 'permission denied' },
      ]) {
        expect(
          resolveSigningDirectionColumnFallback({ direction, error, isUnknownColumn: unknownColumn }),
        ).toBe('surface-error');
      }
    }
  });

  it('says what did not happen and what to do about it', () => {
    expect(INBOUND_AUTHORIZATION_UNSAVED_ERROR).toContain('was not sent for signature');
    expect(INBOUND_AUTHORIZATION_UNSAVED_ERROR).toContain('administrator');
  });
});

/**
 * THE ROLE LIST, WHICH THERE MUST GO ON BEING ONLY ONE OF.
 *
 * The brief was explicit: the authorisation gate reuses canApproveSubmissions
 * from lib/template-approval.ts and does not write a second list of roles
 * that may let a document bind the firm.
 *
 * Comments are stripped before matching, because this repo has twice had a
 * guard satisfied by the comment that explained the fix. This one would
 * otherwise pass on the module's own doc comment, which names every role in
 * FIRM_MANAGE_ROLES while explaining why it does not have them.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('there is one list of roles that may bind the firm', () => {
  /**
   * Mutation: add `const AUTHORIZERS = ['owner', 'admin', 'attorney']` to
   * lib/signing-authorization.ts, or take a `role` parameter and compare it.
   * This goes red.
   */
  it('is not written a second time in the authorisation module', () => {
    const src = stripComments(read('lib/signing-authorization.ts'));
    for (const role of ['owner', 'admin', 'attorney', 'paralegal', 'staff']) {
      expect(src, `${role} is named in the authorisation module`).not.toContain(`'${role}'`);
    }
    expect(src).not.toContain('FIRM_MANAGE_ROLES');
    expect(src).not.toContain('firm-authz');
  });

  /**
   * Mutation: change the counsel authorisation action to test roles itself.
   * This goes red, because it asserts the CALL rather than the name: an
   * import line alone would satisfy a name check, which is how a guard in
   * this repo passed over code that had stopped calling anything.
   */
  it('is the one the counsel authorisation action calls', () => {
    const src = stripComments(read('lib/signing-authorization-actions.ts'));
    expect(src).toMatch(/canApproveSubmissions\(\s*role/);
    expect(src).not.toContain('FIRM_MANAGE_ROLES');
    for (const role of ['owner', 'admin', 'attorney', 'paralegal']) {
      expect(src, `${role} is compared by hand in the action`).not.toContain(`'${role}'`);
    }
  });
});
