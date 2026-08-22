/**
 * The person's own written account of what happened.
 *
 * Stored as `cases.description`: the textarea named `description` in
 * app/cases/new/case-form.tsx is the only thing that writes it at creation
 * time, and `caseFromRow` in lib/storage.ts surfaces it as `Case.description`.
 * There is no separate narrative column on `cases`.
 *
 * This module is pure on purpose. vitest here runs in the node environment
 * with no DOM, so the rules that decide whether a review is stale, and whether
 * a review is real, have to live somewhere a test can call them directly
 * rather than somewhere a test can only read.
 */

/** One superseded version of the account, kept verbatim. */
export type CompositionVersion = {
  /** The text exactly as it stood before the edit that replaced it. */
  text: string;
  /** ISO timestamp of the edit that replaced this text. */
  replacedAt: string;
};

/** Upper bound on a single saved account, in characters. */
export const MAX_COMPOSITION_LENGTH = 20000;

/**
 * Normalize what the person typed before it is compared or stored.
 *
 * Only leading and trailing whitespace goes; nothing inside the text is
 * touched. This is somebody's account of events, so it is not reflowed,
 * re-cased, or truncated here.
 */
export function normalizeComposition(text: string): string {
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * Read a stored history value back into a list.
 *
 * The column is jsonb and may be absent entirely on a deployment where the
 * migration has not been applied, so anything that is not a well-formed entry
 * is dropped rather than allowed to become a version with no text or no date.
 */
export function parseCompositionHistory(raw: unknown): CompositionVersion[] {
  if (!Array.isArray(raw)) return [];
  const out: CompositionVersion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.text !== 'string' || typeof e.replacedAt !== 'string') continue;
    if (!e.text) continue;
    out.push({ text: e.text, replacedAt: e.replacedAt });
  }
  return out;
}

/**
 * Add the outgoing text to the history.
 *
 * Nothing is ever removed. A capped or rolling history would quietly discard
 * the earliest account of events, which on this product is the version closest
 * in time to what happened, so growth is bounded at the input instead: a single
 * account cannot exceed MAX_COMPOSITION_LENGTH.
 *
 * A save that does not change the text adds no version, so re-saving the same
 * words does not manufacture a revision that never happened. An empty outgoing
 * text adds none either: there was nothing there to preserve.
 */
export function appendCompositionVersion(
  history: CompositionVersion[],
  previousText: string,
  nextText: string,
  replacedAt: string,
): CompositionVersion[] {
  const prev = normalizeComposition(previousText);
  const next = normalizeComposition(nextText);
  if (!prev) return history;
  if (prev === next) return history;
  return [...history, { text: prev, replacedAt }];
}

/** ISO timestamp of the most recent edit, or null when nothing was ever replaced. */
export function lastCompositionEditAt(history: CompositionVersion[]): string | null {
  let latest: string | null = null;
  for (const v of history) {
    if (latest === null || v.replacedAt > latest) latest = v.replacedAt;
  }
  return latest;
}

/**
 * Whether a review was written against text the person has since replaced.
 *
 * This is the single most important rule in this module. A review presented as
 * current, when the account it read has since been rewritten, is a document
 * that can go in front of a judge describing facts that are no longer the ones
 * asserted. So the comparison fails towards "stale": a timestamp that cannot be
 * parsed on either side is treated as stale rather than assumed to be fine.
 */
export function isReviewStale(
  review: { createdAt?: string | null } | null | undefined,
  history: CompositionVersion[],
): boolean {
  if (!review) return false;
  if (history.length === 0) return false;
  const reviewAt = Date.parse(review.createdAt ?? '');
  if (Number.isNaN(reviewAt)) return true;
  for (const v of history) {
    const editedAt = Date.parse(v.replacedAt);
    if (Number.isNaN(editedAt)) return true;
    if (editedAt > reviewAt) return true;
  }
  return false;
}

/**
 * Whether a review really came from the model.
 *
 * `runReview` in lib/ai.ts returns a demo placeholder on a deployment with no
 * API key, and again when a Pro token balance has run out. The placeholder
 * renders like an analysis and reads like one. Storing it, or showing it under
 * the same heading as a real review, puts invented issue-spotting in a legal
 * file, so every consumer has to exclude it.
 *
 * Deliberately the same shape and the same conservative test as `isRealScan`
 * in lib/types.ts: only an explicit demo marker excludes a review. A review
 * whose model is simply unrecorded is not assumed to be fake, because hiding a
 * real review is its own failure.
 */
export function isRealReview(
  review: { isDemo?: boolean; modelUsed?: string } | null | undefined,
): boolean {
  if (!review) return false;
  if (review.isDemo) return false;
  return review.modelUsed !== 'demo' && review.modelUsed !== 'unsupported';
}
