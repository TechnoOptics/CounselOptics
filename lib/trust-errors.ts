import 'server-only';

/**
 * Calm, plain error copy for the trust ledger.
 *
 * Trust accounting holds client money and a lawyer is accountable to a bar
 * association for what this screen says. Two rules drive everything here:
 *
 *   1. A raw Postgres error must never reach the screen. Before this existed,
 *      a failed write rendered the literal string
 *      `new row violates row-level security policy for table
 *      "firm_trust_accounts"`, which tells a lawyer nothing and reads as a
 *      broken product.
 *   2. No message may leave a lawyer believing an entry was recorded when it
 *      was not. Silence about a failed trust write is worse than the failure.
 *
 * Mirrors the shape of lib/ai-errors.ts (classify, log server-side, return
 * branded copy) so the counsel surface presents failures the same way
 * everywhere.
 */

/** `firm_trust_transactions.amount_cents` is Postgres `integer` (int4). */
export const MAX_TRUST_AMOUNT_CENTS = 2147483647;

export const TRUST_GENERIC_MESSAGE =
  'That entry could not be saved, so nothing was recorded. Check the details and try again.';

export const TRUST_PERMISSION_MESSAGE =
  'Your role does not allow changes to this firm’s trust records, so nothing was recorded. Ask a firm owner or administrator to make this change.';

export const TRUST_SESSION_MESSAGE =
  'Your session has ended, so nothing was recorded. Sign in again and re-enter this entry.';

export const TRUST_OVERDRAW_MESSAGE =
  'This would take the client’s trust balance below zero, so nothing was recorded. Review the client ledger before disbursing.';

export const TRUST_ACCOUNT_MISSING_MESSAGE =
  'This trust account is no longer available, so nothing was recorded. Refresh the page and try again.';

export const TRUST_AMOUNT_RANGE_MESSAGE =
  'This amount is larger than a single ledger entry can hold, so nothing was recorded. Record it as separate entries.';

type TrustErrorKind =
  | 'permission'
  | 'session'
  | 'overdraw'
  | 'account_missing'
  | 'amount_range'
  | 'unknown';

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function codeOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const c = (err as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return '';
}

/**
 * Classify a PostgREST / plpgsql failure from the trust RPCs and tables.
 * Leans on the SQLSTATE the RPCs raise deliberately, then falls back to
 * sniffing the message, since PostgREST does not always forward the code.
 */
export function classifyTrustError(err: unknown): TrustErrorKind {
  const code = codeOf(err);
  const msg = messageOf(err).toLowerCase();

  // Ordered most-specific first: the overdraw guard and the session check both
  // otherwise look like generic failures, and both need distinct actions.
  if (code === '28000' || /not authenticated|jwt (expired|is invalid)|invalid token/.test(msg)) {
    return 'session';
  }
  if (/insufficient trust balance/.test(msg)) return 'overdraw';
  if (/trust account not found/.test(msg)) return 'account_missing';
  // post_trust_transaction raises 22003 for BOTH "out of range" and
  // "amount must be a positive integer". Describing a zero or negative amount
  // as "too large" would send the operator looking for the wrong mistake, so
  // check the wording before falling back to the range message.
  if (/must be a positive/.test(msg)) return 'unknown';
  if (
    code === '22003' ||
    /out of range for type|integer out of range|numeric field overflow/.test(msg)
  ) {
    return 'amount_range';
  }
  if (
    code === '42501' ||
    /row-level security|not a member of this firm|role cannot |permission denied|insufficient privilege/.test(
      msg,
    )
  ) {
    return 'permission';
  }
  return 'unknown';
}

/**
 * Map any trust-ledger failure to calm, plain, actionable copy. NEVER returns
 * the raw database text. Logs the real error to the runtime logs (operators
 * only) so a failure is still diagnosable; pass a short `context` label to make
 * the log line searchable.
 */
export function friendlyTrustError(err: unknown, context?: string): string {
  const kind = classifyTrustError(err);
  console.warn(
    `[trust] ${context ?? 'write'} failed (${kind}):`,
    messageOf(err).slice(0, 400),
  );
  switch (kind) {
    case 'permission':
      return TRUST_PERMISSION_MESSAGE;
    case 'session':
      return TRUST_SESSION_MESSAGE;
    case 'overdraw':
      return TRUST_OVERDRAW_MESSAGE;
    case 'account_missing':
      return TRUST_ACCOUNT_MISSING_MESSAGE;
    case 'amount_range':
      return TRUST_AMOUNT_RANGE_MESSAGE;
    case 'unknown':
    default:
      return TRUST_GENERIC_MESSAGE;
  }
}
