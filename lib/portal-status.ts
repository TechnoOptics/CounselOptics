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
 * NOTE: the Tailwind classes below live in `lib/`, which is only scanned
 * because `./lib/**` is in tailwind.config.ts `content`. Don't remove it.
 */

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
};

const TONES: Record<PortalStatusLabel, string> = {
  Received: 'bg-forest-800/50 text-cream-100/85 ring-forest-700/40',
  'In review': 'bg-amber-950/30 text-amber-200 ring-amber-700/40',
  Accepted: 'bg-emerald-950/30 text-emerald-200 ring-emerald-700/40',
  Closed: 'bg-forest-800/50 text-cream-100/70 ring-forest-700/40',
};

export function portalStatusLabel(status: string | null | undefined): PortalStatusLabel {
  return LABELS[String(status ?? '')] ?? 'Received';
}

export function portalStatusTone(label: PortalStatusLabel): string {
  return TONES[label] ?? TONES.Received;
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
