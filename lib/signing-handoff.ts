import { createHash, randomBytes } from 'node:crypto';

/**
 * Pure rules for a QR signing handoff. No I/O, so every rule below is
 * unit tested. lib/signing-handoff-queries.ts owns the database.
 *
 * The token in the QR is NOT the durable /sign/[token] credential.
 * firm_signatures.access_code_hash is only set for external signers, so
 * for an internal signer the durable URL alone is enough to sign. A QR
 * encoding it would let anyone who photographs the screen sign as that
 * person.
 */

/** How long an unscanned QR stays claimable. */
export const HANDOFF_TTL_MINUTES = 15;

/** How long the phone has to finish, measured from the scan. */
export const HANDOFF_SESSION_MINUTES = 10;

/**
 * Supabase returns timestamptz as an ISO string, and a type annotation is
 * erased at runtime, so a row handed straight from a select would carry
 * strings whatever this file declares. Both forms are accepted and
 * normalised below rather than left to the caller to remember.
 */
export type HandoffTimestamp = Date | string;

export type HandoffRow = {
  tokenHash: string;
  sessionHash: string | null;
  createdAt: HandoffTimestamp;
  expiresAt: HandoffTimestamp;
  consumedAt: HandoffTimestamp | null;
  /** firm_signatures.signed_at for the row this handoff points at. */
  signatureSignedAt: HandoffTimestamp | null;
};

export type HandoffState =
  | 'claimable'
  | 'bound'
  | 'consumed'
  | 'expired'
  | 'already-signed';

/** A url-safe random token. Never stored; only its hash is. */
export function mintHandoffToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashHandoffToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Normalise a timestamp to a Date, refusing anything unparseable.
 *
 * Throwing is the point. An Invalid Date compares false against every
 * other date, so `now >= expiresAt` would be false forever and an
 * expired code would read as claimable. A comparison that silently
 * cannot fail is worse than a crash.
 */
function toInstant(value: HandoffTimestamp, field: string): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`signing-handoff: ${field} is not a valid timestamp`);
  }
  return instant;
}

/**
 * The single decision function. `presentedSessionHash` is the hash of
 * the httpOnly cookie the phone sent, or null if it sent none. Prefer
 * handoffStateForCookie, which hashes the cookie for you.
 *
 * Order matters. already-signed is reported before expiry so the signer
 * is told the true reason rather than a misleading one, and consumed is
 * reported before the session window so a stranger scanning a screen
 * cannot tell a live code from a dead one by the wording.
 */
export function handoffStateWithSessionHash(
  row: HandoffRow,
  now: HandoffTimestamp,
  presentedSessionHash: string | null,
): HandoffState {
  if (row.signatureSignedAt) return 'already-signed';

  const at = toInstant(now, 'now');
  const expiresAt = toInstant(row.expiresAt, 'expiresAt');

  if (!row.consumedAt) {
    return at >= expiresAt ? 'expired' : 'claimable';
  }

  // Truthiness, not a null check: a real hash is never empty, so an empty
  // pair must not count as a match. This fails closed.
  //
  // `===` is right here, not timingSafeEqual. Both sides are SHA-256 hex
  // digests of a 256-bit secret, so a timing signal leaks nothing an
  // attacker could walk, and timingSafeEqual throws on unequal lengths,
  // which would turn an ordinary mismatch into a crash.
  const isBoundDevice =
    !!row.sessionHash &&
    !!presentedSessionHash &&
    presentedSessionHash === row.sessionHash;

  if (!isBoundDevice) return 'consumed';

  const sessionDeadline = new Date(
    toInstant(row.consumedAt, 'consumedAt').getTime() +
      HANDOFF_SESSION_MINUTES * 60_000,
  );
  // Both windows bind. The absolute one is not reset by scanning.
  if (at >= sessionDeadline || at >= expiresAt) return 'expired';

  return 'bound';
}

/**
 * The form routes should call. It takes the raw httpOnly cookie and
 * hashes it here, so no caller can compare a value it hashed itself or
 * forgot to hash. Pass null when the phone sent no cookie.
 */
export function handoffStateForCookie(
  row: HandoffRow,
  now: HandoffTimestamp,
  rawCookie: string | null,
): HandoffState {
  return handoffStateWithSessionHash(
    row,
    now,
    rawCookie ? hashHandoffToken(rawCookie) : null,
  );
}
