import { describe, expect, it } from 'vitest';
import {
  SIGNER_NOT_YET_YOUR_TURN,
  nextInviteIndex,
  resolveSignerTurn,
  type SignerOrderRecord,
} from '../lib/signer-order';

/**
 * Sequential signing, as a rule over plain values.
 *
 * The whole reason this is a module and not four inline conditions is
 * that the same answer is needed by the email loop, by the write, by the
 * signer's page and by the employee's portal record, and none of those
 * four can be exercised in a node environment. So the decision is here
 * and they are the wiring.
 *
 * The first test is the one that matters most: with no order recorded,
 * everybody is ready. That is today's behaviour, it is what an
 * unmigrated database returns for every row, and a regression in it
 * would silently stop signers being invited on requests that have
 * nothing to do with this feature.
 */

const unsigned = (order: number | null): SignerOrderRecord => ({
  order,
  signedAt: null,
});
const signed = (order: number | null): SignerOrderRecord => ({
  order,
  signedAt: '2026-08-07T10:00:00.000Z',
});

describe('a request with no ordering, which is every request today', () => {
  it('reports every unsigned signer ready', () => {
    // 20260807_flow_join.sql is unapplied, so PostgREST returns rows
    // with no signer_order at all and the caller reads null. If this
    // ever answered anything but 'ready', an unmigrated firm would stop
    // being able to send a two-signer request.
    const signers = [unsigned(null), unsigned(null), unsigned(null)];
    expect(resolveSignerTurn(signers, 0)).toBe('ready');
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
    expect(resolveSignerTurn(signers, 2)).toBe('ready');
  });

  it('reports a signer who has signed as done, whoever else has not', () => {
    const signers = [signed(null), unsigned(null)];
    expect(resolveSignerTurn(signers, 0)).toBe('done');
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
  });
});

describe('ordered signers', () => {
  it('holds a numbered signer until every lower number has signed', () => {
    const signers = [unsigned(1), unsigned(2)];
    expect(resolveSignerTurn(signers, 0)).toBe('ready');
    expect(resolveSignerTurn(signers, 1)).toBe('waiting');
  });

  it('releases the next signer once the one ahead has signed', () => {
    const signers = [signed(1), unsigned(2)];
    expect(resolveSignerTurn(signers, 0)).toBe('done');
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
  });

  it('reports a signer who already signed as done even out of turn', () => {
    // A row can carry signed_at from before the order was recorded, or
    // from a request whose signers were reordered afterwards. 'done' is
    // a fact about that row and is not conditional on anybody else.
    const signers = [unsigned(1), signed(2)];
    expect(resolveSignerTurn(signers, 1)).toBe('done');
  });

  it('does not deadlock on a gap in the numbering', () => {
    // Orders 1 and 3 with no 2. The rule is "every lower order has
    // signed", not "the previous number has signed", so a deleted or
    // never-created middle signer cannot strand the last one.
    const signers = [signed(1), unsigned(3)];
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
  });

  it('leaves duplicate orders ready together, because neither is lower', () => {
    const signers = [unsigned(1), unsigned(1)];
    expect(resolveSignerTurn(signers, 0)).toBe('ready');
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
  });

  it('treats an index that names nobody as waiting, not ready', () => {
    // A gate that opens on a bad argument is not a gate.
    expect(resolveSignerTurn([unsigned(1)], 7)).toBe('waiting');
    expect(resolveSignerTurn([], 0)).toBe('waiting');
    expect(resolveSignerTurn([unsigned(1)], -1)).toBe('waiting');
  });
});

describe('mixing null and numbered orders', () => {
  it('resolves the unnumbered signers first', () => {
    // A null order sorts before every number. The alternative, treating
    // null as "no constraint in either direction", would let a numbered
    // signer act while an unnumbered one was still out, which is the
    // exact thing an order is for.
    const signers = [unsigned(null), unsigned(2)];
    expect(resolveSignerTurn(signers, 0)).toBe('ready');
    expect(resolveSignerTurn(signers, 1)).toBe('waiting');
  });

  it('releases the numbered signer once the unnumbered one is in', () => {
    const signers = [signed(null), unsigned(2)];
    expect(resolveSignerTurn(signers, 1)).toBe('ready');
  });
});

describe('nextInviteIndex', () => {
  it('is the first unsigned signer whose turn has come', () => {
    expect(nextInviteIndex([signed(1), unsigned(2), unsigned(3)])).toBe(1);
  });

  it('is null when nobody may sign yet', () => {
    // Every remaining signer is behind somebody who has not signed. The
    // caller must send nothing rather than fall back to the first row.
    expect(nextInviteIndex([unsigned(1), unsigned(2)])).toBe(0);
    expect(nextInviteIndex([signed(1), signed(2)])).toBe(null);
    expect(nextInviteIndex([])).toBe(null);
  });

  it('names somebody the caller can then check WAS waiting before', () => {
    // This is the composition lib/signature-write.ts relies on to avoid
    // emailing a signer who was already reachable. Signer 1 lands; the
    // next invite is signer 2; and asking the same question of the list
    // as it stood before that signature says signer 2 was waiting, so
    // the invitation is genuinely new.
    const before = [unsigned(1), unsigned(2)];
    const after = [signed(1), unsigned(2)];
    const next = nextInviteIndex(after);
    expect(next).toBe(1);
    expect(resolveSignerTurn(before, next as number)).toBe('waiting');
  });

  it('lets the caller recognise a signer who was already reachable', () => {
    // Two unordered signers. One signs. The other is ready now and was
    // ready before, so they were emailed when the request was created
    // and must not be emailed again.
    const before = [unsigned(null), unsigned(null)];
    const after = [signed(null), unsigned(null)];
    const next = nextInviteIndex(after);
    expect(next).toBe(1);
    expect(resolveSignerTurn(before, next as number)).toBe('ready');
  });
});

describe('what an out-of-turn signer is told', () => {
  it('does not claim the link is broken, dead or expired', () => {
    // The same discipline as SIGNER_ALREADY_SIGNED_SENTENCE: the link
    // keeps resolving, so nothing may say otherwise.
    const s = SIGNER_NOT_YET_YOUR_TURN.toLowerCase();
    for (const word of ['expired', 'dead', 'deleted', 'invalid', 'broken', 'destroyed']) {
      expect(s).not.toContain(word);
    }
  });

  it('names nobody, because anyone holding the link can read it', () => {
    // Who else is on an agreement is not something this surface should
    // volunteer to a caller who has not proved they are the signer.
    expect(SIGNER_NOT_YET_YOUR_TURN).not.toMatch(/@/);
    expect(SIGNER_NOT_YET_YOUR_TURN).toContain('another signature');
  });

  it('says what happens next', () => {
    expect(SIGNER_NOT_YET_YOUR_TURN).toContain('email you');
  });

  it('carries no em dash and no emoji', () => {
    expect(SIGNER_NOT_YET_YOUR_TURN).not.toMatch(/[\u2013\u2014]/);
    expect(SIGNER_NOT_YET_YOUR_TURN).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
  });
});
