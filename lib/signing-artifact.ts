/**
 * Which document a counsel surface should put on screen for a signing
 * request, and what it has to say about it.
 *
 * A signing request has up to two artifacts, and they are different
 * legal objects:
 *
 *   the ORIGINAL, `firm_documents.file_path`, the bytes the firm
 *   uploaded. The request's SHA-256 chain is grounded in these, which
 *   is why nothing ever overwrites them.
 *
 *   the EXECUTED COPY, `firm_signing_requests.signed_file_path`, the
 *   PDF lib/signature-render.ts produces once the last signer is in,
 *   with each signature and its date stamped on the signature line.
 *
 * Until this module existed, every counsel surface previewed the
 * original whatever the state of the request, so a completed signing
 * showed a document with nothing on the signature line. The executed
 * copy was generated, stored, and read by nobody.
 *
 * Swapping the file silently would trade one wrong answer for another.
 * Someone comparing the two, or asked in a dispute which one they
 * viewed, must not have to guess. So the decision returns BOTH which
 * artifact to show and why, and the surface states it.
 *
 * Kept pure, and apart from the pages, so the whole decision is
 * testable: the unit suite runs in a node environment with no DOM, and
 * this is the part that is worth asserting.
 */

/** Which of the two artifacts a surface is looking at. */
export type SigningArtifactKind = 'executed' | 'original';

/**
 * What the surface has to tell the reader about the artifact it chose.
 * One per honest state, so the copy is never inferred from the kind
 * alone: 'original' and 'executed_missing' both show the original, and
 * they do not mean the same thing.
 */
export type SigningArtifactNotice =
  /** The executed copy, with the signatures on it. */
  | 'executed'
  /**
   * Every signer signed, but no executed copy was recorded. The render
   * failed, or the request predates the render pipeline. The original
   * is shown, and is NOT to be presented as executed.
   */
  | 'executed_missing'
  /**
   * An executed copy is on record but could not be opened just now.
   * The original is shown instead. Distinct from 'executed_missing'
   * because the remedy is different: this one is a storage problem,
   * that one means the executed copy was never produced.
   */
  | 'executed_unreadable'
  /** Some signers are still out. The original, by design. */
  | 'original_partial'
  /** Nothing to add: the original, and no executed copy is due yet. */
  | 'original';

export type SigningArtifactChoice = {
  kind: SigningArtifactKind;
  /** Storage path within the firm-documents bucket. */
  path: string;
  notice: SigningArtifactNotice;
};

/** Treat blank and whitespace-only paths as absent. */
function usable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Choose the artifact for one signing request.
 *
 * Returns null when there is nothing to show at all, which happens
 * when the underlying document row has gone and no executed copy was
 * ever recorded.
 *
 * The executed copy is honoured ONLY on a completed request. A
 * `signed_file_path` sitting on a request that is not completed
 * belongs to some earlier state of it, and showing it would assert an
 * execution that the request's own status denies.
 */
export function selectSigningArtifact(input: {
  status: string | null | undefined;
  signedFilePath?: string | null;
  originalFilePath?: string | null;
}): SigningArtifactChoice | null {
  const executed = usable(input.signedFilePath);
  const original = usable(input.originalFilePath);

  if (input.status === 'completed') {
    if (executed) return { kind: 'executed', path: executed, notice: 'executed' };
    if (original) {
      return { kind: 'original', path: original, notice: 'executed_missing' };
    }
    return null;
  }

  if (!original) return null;
  if (input.status === 'partial') {
    return { kind: 'original', path: original, notice: 'original_partial' };
  }
  return { kind: 'original', path: original, notice: 'original' };
}

/** What a surface actually puts on screen, once the URLs are known. */
export type ResolvedSigningArtifact = {
  kind: SigningArtifactKind;
  notice: SigningArtifactNotice;
  /** The artifact on screen. Null when neither could be opened. */
  url: string | null;
  /**
   * The original, offered alongside the executed copy so the two can
   * be compared. Null whenever the original IS what is on screen,
   * since there would be nothing to compare it against.
   */
  originalUrl: string | null;
};

/**
 * Settle the choice against the URLs that were actually minted.
 *
 * Minting a signed storage URL is a network call and can fail, so
 * "the record says show the executed copy" and "the executed copy is
 * on screen" are not the same statement. When the second does not
 * follow from the first, the surface falls back to the original and
 * has to say WHICH of the two reasons applies: nothing was ever
 * rendered, or the rendered file could not be opened. Presenting the
 * original under an "executed" label because a URL failed is exactly
 * the quiet substitution this whole module exists to refuse.
 */
export function resolveSigningArtifact(
  choice: SigningArtifactChoice | null,
  urls: { executedUrl?: string | null; originalUrl?: string | null },
): ResolvedSigningArtifact | null {
  if (!choice) return null;
  const executedUrl = usable(urls.executedUrl);
  const originalUrl = usable(urls.originalUrl);
  if (choice.kind === 'executed') {
    if (executedUrl) {
      return { kind: 'executed', notice: 'executed', url: executedUrl, originalUrl };
    }
    return {
      kind: 'original',
      notice: 'executed_unreadable',
      url: originalUrl,
      originalUrl: null,
    };
  }
  return {
    kind: 'original',
    notice: choice.notice,
    url: originalUrl,
    originalUrl: null,
  };
}

/**
 * Is `path` the executed copy of THIS request, and nothing else?
 *
 * The executed PDF is written to `signed/<request-id>/final.pdf`,
 * outside the `<firm-id>/...` prefix every uploaded firm document
 * lives under. Reading it therefore goes through the service-role
 * client, which bypasses storage RLS, so the caller's firm membership
 * and this confinement are the whole authorization. Anything that
 * could name a different request's copy, or walk out of the prefix
 * entirely, has to be refused here.
 *
 * The trailing slash is load-bearing: without it a request id that is
 * a prefix of another ('abc' against 'abcdef') would open the wrong
 * request's executed copy.
 */
export function isExecutedCopyPath(
  requestId: string | null | undefined,
  path: string | null | undefined,
): boolean {
  const id = usable(requestId);
  const p = usable(path);
  if (!id || !p) return false;
  // No traversal, no absolute paths, no backslash smuggling: the only
  // shape ever written is a plain three-segment key.
  if (p.includes('..') || p.startsWith('/') || p.includes('\\')) return false;
  return p.startsWith(`signed/${id}/`);
}
