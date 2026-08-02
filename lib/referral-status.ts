/**
 * The colour of a co-counsel referral's status.
 *
 * This map lived twice, byte for byte: once in the referrals list and once
 * on the referral detail page. Two copies of a status palette is how the
 * same state ends up amber in one place and emerald in the other, so it
 * lives here once.
 *
 * Colour is one hex per state rather than a triple of Tailwind classes;
 * StatusPill derives the fill and the border from it.
 */

// Relative, not '@/': lib modules are imported by the test runner without
// the Next.js path alias, so an aliased import here breaks the suite.
import { PILL_COLORS } from './pill-colors';

const COLORS: Record<string, string> = {
  proposed: PILL_COLORS.waiting,
  accepted: PILL_COLORS.good,
  declined: PILL_COLORS.neutral,
  closed: PILL_COLORS.info,
  withdrawn: PILL_COLORS.flagged,
};

/**
 * An unknown status falls back to 'proposed', which is what both call sites
 * did before and reads as "nobody has answered this yet".
 */
export function referralStatusColor(status: string | null | undefined): string {
  return COLORS[String(status ?? '')] ?? COLORS.proposed;
}
