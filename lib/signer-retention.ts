/**
 * How long the signer's copy stays reachable, and the sentence that
 * says so.
 *
 * This module exists because of a request that could not be granted as
 * stated. The firm asked that the emailed signing link be killed the
 * moment it is used, so nobody can ever open it again. The obstacle is
 * not technical. E-SIGN at 15 USC 7001(a)(1) makes the validity of an
 * electronic record turn on the person bound by it being able to RETAIN
 * it, and 7001(d) carries the same requirement into the retention of
 * contracts. On this product that link is the signer's retention path:
 * it is the only address at which they can reach the document they put
 * their name to. Killing it outright would take away the thing the
 * statute says they get to keep, in the course of a ceremony built to
 * satisfy that statute.
 *
 * So the honest behaviour is a different sentence, not a different
 * mechanism:
 *
 *   - the request cannot be signed a second time, on any path, which is
 *     enforced in lib/signature-write.ts and is the part the firm
 *     actually cares about;
 *   - the copy stays reachable for a stated period rather than forever
 *     or for no time at all, which is this module;
 *   - and nothing anywhere claims the URL stops existing, because it
 *     does not.
 *
 * The wording lives beside the decision, the way SIGNER_COPY_REFUSAL_COPY
 * does in lib/signer-view.ts, so the terminal screen and the route that
 * serves the bytes cannot describe the same window differently.
 *
 * Pure on purpose. vitest runs in environment: 'node' with no jsdom, so
 * anything worth testing has to be extractable as a function over plain
 * values, and the boundary of a retention window is exactly the sort of
 * arithmetic that is only ever wrong in front of the one signer it
 * locks out.
 */

/**
 * The window, in whole days, measured from the moment the request was
 * fully executed.
 *
 * Ninety days, and the number is a judgement rather than a derivation,
 * so here is the judgement. It has to be long enough that a signer who
 * files the email and comes back to it still has their record, and
 * short enough that a live credential is not sitting in an inbox
 * indefinitely, which is the firm's real concern behind "kill the
 * link". The one other window in this repo, the read-only encrypted
 * share at lib/template-release.ts, is 14 days, and this is
 * deliberately much longer: that share is a convenience, and this is a
 * signer's access to an instrument that binds them.
 *
 * A firm that needs a different figure changes it here, and the
 * sentence below follows automatically, because the sentence
 * interpolates this constant rather than repeating the number.
 */
export const SIGNER_COPY_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SignerCopyRetention = 'available' | 'expired';

/**
 * Whether the signer's copy is still inside its retention window.
 *
 * The anchor is the request's `completed_at`, not this signer's own
 * `signed_at`, and the difference matters. In a two-party signing the
 * first signer waits for the counter-signature, and starting their
 * clock at their own signature would run part of their window down
 * before the executed copy they are entitled to even exists.
 *
 * A missing or unparseable anchor is 'available'. That is the one place
 * on this surface that fails OPEN, and it is deliberate: every other
 * gate here withholds a document when it cannot answer, but refusing a
 * signer the record they signed is the single failure E-SIGN does not
 * tolerate, and a null completed_at means the clock has not started
 * rather than that it has run out.
 */
export function resolveSignerCopyRetention(input: {
  /** firm_signing_requests.completed_at */
  completedAt: string | Date | null | undefined;
  /** Defaults to now. Never to the epoch, which would expire everyone. */
  now?: Date | string | number;
}): SignerCopyRetention {
  const completed = toMillis(input.completedAt);
  if (completed === null) return 'available';
  const now = input.now === undefined ? Date.now() : toMillis(input.now);
  if (now === null) return 'available';
  return now >= completed + SIGNER_COPY_RETENTION_DAYS * DAY_MS
    ? 'expired'
    : 'available';
}

/**
 * What the signer is told about a link that has already been signed.
 *
 * One constant, read by the terminal screen at /sign/[token] and by
 * every refusal lib/signature-write.ts returns for a second signature,
 * so the page and the three write paths cannot answer the same fact
 * differently.
 *
 * It says what cannot happen again. It does not say the link is dead,
 * deleted, destroyed, revoked or expired, because it is none of those
 * things and the next sentence is about to explain why.
 */
export const SIGNER_ALREADY_SIGNED_SENTENCE =
  'This document has been signed and cannot be signed again.';

/**
 * What the copy route says once the window has closed, and what the
 * terminal screen shows in its place.
 *
 * Phrased as what is still possible rather than as a refusal. Somebody
 * reading this is looking for a document that binds them, and the
 * useful information is that the firm still holds it.
 */
export const SIGNER_COPY_RETENTION_EXPIRED_COPY =
  'This copy is no longer available to download here. The firm can send ' +
  'you a copy at any time.';

/**
 * The whole paragraph on the terminal screen, in one place.
 *
 * Three shapes, because the true sentence differs and a single sentence
 * covering all three would have to be false in two of them:
 *
 *   - the window is running, so it says how much of it is left;
 *   - the request is not fully executed yet, so the window has not
 *     started and the honest figure is a floor, not a deadline;
 *   - the window has passed, so it says where the document is instead.
 *
 * The access-code sentence is appended only for a signer who was
 * actually issued a code. An internal signer has no access_code_hash,
 * and telling them to find a code they were never sent would send them
 * searching an inbox for something that does not exist. The same rule
 * governs the watermark sentence on this page: claimed only when true.
 */
export function signerRetentionSentence(input: {
  completedAt: string | Date | null | undefined;
  /** firm_signatures.access_code_hash is set, so a code was issued. */
  accessCodeRequired: boolean;
  now?: Date | string | number;
}): string {
  const retention = resolveSignerCopyRetention({
    completedAt: input.completedAt,
    now: input.now,
  });

  if (retention === 'expired') {
    return `${SIGNER_ALREADY_SIGNED_SENTENCE} ${SIGNER_COPY_RETENTION_EXPIRED_COPY}`;
  }

  const completed = toMillis(input.completedAt);
  const codeClause = input.accessCodeRequired
    ? ' You will need your access code to open it.'
    : '';

  if (completed === null) {
    // The clock has not started. "At least" is true in both directions:
    // it will be no less than this, and in practice longer.
    return (
      `${SIGNER_ALREADY_SIGNED_SENTENCE} This page stays available to you ` +
      `for at least ${SIGNER_COPY_RETENTION_DAYS} days after everyone has ` +
      `signed, so you can keep your copy.${codeClause}`
    );
  }

  const days = remainingDays(completed, input.now);
  return (
    `${SIGNER_ALREADY_SIGNED_SENTENCE} This page stays available to you ` +
    `for ${days} more ${days === 1 ? 'day' : 'days'} so you can keep your ` +
    `copy.${codeClause}`
  );
}

/**
 * Whole days left, rounded UP, and never below one while the window is
 * open.
 *
 * Rounding up because a signer told "0 more days" on a page that still
 * works has been given a number that contradicts the page they are
 * reading. The ceiling is clamped to the full window as well, so a
 * completion timestamp from the future (clock skew between the database
 * and this process) cannot print a figure larger than the window.
 */
function remainingDays(completedMs: number, now: Date | string | number | undefined): number {
  const nowMs = now === undefined ? Date.now() : toMillis(now);
  if (nowMs === null) return SIGNER_COPY_RETENTION_DAYS;
  const left = completedMs + SIGNER_COPY_RETENTION_DAYS * DAY_MS - nowMs;
  const days = Math.ceil(left / DAY_MS);
  return Math.min(SIGNER_COPY_RETENTION_DAYS, Math.max(1, days));
}

/**
 * A timestamp as milliseconds, or null for anything that is not one.
 *
 * Null rather than NaN, so every caller has to decide what an
 * unreadable timestamp means instead of inheriting whatever a
 * comparison against NaN happens to do, which is always false and would
 * silently read as 'available' in one place and 'expired' in another.
 */
function toMillis(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number'
        ? value
        : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
