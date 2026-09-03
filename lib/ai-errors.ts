import 'server-only';

/**
 * Centralized AI-provider error handling.
 *
 * Anthropic (@anthropic-ai/sdk) and OpenAI (Whisper via fetch) throw
 * errors whose messages are raw provider JSON, e.g.
 *
 *   400 {"type":"error","error":{"type":"invalid_request_error",
 *        "message":"Your credit balance is too low ..."}}
 *
 * That string must never reach the UI. Every AI call site funnels its
 * failure through {@link friendlyAiError}, which classifies the error
 * (credit/quota, rate limit, auth, timeout, network) and returns a
 * calm, branded message. Copy stays gentle per the app's tone: the
 * user is often in legal distress, so an outage should read as a quiet
 * "try again shortly," never a scary technical dump.
 *
 * The underlying cause of the credit/quota case is the app's own
 * ANTHROPIC_API_KEY running out of balance (a human must top it up),
 * but the UI degrades gracefully regardless.
 */

/** The default calm message when the provider is unavailable. */
export const AI_UNAVAILABLE_MESSAGE =
  "Advottic's analysis is temporarily unavailable. Please try again shortly.";

/**
 * Shown when the model answered but with its example placeholder instead of
 * an analysis, so nothing was saved. Kept distinct from AI_UNAVAILABLE_MESSAGE
 * on purpose: those two sentences come from different causes (a provider
 * failure versus a placeholder the app refused to store), and while one word
 * of them was shared, a person reporting "temporarily unavailable" could not
 * tell us which had happened, and neither could we without the server log.
 * Calm, and it names no destination.
 */
export const AI_PLACEHOLDER_REFUSED_MESSAGE =
  "Advottic's analysis could not be completed for this case just now, so nothing was saved. Please try again shortly.";

/** Shown when we're being rate-limited (transient, self-resolves). */
export const AI_BUSY_MESSAGE =
  "Advottic's analysis is busy right now. Please try again in a moment.";

type AiErrorKind = 'credit' | 'rate_limit' | 'auth' | 'timeout' | 'network' | 'unknown';

/** Pull an HTTP-ish status code off an Anthropic/OpenAI/fetch error. */
function statusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number') return s;
    // Some SDK wrappers expose it under `statusCode`.
    const sc = (err as { statusCode?: unknown }).statusCode;
    if (typeof sc === 'number') return sc;
  }
  return null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Classify a provider error. Best-effort: leans on the HTTP status
 * first, then falls back to sniffing the message text, since the
 * Anthropic SDK folds the provider's JSON into the Error message.
 */
export function classifyAiError(err: unknown): AiErrorKind {
  const status = statusOf(err);
  const msg = messageOf(err).toLowerCase();

  // Credit / quota / billing exhaustion. Anthropic returns this as a
  // 400 with "credit balance is too low"; OpenAI as 429
  // "insufficient_quota". Check the text regardless of status so both
  // shapes are caught.
  if (
    /credit balance|insufficient_quota|billing|quota|payment required|exceeded your current/i.test(
      msg,
    ) ||
    status === 402
  ) {
    return 'credit';
  }
  if (status === 429 || /rate.?limit|too many requests|overloaded/i.test(msg)) {
    return 'rate_limit';
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|authentication|unauthorized|permission/i.test(msg)
  ) {
    return 'auth';
  }
  if (
    /timeout|timed out|etimedout|abort|deadline/i.test(msg) ||
    status === 408 ||
    status === 504
  ) {
    return 'timeout';
  }
  if (
    /econnreset|econnrefused|enotfound|network|fetch failed|socket hang up/i.test(
      msg,
    ) ||
    (status !== null && status >= 500)
  ) {
    return 'network';
  }
  return 'unknown';
}

/**
 * Map any AI-provider failure to a calm, branded, user-safe message.
 * NEVER returns raw provider JSON. Logs the real error server-side (to
 * Vercel runtime logs, not the user) so operators can still diagnose;
 * pass a short `context` label to make the log line searchable.
 */
export function friendlyAiError(err: unknown, context?: string): string {
  const kind = classifyAiError(err);
  // Server-side breadcrumb only. Truncated so a giant HTML error page
  // from an upstream proxy doesn't flood the logs.
  console.warn(
    `[ai] ${context ?? 'request'} failed (${kind}):`,
    messageOf(err).slice(0, 400),
  );
  switch (kind) {
    case 'rate_limit':
      return AI_BUSY_MESSAGE;
    case 'credit':
    case 'auth':
    case 'timeout':
    case 'network':
    case 'unknown':
    default:
      return AI_UNAVAILABLE_MESSAGE;
  }
}

/**
 * Error carrying a pre-translated, user-safe message. Throw this from
 * AI functions that signal failure by throwing (rather than returning
 * an `{ error }` shape) so callers and client boundaries can surface
 * `.userMessage` directly without ever touching the raw cause.
 */
export class AiUnavailableError extends Error {
  readonly userMessage: string;
  constructor(cause: unknown, context?: string) {
    const userMessage = friendlyAiError(cause, context);
    super(userMessage);
    this.name = 'AiUnavailableError';
    this.userMessage = userMessage;
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
  }
}

/**
 * The message a person may be shown after an AI call threw.
 *
 * The default is the CALLER'S sentence, and an error passes its own message
 * through only by being the type that promises one. That direction is the
 * whole point, and the inverse reads almost identically:
 *
 *   const message = err instanceof Error ? err.message : '';
 *   return message || fallback;                 // WRONG
 *
 * which forwards every Error verbatim and reaches the fallback only when a
 * message is empty, which it never is. That is not a hypothetical. AI helpers
 * in this codebase wrap the PROVIDER call in a try and throw
 * AiUnavailableError from it, but the work either side of that try is
 * unwrapped: resolving the API key, constructing the client, mapping the
 * response. bellaGenerate's missing-key throw is the sharpest of them, because
 * it fires before any request is made, so on a deploy where the key is unset
 * or mid-rotation the inverted form shows a firm admin
 * `The server is missing an ANTHROPIC_API_KEY.` in a red box. A legal team
 * reading that learns nothing they can act on and something they should not
 * have been told.
 *
 * Matched on `name` rather than with instanceof, for the same reason
 * FirmAccessEndedError carries a code: identity has to survive a module being
 * loaded twice, which a dynamic import inside a server action makes possible.
 */
export function calmAiMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.name === 'AiUnavailableError') {
    const message = err.message.trim();
    if (message) return message;
  }
  return fallback;
}
