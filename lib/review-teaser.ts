import type { AIReview } from './types';

/**
 * Freemium teaser for the Advottic Review. A Basic (free) user can GENERATE
 * a review — that's the hook — but the full breakdown is part of a
 * subscription. This helper redacts a stored review SERVER-SIDE before it is
 * handed to the client: the summary and classification stay whole (the
 * tease), every list keeps only its first item, and the hidden remainder is
 * reported as per-section counts so the UI can show honest "N more" locks.
 * The full review never reaches an unentitled browser — locking with CSS
 * alone would leak the content to anyone who opens dev tools.
 */

export type ReviewLockedCounts = {
  timeline: number;
  keyFacts: number;
  possibleIssues: number;
  legalReferences: number;
  evidenceMapping: number;
  evidenceToStrengthen: number;
  subpoenaTargets: number;
  missingInformation: number;
  suggestedNextSteps: number;
  questionsForAttorney: number;
  /** Sum of everything hidden, for the headline banner. */
  total: number;
};

const TEASER_ITEMS_PER_SECTION = 1;

function tease(items: string[] | undefined): { shown: string[]; hidden: number } {
  const list = items ?? [];
  return {
    shown: list.slice(0, TEASER_ITEMS_PER_SECTION),
    hidden: Math.max(0, list.length - TEASER_ITEMS_PER_SECTION),
  };
}

export function redactReviewForTeaser(review: AIReview): {
  review: AIReview;
  lockedCounts: ReviewLockedCounts;
} {
  const timeline = tease(review.timeline);
  const keyFacts = tease(review.keyFacts);
  const possibleIssues = tease(review.possibleIssues);
  const legalReferences = tease(review.applicableLegalReferences);
  const evidenceMapping = tease(review.evidenceMapping);
  const evidenceToStrengthen = tease(review.evidenceToStrengthen);
  const subpoenaTargets = tease(review.subpoenaTargets);
  const missingInformation = tease(review.missingInformation);
  const suggestedNextSteps = tease(review.suggestedNextSteps);
  const questionsForAttorney = tease(review.questionsForAttorney);

  const lockedCounts: ReviewLockedCounts = {
    timeline: timeline.hidden,
    keyFacts: keyFacts.hidden,
    possibleIssues: possibleIssues.hidden,
    legalReferences: legalReferences.hidden,
    evidenceMapping: evidenceMapping.hidden,
    evidenceToStrengthen: evidenceToStrengthen.hidden,
    subpoenaTargets: subpoenaTargets.hidden,
    missingInformation: missingInformation.hidden,
    suggestedNextSteps: suggestedNextSteps.hidden,
    questionsForAttorney: questionsForAttorney.hidden,
    total:
      timeline.hidden +
      keyFacts.hidden +
      possibleIssues.hidden +
      legalReferences.hidden +
      evidenceMapping.hidden +
      evidenceToStrengthen.hidden +
      subpoenaTargets.hidden +
      missingInformation.hidden +
      suggestedNextSteps.hidden +
      questionsForAttorney.hidden,
  };

  return {
    review: {
      ...review,
      timeline: timeline.shown,
      keyFacts: keyFacts.shown,
      possibleIssues: possibleIssues.shown,
      applicableLegalReferences: legalReferences.shown,
      evidenceMapping: evidenceMapping.shown,
      evidenceToStrengthen: evidenceToStrengthen.shown,
      subpoenaTargets: subpoenaTargets.shown,
      missingInformation: missingInformation.shown,
      suggestedNextSteps: suggestedNextSteps.shown,
      questionsForAttorney: questionsForAttorney.shown,
    },
    lockedCounts,
  };
}
