/**
 * How a firm's internal intake status is shown to the employee who filed it.
 *
 * This lived twice - once in the requests list, once on the request page -
 * and the two copies drifted. Both were missing 'converted' and 'accepted',
 * so a request legal had already taken on as a matter showed as step 1 of 3
 * on the detail page and printed the raw word "converted" in the list. The
 * two also disagreed on colour: the same "In review" state was amber in one
 * place and emerald in the other.
 *
 * Employees never see the firm's conflict-check vocabulary. Statuses collapse
 * onto three legible milestones: Received -> In review -> Decision.
 *
 * Colour is now one hex per state rather than a triple of Tailwind classes;
 * StatusPill derives the background and border from it. That is why this file
 * no longer contributes any class names to the build.
 */

// Relative, not '@/': lib modules are imported by the test runner without
// the Next.js path alias, so an aliased import here breaks the suite.
import { PILL_COLORS } from './pill-colors';

/** The employee-facing milestones, in order. */
export const PORTAL_STEPS = ['Received', 'In review', 'Decision'] as const;

export type PortalStatusLabel = 'Received' | 'In review' | 'Accepted' | 'Closed';

/**
 * Every status the counsel side can set must appear here. An unmapped status
 * falls back to 'Received', which reads as "nobody has looked at this yet" -
 * so an omission doesn't degrade gracefully, it actively misinforms the
 * requester. Add the key here whenever a new status is introduced.
 */
const LABELS: Record<string, PortalStatusLabel> = {
  in_progress: 'Received',
  conflict_check_passed: 'In review',
  conflict_check_flagged: 'In review',
  engaged: 'Accepted',
  accepted: 'Accepted',
  converted: 'Accepted',
  rejected: 'Closed',
  closed: 'Closed',
};

const COLORS: Record<PortalStatusLabel, string> = {
  Received: PILL_COLORS.neutral,
  'In review': PILL_COLORS.waiting,
  Accepted: PILL_COLORS.good,
  Closed: PILL_COLORS.quiet,
};

export function portalStatusLabel(status: string | null | undefined): PortalStatusLabel {
  return LABELS[String(status ?? '')] ?? 'Received';
}

/** The one hex a StatusPill needs. Text, fill and border all come from it. */
export function portalStatusColor(label: PortalStatusLabel): string {
  return COLORS[label] ?? COLORS.Received;
}

/** True once the firm has made a call either way. */
export function isPortalDecision(label: PortalStatusLabel): boolean {
  return label === 'Accepted' || label === 'Closed';
}

/** Index into PORTAL_STEPS for the milestone strip. */
export function portalStepIndex(label: PortalStatusLabel): number {
  if (isPortalDecision(label)) return 2;
  return label === 'In review' ? 1 : 0;
}
