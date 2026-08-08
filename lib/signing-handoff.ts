import { createHash, randomBytes } from 'node:crypto';
import type { DesktopDisclosureConsent } from './signing-handoff-consent';

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
 * What the phone is told when it may not draw.
 *
 * Only two messages exist, and that is the point. 'consumed', 'expired'
 * and a cookie mismatch all read identically, so a stranger who
 * photographs a screen and scans it learns nothing about whether the
 * code was ever real, whether it has already been used, or whether
 * somebody else is mid-ceremony. The ordering comment on
 * handoffStateWithSessionHash above is the other half of this: the
 * states are ordered so the wording never leaks the difference either.
 *
 * Do not "fix" this by giving each state its own sentence.
 */
export const HANDOFF_REFUSAL_UNAVAILABLE =
  'This code is no longer valid. On your computer, choose Sign with mobile again.';

export const HANDOFF_REFUSAL_ALREADY_SIGNED =
  'This document has already been signed.';

/**
 * Total over HandoffState on purpose, including 'claimable' and 'bound'.
 *
 * Neither should ever reach here, because both mean the phone may draw.
 * If one does, it is a caller bug, and the right behaviour for a bug in
 * a credential path is to refuse rather than to fall through to a
 * message that implies access. Everything that is not the one state we
 * are willing to explain gets the generic refusal.
 */
export function handoffRefusalMessage(state: HandoffState): string {
  return state === 'already-signed'
    ? HANDOFF_REFUSAL_ALREADY_SIGNED
    : HANDOFF_REFUSAL_UNAVAILABLE;
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

// ---------------------------------------------------------------------
// The URL that goes in the code
// ---------------------------------------------------------------------

/**
 * Build the address the QR encodes.
 *
 * Absolute, and it throws rather than guessing when it cannot be. A
 * phone camera decodes the text and hands it to a browser with no base
 * to resolve against, so a relative path is not a degraded QR, it is a
 * search query for the string "/sign/m/...". A misconfigured origin
 * should surface as a refusal on the laptop, where the pad is still
 * right there, not as a code that scans into nothing.
 *
 * The token here is the handoff token and only ever the handoff token.
 * firm_signatures.token must not reach this path: for an internal
 * signer it has no access code in front of it, so encoding it would let
 * anyone who photographs the screen sign as that person.
 */
export function handoffQrUrl(origin: string, rawHandoffToken: string): string {
  const token = rawHandoffToken.trim();
  if (!token) {
    throw new Error('signing-handoff: a QR needs a handoff token');
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('signing-handoff: the site origin must be an absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('signing-handoff: the site origin must be http or https');
  }

  // Appended to the configured base rather than resolved against its
  // origin, so a deployment served under a path keeps it. Same shape as
  // every other outbound link the codebase builds from this setting.
  const base = origin.trim().replace(/\/+$/, '');
  return `${base}/sign/m/${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------
// Carrying the laptop's disclosure consent across to the phone
// ---------------------------------------------------------------------

/**
 * The consent shape and its parser live in lib/signing-handoff-consent.ts
 * and are re-exported here, so server callers import them from where
 * they always did. They were moved because this file imports node:crypto
 * and therefore cannot be pulled into a browser bundle, and the laptop's
 * own card has to run that same parser to know whether it is yet holding
 * enough consent to ask for a code.
 */
export {
  desktopConsentForHandoff,
  handoffCodeAvailable,
  type DesktopDisclosureConsent,
  type DesktopDisclosureConsentInput,
} from './signing-handoff-consent';

/** What the device making the mark can attest to for itself. */
export type SigningDeviceAttestation = {
  intentAffirmedAt?: string | null;
  uaSnapshot?: string | null;
  tzOffsetMinutes?: number | null;
};

/**
 * The consent block a mobile-signed row is written with.
 *
 * Two sources, kept apart on purpose. The disclosure fields come from
 * the handoff, which is to say from the laptop, at a time recorded on
 * the handoff row itself. The intent, user agent and timezone come from
 * the phone, which is where the signature was drawn. Neither side can
 * supply the other's fields: the phone cannot claim a disclosure it
 * never showed, and a carried blob cannot claim an intent nobody
 * affirmed here.
 *
 * When nothing was carried the disclosure fields stay empty rather than
 * being filled in with defaults that would read as evidence.
 */
export function mergeHandoffConsent(
  carried: DesktopDisclosureConsent | null,
  device: SigningDeviceAttestation,
) {
  return {
    electronicRecordsConsentedAt: carried?.electronicRecordsConsentedAt ?? null,
    hardwareSoftwareConfirmedAt: carried?.hardwareSoftwareConfirmedAt ?? null,
    documentPresented: carried?.documentPresented === true,
    documentReviewedAt: carried?.documentReviewedAt ?? null,
    intentAffirmedAt: device.intentAffirmedAt ?? null,
    uaSnapshot: device.uaSnapshot ?? null,
    tzOffsetMinutes:
      typeof device.tzOffsetMinutes === 'number' &&
      Number.isFinite(device.tzOffsetMinutes)
        ? device.tzOffsetMinutes
        : null,
  };
}
