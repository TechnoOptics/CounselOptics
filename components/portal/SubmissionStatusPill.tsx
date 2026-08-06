import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';
import type { SubmissionStatus } from '@/lib/template-approval';

/**
 * One label per approval state, worded the same way on both sides of the
 * workspace. Calm and factual: a document that comes back is "needs a change",
 * never a failure the employee is being told off for.
 */
const LABEL: Record<SubmissionStatus, string> = {
  pending: 'With legal',
  changes_requested: 'Needs a change',
  approved: 'Approved, sending',
  sent: 'Sent to recipient',
  withdrawn: 'Withdrawn',
  // Not "Rejected". The decision is about the document, not the colleague who
  // filled it in, and it is the last word they will read on it.
  declined: 'Not going out',
};

const COLOR: Record<SubmissionStatus, string> = {
  pending: PILL_COLORS.info,
  changes_requested: PILL_COLORS.waiting,
  approved: PILL_COLORS.info,
  sent: PILL_COLORS.good,
  withdrawn: PILL_COLORS.neutral,
  // A closed state, not an alarm. The red is reserved for something that
  // needs attention, and this needs none.
  declined: PILL_COLORS.quiet,
};

export function SubmissionStatusPill({ status }: { status: SubmissionStatus }) {
  return (
    <StatusPill color={COLOR[status]}>
      <T>{LABEL[status]}</T>
    </StatusPill>
  );
}
