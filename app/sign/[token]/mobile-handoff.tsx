'use client';

import { handoffCodeAvailable } from '@/lib/signing-handoff-consent';
import { PhoneHandoffCard } from '@/components/signing/PhoneHandoffCard';
import {
  mintSigningHandoffAction,
  signingCompletedAction,
} from './handoff-actions';

/**
 * Sign on your phone, from the laptop that started the ceremony.
 *
 * An additional option beside draw, type and upload, never a replacement for
 * them. The pad is a few pixels above this on the capture card, so a signer
 * whose camera will not focus, whose phone is in another room, or whose code
 * expires has somewhere to go without asking anyone for anything.
 *
 * This renders on both steps, and mints on neither until there is a consent to
 * carry. The disclosure step gets the same card with the button disabled,
 * because an option nobody can find is an option nobody has: this was looked
 * for twice on the first screen and not found there. What must not move
 * earlier is the MINT. A code minted before the disclosure is affirmed would
 * hand a phone a session the signer had not consented to, which is the whole
 * difference between a handoff and a second front door.
 *
 * The card, its lifecycle and its poll are components/signing/PhoneHandoffCard,
 * shared with the employee's form. What stays here is the part that is only
 * true of an outside signer: the consent that has to exist before a code may
 * be asked for at all. `available` is handoffCodeAvailable, which is the
 * mint's own consent check rather than a second rule that reads like it, and
 * lib/signing-handoff-mint.ts asks it again on the server because the action
 * behind this button is a public endpoint.
 *
 * The QR itself is minted on our server and arrives as inline SVG. The durable
 * /sign/[token] credential is never in it: an internal signer has no access
 * code in front of that URL, so a code encoding it could be photographed off
 * this screen and used to sign as them.
 */
export function MobileHandoff({
  signerToken,
  consent,
  onSigned,
}: {
  /** The durable signing credential this page already holds. */
  signerToken: string;
  /** The disclosure affirmed on this laptop, carried onto the handoff so a
   *  signature finished on the phone is recorded as completely as one
   *  finished here. Empty on the disclosure step, which is exactly what holds
   *  the code back there: there is nothing yet to carry. */
  consent: {
    electronicRecordsConsentedAt: string | null;
    hardwareSoftwareConfirmedAt: string | null;
    documentPresented: boolean;
    documentReviewedAt: string | null;
  };
  /** The phone finished. The card moves to its signed state. */
  onSigned: () => void;
}) {
  return (
    <PhoneHandoffCard
      available={handoffCodeAvailable(consent)}
      mint={() => mintSigningHandoffAction(signerToken, consent)}
      poll={async () => {
        // Done here means the SIGNATURE exists, which is this surface's whole
        // difference from the employee's desk: that phone hands a picture back
        // to a session that files it, and this one completes the ceremony
        // itself. Scanned is the state in between, and it is the same state on
        // both.
        const { signed, scanned } = await signingCompletedAction(signerToken);
        if (signed) return 'done';
        return scanned ? 'scanned' : 'waiting';
      }}
      onFinished={onSigned}
      copy={{
        offer: 'Prefer to sign with your finger? Use your phone.',
        // True before consent and after it. It offers the ask rather than the
        // outcome, because the mint can still refuse on the next step and the
        // signer should not have been promised otherwise.
        notYet:
          'You can finish this on your phone. Agree to the disclosure above and continue, then ask for a code to scan on step 2.',
        scan: 'Scan with your phone to sign with your finger. The code works once and expires in fifteen minutes.',
        // This phone finishes the signature, so there is nothing further to do
        // here and the sentence says so rather than implying a next step. The
        // page still moves on by itself when the signature lands.
        scanned:
          'Finish signing on your phone. This page updates on its own when you are done.',
        alsoHere:
          'You can keep signing on this page instead. Whichever you finish first is the one that counts.',
      }}
    />
  );
}
