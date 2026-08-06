import { describe, it, expect } from 'vitest';
import {
  mintHandoffToken,
  hashHandoffToken,
  handoffStateWithSessionHash,
  handoffStateForCookie,
  handoffRefusalMessage,
  HANDOFF_REFUSAL_UNAVAILABLE,
  HANDOFF_REFUSAL_ALREADY_SIGNED,
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

describe('handoffStateWithSessionHash', () => {
  it('is claimable before it is scanned or expired', () => {
    expect(handoffStateWithSessionHash(row(), at(1), null)).toBe('claimable');
  });

  it('is expired once past expiresAt, even unscanned', () => {
    expect(handoffStateWithSessionHash(row(), at(16), null)).toBe('expired');
  });

  it('is bound for the same device after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(2), 'sess-hash')).toBe('bound');
  });

  it('refuses a different device presenting a consumed token', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(2), 'other-hash')).toBe('consumed');
    expect(handoffStateWithSessionHash(r, at(2), null)).toBe('consumed');
  });

  it('still says consumed, not expired, once a stranger is past the session window', () => {
    // The wording must not let a stranger who photographed the screen tell a
    // live code from a dead one, so consumed is reported ahead of the window.
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(11.5), 'other-hash')).toBe('consumed');
    expect(handoffStateWithSessionHash(r, at(11.5), null)).toBe('consumed');
  });

  it('refuses to bind when the stored session hash is empty', () => {
    // A real hash is never empty, so an empty pair must not count as a match.
    const r = row({ consumedAt: at(1), sessionHash: '' });
    expect(handoffStateWithSessionHash(r, at(2), '')).toBe('consumed');
  });

  it('expires the phone session ten minutes after consumption', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(11.5), 'sess-hash')).toBe('expired');
  });

  it('honours the absolute window even for a bound device', () => {
    const r = row({ consumedAt: at(14), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(16), 'sess-hash')).toBe('expired');
  });

  it('expires exactly at expiresAt, not a moment later', () => {
    expect(handoffStateWithSessionHash(row(), at(15), null)).toBe('expired');
  });

  it('expires exactly at the session deadline, not a moment later', () => {
    const r = row({ consumedAt: at(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(11), 'sess-hash')).toBe('expired');
  });

  it('expires a bound device exactly at expiresAt, not a moment later', () => {
    // Session deadline is at 24, so only the absolute clause can decide this.
    const r = row({ consumedAt: at(14), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(15), 'sess-hash')).toBe('expired');
  });

  it('refuses once the signature is already signed', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffStateWithSessionHash(r, at(3), null)).toBe('already-signed');
  });

  it('reports already-signed ahead of expiry, so the message is accurate', () => {
    const r = row({ signatureSignedAt: at(2) });
    expect(handoffStateWithSessionHash(r, at(99), null)).toBe('already-signed');
  });
});

describe('handoffStateWithSessionHash with ISO string timestamps', () => {
  // Supabase returns timestamptz as ISO strings, and types are erased at
  // runtime. A raw row must not quietly disable the windows.
  const iso = (mins: number) => at(mins).toISOString();

  it('enforces the absolute window when expiresAt is a string', () => {
    const r = row({ expiresAt: iso(15) });
    expect(handoffStateWithSessionHash(r, at(16), null)).toBe('expired');
  });

  it('still reports claimable inside the window when expiresAt is a string', () => {
    const r = row({ expiresAt: iso(15) });
    expect(handoffStateWithSessionHash(r, at(1), null)).toBe('claimable');
  });

  it('binds a device when consumedAt is a string', () => {
    const r = row({ consumedAt: iso(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(2), 'sess-hash')).toBe('bound');
  });

  it('enforces the session window when consumedAt is a string', () => {
    const r = row({ consumedAt: iso(1), sessionHash: 'sess-hash' });
    expect(handoffStateWithSessionHash(r, at(11.5), 'sess-hash')).toBe('expired');
  });

  it('accepts a string for now as well', () => {
    expect(handoffStateWithSessionHash(row(), iso(16), null)).toBe('expired');
  });

  it('throws rather than failing open on an unparseable timestamp', () => {
    // An Invalid Date compares false against everything, which would read as
    // claimable forever. Refuse loudly instead.
    expect(() => handoffStateWithSessionHash(row({ expiresAt: 'not-a-date' }), at(16), null)).toThrow(
      /expiresAt/,
    );
    const consumed = row({ consumedAt: 'not-a-date', sessionHash: 'sess-hash' });
    expect(() => handoffStateWithSessionHash(consumed, at(2), 'sess-hash')).toThrow(/consumedAt/);
    expect(() => handoffStateWithSessionHash(row(), 'not-a-date', null)).toThrow(/now/);
  });
});

describe('handoffStateForCookie', () => {
  const raw = 'raw-cookie-value';
  const bound = () =>
    row({ consumedAt: at(1), sessionHash: hashHandoffToken(raw) });

  it('hashes the raw cookie itself, so no route has to remember to', () => {
    expect(handoffStateForCookie(bound(), at(2), raw)).toBe('bound');
  });

  it('does not accept a value the caller already hashed', () => {
    expect(handoffStateForCookie(bound(), at(2), hashHandoffToken(raw))).toBe(
      'consumed',
    );
  });

  it('treats a missing cookie as a stranger', () => {
    expect(handoffStateForCookie(bound(), at(2), null)).toBe('consumed');
  });
});

describe('handoffRefusalMessage', () => {
  // The whole point of this mapping is that it leaks nothing. If a
  // future change gives 'expired' or a cookie mismatch its own wording,
  // this test is what should stop it.
  it('says the same thing for consumed, expired and a wrong device', () => {
    const consumed = handoffRefusalMessage('consumed');
    expect(handoffRefusalMessage('expired')).toBe(consumed);
    expect(consumed).toBe(HANDOFF_REFUSAL_UNAVAILABLE);
  });

  it('is the wording the spec fixed, word for word', () => {
    expect(HANDOFF_REFUSAL_UNAVAILABLE).toBe(
      'This code is no longer valid. On your computer, choose Sign with mobile again.',
    );
    expect(HANDOFF_REFUSAL_ALREADY_SIGNED).toBe(
      'This document has already been signed.',
    );
  });

  it('names an already-signed document, which gives nothing away', () => {
    expect(handoffRefusalMessage('already-signed')).toBe(
      HANDOFF_REFUSAL_ALREADY_SIGNED,
    );
  });

  it('refuses rather than falls through for states that mean access', () => {
    // Reaching here with either of these is a caller bug. A credential
    // path answers a bug with a refusal, not with a message that
    // implies the phone may draw.
    expect(handoffRefusalMessage('claimable')).toBe(HANDOFF_REFUSAL_UNAVAILABLE);
    expect(handoffRefusalMessage('bound')).toBe(HANDOFF_REFUSAL_UNAVAILABLE);
  });
});
