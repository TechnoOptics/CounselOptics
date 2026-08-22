/**
 * What the packet flow has to tell a person before they build a court packet.
 *
 * Two things can put a wrong document in front of a judge, and both were
 * silent:
 *
 *   1. EXHIBITS NOBODY READ. `uploadExhibitAction` ran its auto-scan inside a
 *      try/catch that only console.warn'd, so a scan failure left
 *      `exhibits.scan_data` NULL and said nothing. On the real case that
 *      prompted this module, 17 of 19 exhibits were in that state. Every
 *      surface downstream, including the review prompt, then reasoned over
 *      evidence it had never read, without anything on the page to say so.
 *
 *   2. A PLACEHOLDER REVIEW. `runReview` returns `demoReview` when there is no
 *      API key AND when the Pro token balance is empty, and `saveReview`
 *      stores it like any other. Its body is literally "Demo timeline event 1"
 *      and "Demo issue". That text must never be typeset into a packet.
 *
 * This module is the pure half: it decides what is true. The surfaces decide
 * how to say it. Kept dependency-free so vitest, which runs here in a node
 * environment with no DOM, can test the decisions directly.
 */

/** The subset of an exhibit this assessment needs. */
export type ReadinessExhibit = {
  id: string;
  label: string;
  fileName: string;
  fileType?: string | null;
  uploadedAt?: string | null;
  scanData?: { isDemo?: boolean; modelUsed?: string } | null;
};

/** The subset of a stored review this assessment needs. */
export type ReadinessReview = {
  isDemo?: boolean;
  modelUsed?: string;
  createdAt?: string | null;
} | null;

/**
 * True when a review really came from the model.
 *
 * The sibling of `isRealScan` in lib/types, and it exists for the same reason:
 * the rule was about to be written inline at each of the three places that
 * need it (the PDF builder, the packet page, this assessment), and an inline
 * rule drifts. A demo review is not a weaker review, it is placeholder text
 * about a case the model never saw.
 */
export function isRealReview(review: ReadinessReview): boolean {
  if (!review) return false;
  if (review.isDemo) return false;
  return review.modelUsed !== 'demo' && review.modelUsed !== 'unsupported';
}

/** Why an exhibit counts as unread. */
export type UnreadReason = 'never-scanned' | 'placeholder-scan';

export type UnreadExhibit = {
  id: string;
  label: string;
  fileName: string;
  reason: UnreadReason;
};

export type ReviewState =
  /** Nothing stored. */
  | 'none'
  /** Stored, but it is the demo placeholder. Must not reach a packet. */
  | 'placeholder'
  /** A real model run. */
  | 'real';

export type PacketReadiness = {
  totalExhibits: number;
  /** Exhibits whose contents this service has never actually read. */
  unread: UnreadExhibit[];
  reviewState: ReviewState;
  reviewCreatedAt: string | null;
  /** Whole days between the review and `now`. Null when there is no real review. */
  reviewAgeDays: number | null;
  /**
   * True when at least one exhibit arrived after the review ran. The review
   * cannot have considered it. This is the sharp fact on the case that
   * prompted the module: the review predates the exhibits it appears to cover.
   */
  reviewPredatesEvidence: boolean;
  /** True when the packet can be built with nothing left unsaid. */
  clear: boolean;
};

/**
 * Decide what the person has to be told.
 *
 * `now` is passed in rather than read, so the age arithmetic is testable and
 * so this stays a pure function.
 */
export function assessPacketReadiness(input: {
  exhibits: readonly ReadinessExhibit[];
  review: ReadinessReview;
  now: number;
}): PacketReadiness {
  const unread: UnreadExhibit[] = [];
  for (const e of input.exhibits) {
    if (!e.scanData) {
      unread.push({ id: e.id, label: e.label, fileName: e.fileName, reason: 'never-scanned' });
      continue;
    }
    if (!isRealScanLike(e.scanData)) {
      unread.push({ id: e.id, label: e.label, fileName: e.fileName, reason: 'placeholder-scan' });
    }
  }

  const real = isRealReview(input.review);
  let reviewState: ReviewState = 'none';
  if (input.review) reviewState = real ? 'real' : 'placeholder';

  const createdAt = input.review?.createdAt ?? null;
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const reviewAgeDays =
    real && Number.isFinite(createdMs)
      ? Math.max(0, Math.floor((input.now - createdMs) / 86_400_000))
      : null;

  let reviewPredatesEvidence = false;
  if (real && Number.isFinite(createdMs)) {
    for (const e of input.exhibits) {
      const up = e.uploadedAt ? Date.parse(e.uploadedAt) : NaN;
      if (Number.isFinite(up) && up > createdMs) {
        reviewPredatesEvidence = true;
        break;
      }
    }
  }

  return {
    totalExhibits: input.exhibits.length,
    unread,
    reviewState,
    reviewCreatedAt: createdAt,
    reviewAgeDays,
    reviewPredatesEvidence,
    clear: unread.length === 0 && reviewState !== 'placeholder' && !reviewPredatesEvidence,
  };
}

/** The scan-side rule, kept local so this module imports nothing. Mirrors
 *  `isRealScan` in lib/types, which callers holding a full ScanData should use. */
function isRealScanLike(scan: { isDemo?: boolean; modelUsed?: string }): boolean {
  if (scan.isDemo) return false;
  return scan.modelUsed !== 'demo' && scan.modelUsed !== 'unsupported';
}

/**
 * The sentences shown to the person, in order of what matters.
 *
 * Calm and plain. Somebody reading this is preparing for a court date, so
 * every line states a fact and a next step and nothing else. No warnings about
 * consequences, no urgency, no exclamation.
 */
export function packetReadinessNotices(r: PacketReadiness): string[] {
  const notices: string[] = [];

  if (r.unread.length > 0) {
    const n = r.unread.length;
    notices.push(
      `${n} of your ${r.totalExhibits} exhibit${r.totalExhibits === 1 ? '' : 's'} ` +
        `${n === 1 ? 'has' : 'have'} not been read yet. ` +
        `The packet will still list ${n === 1 ? 'it' : 'them'}, but nothing in the ` +
        `summary or the chronology can draw on what ${n === 1 ? 'it says' : 'they say'} ` +
        `until ${n === 1 ? 'it is' : 'they are'} scanned.`,
    );
  }

  if (r.reviewState === 'placeholder') {
    notices.push(
      'The saved review is an example, not a reading of your case. It is left ' +
        'out of the packet. Run the review again to replace it.',
    );
  } else if (r.reviewState === 'none') {
    notices.push(
      'No review has been run on this case yet. The packet will contain your ' +
        'case details, chronology and exhibits without one.',
    );
  } else if (r.reviewPredatesEvidence) {
    notices.push(
      `The saved review was run ${describeAge(r.reviewAgeDays)}, before some of ` +
        'the exhibits now on file. It did not see them. Run it again so the ' +
        'packet reflects everything you have uploaded.',
    );
  } else if (r.reviewAgeDays !== null && r.reviewAgeDays >= 7) {
    notices.push(
      `The saved review was run ${describeAge(r.reviewAgeDays)}. You can run it ` +
        'again if anything has changed.',
    );
  }

  return notices;
}

function describeAge(days: number | null): string {
  if (days === null) return 'at an unknown time';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'about a month ago' : `about ${months} months ago`;
}
