import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The outside signer's laptop, asking whether the code it put on screen is in
 * somebody's hand.
 *
 * The same defect as the employee's desk and the same fix: the card had no
 * state between "a code is up" and "the signature is finished", so a signer who
 * scanned and started drawing on their phone left a live-looking QR on the
 * laptop behind them. This surface knows about the scan already, on
 * firm_signature_handoffs.consumed_at, and simply was not asked.
 *
 * It stays one question the laptop is entitled to ask about its own ceremony:
 * the caller proves nothing except the durable signing token it already holds,
 * and the handoff is found under the signature that token resolves to, never
 * under anything the caller supplied.
 */

type Row = Record<string, unknown>;

let signature: Row | null = null;
let handoffs: Row[] = [];

/**
 * The rows are matched by the filters the module actually builds, so a
 * statement that forgot one finds a row it should not have. The fixture rows
 * carry every column those filters name, including firm_signatures.token: an
 * earlier draft left it out, which made the lookup miss and three of these
 * tests pass on the resulting empty answer rather than on the behaviour.
 */
function fakeTable(table: string) {
  const rows = () =>
    table === 'firm_signatures' ? (signature ? [signature] : []) : handoffs;
  const tests: ((r: Row) => boolean)[] = [];
  const q = {
    eq(c: string, v: unknown) {
      tests.push((r) => r[c] === v);
      return q;
    },
    not(c: string, _op: string, _v: unknown) {
      tests.push((r) => (r[c] ?? null) !== null);
      return q;
    },
    gt(c: string, v: unknown) {
      tests.push((r) => String(r[c]) > String(v));
      return q;
    },
    limit() {
      return q;
    },
    async maybeSingle() {
      const hit = rows().find((r) => tests.every((t) => t(r))) ?? null;
      return { data: hit, error: null };
    },
  };
  return q;
}

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({ select: () => fakeTable(table) }),
  }),
}));
vi.mock('../lib/signing-handoff-queries', () => ({ createHandoff: async () => ({ ok: false }) }));
vi.mock('../lib/qr-svg', () => ({ qrSvg: () => '<svg />' }));

const { signingCompletedAction } = await import('../app/sign/[token]/handoff-actions');

const HOUR_AWAY = new Date(Date.now() + 3_600_000).toISOString();
const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  signature = { id: 'sig-1', token: 'tok', signed_at: null };
  handoffs = [];
});

describe('what the signing laptop is told while its code is up', () => {
  it('reports a code a phone has claimed and not yet finished', () => {
    handoffs = [{ signature_id: 'sig-1', consumed_at: HOUR_AGO, expires_at: HOUR_AWAY }];
    return expect(signingCompletedAction('tok')).resolves.toEqual({
      signed: false,
      scanned: true,
    });
  });

  it('does not call a minted-but-unscanned code scanned', async () => {
    // The QR is on screen and nobody has picked up a phone. Taking it down
    // here would be worse than leaving it up.
    handoffs = [{ signature_id: 'sig-1', consumed_at: null, expires_at: HOUR_AWAY }];
    expect(await signingCompletedAction('tok')).toEqual({
      signed: false,
      scanned: false,
    });
  });

  it('does not treat a dead code as a phone in progress', async () => {
    handoffs = [{ signature_id: 'sig-1', consumed_at: HOUR_AGO, expires_at: HOUR_AGO }];
    expect(await signingCompletedAction('tok')).toEqual({
      signed: false,
      scanned: false,
    });
  });

  it('ignores a scan on somebody else s signature', async () => {
    handoffs = [
      { signature_id: 'another-sig', consumed_at: HOUR_AGO, expires_at: HOUR_AWAY },
    ];
    expect(await signingCompletedAction('tok')).toEqual({
      signed: false,
      scanned: false,
    });
  });

  it('still answers the question it always answered', async () => {
    signature = { id: 'sig-1', token: 'tok', signed_at: '2026-08-16T02:26:54.000Z' };
    expect(await signingCompletedAction('tok')).toEqual({ signed: true, scanned: true });
  });

  it('says nothing about a token that resolves to no signature', async () => {
    signature = null;
    expect(await signingCompletedAction('tok')).toEqual({
      signed: false,
      scanned: false,
    });
  });

  it('refuses an empty token without touching the database', async () => {
    expect(await signingCompletedAction('   ')).toEqual({
      signed: false,
      scanned: false,
    });
  });
});
