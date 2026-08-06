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

export type HandoffRow = {
  tokenHash: string;
  sessionHash: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  /** firm_signatures.signed_at for the row this handoff points at. */
  signatureSignedAt: Date | null;
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
 * The single decision function. `presentedSessionHash` is the hash of
 * the httpOnly cookie the phone sent, or null if it sent none.
 *
 * Order matters. already-signed is reported before expiry so the signer
 * is told the true reason rather than a misleading one, and consumed is
 * reported before the session window so a stranger scanning a screen
 * cannot tell a live code from a dead one by the wording.
 */
export function handoffState(
  row: HandoffRow,
  now: Date,
  presentedSessionHash: string | null,
): HandoffState {
  if (row.signatureSignedAt) return 'already-signed';

  if (!row.consumedAt) {
    return now >= row.expiresAt ? 'expired' : 'claimable';
  }

  // Truthiness, not a null check: a real hash is never empty, so an empty
  // pair must not count as a match. This fails closed.
  const isBoundDevice =
    !!row.sessionHash &&
    !!presentedSessionHash &&
    presentedSessionHash === row.sessionHash;

  if (!isBoundDevice) return 'consumed';

  const sessionDeadline = new Date(
    row.consumedAt.getTime() + HANDOFF_SESSION_MINUTES * 60_000,
  );
  // Both windows bind. The absolute one is not reset by scanning.
  if (now >= sessionDeadline || now >= row.expiresAt) return 'expired';

  return 'bound';
}
