import { describe, it, expect } from 'vitest';
import {
  mintHandoffToken,
  hashHandoffToken,
  handoffState,
  type HandoffRow,
} from '../lib/signing-handoff';

const T0 = new Date('2026-08-01T12:00:00Z');
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

function row(over: Partial<HandoffRow> = {}): HandoffRow {
  return {
    tokenHash: hashHandoffToken('raw-token'),
    sessionHash: null,
    createdAt: T0,
    expiresAt: at(15),
    consumedAt: null,
    signatureSignedAt: null,
    ...over,
  };
}

describe('mintHandoffToken', () => {
  it('produces a long, url-safe, non-repeating token', () => {
    const a = mintHandoffToken();
    const b = mintHandoffToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashHandoffToken', () => {
  it('is stable and does not return the raw value', () => {
    expect(hashHandoffToken('abc')).toBe(hashHandoffToken('abc'));
    expect(hashHandoffToken('abc')).not.toBe('abc');
    expect(hashHandoffToken('abc')).not.toBe(hashHandoffToken('abd'));
  });
});

describe('handoffState', () => {
  it('is claimable before it is scanned or expired', () => {
    expect(handoffState(row(), at(1), null)).toBe('claimable');
  });

  it('is expired once past expiresAt, even unscanned', () => {
    expect(handoffState(row(), at(16), null)).toBe('expired');
  });

  it('is bound for the same device after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(2), 'sess-hash')).toBe('bound');
  });

  it('refuses a different device presenting a consumed token', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(2), 'other-hash')).toBe('consumed');
    expect(handoffState(r, at(2), null)).toBe('consumed');
  });

  it('still says consumed, not expired, once a stranger is past the session window', () => {
    // The wording must not let a stranger who photographed the screen tell a
    // live code from a dead one, so consumed is reported ahead of the window.
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(11.5), 'other-hash')).toBe('consumed');
    expect(handoffState(r, at(11.5), null)).toBe('consumed');
  });

  it('refuses to bind when the stored session hash is empty', () => {
    // A real hash is never empty, so an empty pair must not count as a match.
    const r = row({ consumedAt: at(1), sessionHash: '' });
    expect(handoffState(r, at(2), '')).toBe('consumed');
  });

  it('expires the phone session ten minutes after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(11.5), 'sess-hash')).toBe('expired');
  });

  it('honours the absolute window even for a bound device', () => {
    const r = row({ consumedAt: at(14), sessionHash: 'sess-hash' });
    expect(handoffState(r, at(16), 'sess-hash')).toBe('expired');
  });

  it('refuses once the signature is already signed', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffState(r, at(3), null)).toBe('already-signed');
  });

  it('reports already-signed ahead of expiry, so the message is accurate', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffState(r, at(99), null)).toBe('already-signed');
  });
});
