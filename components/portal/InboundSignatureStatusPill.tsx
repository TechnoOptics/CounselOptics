import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';
import {
  inboundEmployeeLabel,
  type InboundEmployeeState,
} from '@/lib/signing-authorization';

/**
 * Where a document the other party sent has got to, as the colleague who
 * handed it over reads it.
 *
 * The sibling of SubmissionStatusPill, which covers the other direction, and
 * it borrows that file's rule about tone: the word is about the DOCUMENT and
 * never about the person who filed it. So a document the legal team will not
 * sign reads "Not being signed as written", which says what is true and what
 * would have to change, and never "Rejected", which sounds like a verdict on
 * a colleague who did nothing wrong.
 *
 * The labels themselves are in lib/signing-authorization.ts so they can be
 * tested: vitest runs in environment node with no DOM.
 */
const COLOR: Record<InboundEmployeeState, string> = {
  pending: PILL_COLORS.info,
  approved: PILL_COLORS.info,
  signed: PILL_COLORS.good,
  // A closed state, not an alarm. The red is reserved for something that
  // needs attention, and this needs none: nothing was sent back, and the
  // note under it says what would have to change.
  declined: PILL_COLORS.quiet,
};

export function InboundSignatureStatusPill({ state }: { state: InboundEmployeeState }) {
  return (
    <StatusPill color={COLOR[state]}>
      <T>{inboundEmployeeLabel(state)}</T>
    </StatusPill>
  );
}
