'use client';

import { PhoneHandoffCard } from '@/components/signing/PhoneHandoffCard';
import {
  collectPhoneMarkAction,
  mintPhoneMarkAction,
} from './mark-handoff-actions';

/**
 * Sign on your phone, from the desk the employee is already signed in at.
 *
 * The same card the outside signer sees, bound to a different pair of
 * endpoints. There is no disclosure to wait for here, so the code is available
 * from the moment the section renders: an employee signing their employer's
 * own paper is not a consumer under 15 USC 7006(1) and is not owed the E-SIGN
 * disclosure the signer's page carries, which is the only thing holding that
 * card's button back.
 *
 * The poll IS the collection. The desk asks "has my phone drawn yet", and the
 * answer, when it is yes, is the picture. So there is no window in which the
 * desk knows a mark exists and has not got it, and no second endpoint that
 * hands out an image.
 *
 * Nothing about this moves the employee's session. The phone is given a
 * one-time token that authorises exactly one PNG upload to one row and permits
 * no read at all; this desk stays the only thing that can file anything. See
 * the header of lib/mark-handoff.ts.
 */
export function PhoneMarkHandoff({
  templateId,
  available,
  onlyRoute,
  onMark,
}: {
  templateId: string;
  /**
   * Whether the mint could work at all, established on the server.
   *
   * This was a hardcoded `true`, written when the only thing that could hold
   * the card back was the signer's disclosure step, which this surface does
   * not have. It is a prop now because there turned out to be a second reason:
   * 20260815_mark_handoffs.sql is unapplied, so firm_mark_handoffs does not
   * exist and every mint fails. The form does not render this card in that
   * state at all, and this says the same thing a second time so a future
   * caller that renders it optimistically gets a disabled button rather than
   * one that fails on tapping. The server says it a third time, and that one
   * is the control.
   */
  available: boolean;
  /**
   * True when the pad above has nothing to offer, which is what a template
   * restricted to the phone produces. The copy has to change with it:
   * "prefer to sign with your finger?" offers a choice, and there is no
   * choice here.
   */
  onlyRoute?: boolean;
  /**
   * The phone's drawing and the handoff it came from.
   *
   * Both, because the picture alone would let this page claim a phone
   * signature for any image at all. The id goes back to the server with the
   * submission, which finds that row under this session's own user and firm
   * and checks the bytes against the fingerprint the bound phone left. See
   * spendPhoneMarkAttestation in lib/mark-handoff-queries.ts.
   */
  onMark: (dataUrl: string, handoffId: string) => void;
}) {
  return (
    <PhoneHandoffCard
      available={available}
      mint={async () => {
        const res = await mintPhoneMarkAction(templateId);
        // The handoff id becomes the card's `ref` and comes back to the poll
        // below. It is not in the QR: the code carries the one-time token and
        // nothing else, and this id never leaves this session.
        return res.ok
          ? {
              ok: true,
              svg: res.svg,
              expiresInSeconds: res.expiresInSeconds,
              ref: res.handoffId,
            }
          : res;
      }}
      poll={async (handoffId) => {
        if (!handoffId) return false;
        const { mark } = await collectPhoneMarkAction(handoffId);
        if (!mark) return false;
        onMark(mark, handoffId);
        return true;
      }}
      onFinished={() => {}}
      copy={{
        offer: onlyRoute
          ? 'This form is signed on a phone. Show a code and scan it with yours.'
          : 'Prefer to sign with your finger? Use your phone.',
        // Reached only by a caller that rendered this card knowing the mint
        // cannot work. The form does not: it drops the card entirely, and on a
        // phone-only template says why in its own words, because a disabled
        // button is not an explanation.
        notYet: 'Signing on your phone is not available yet.',
        scan: 'Scan with your phone and draw your signature there. The code works once and expires in fifteen minutes.',
        alsoHere: onlyRoute
          ? 'Your signature comes back to this page, and you finish the form here.'
          : 'Your signature comes back to this page, and you can still sign here instead.',
      }}
    />
  );
}
