'use client';

import { PhoneHandoffCard } from '@/components/signing/PhoneHandoffCard';
import {
  collectPhoneMarkAction,
  mintPhoneMarkAction,
  type PhoneMarkPollResult,
} from './mark-handoff-actions';

/**
 * Is a poll that carried no signature a wait, or a loss?
 *
 * The poll below used to answer that with `if (!mark) return false`, and the
 * laptop that lost a signature in production had a completely clean console
 * because of it. A desk polling a row the server has already stamped collected
 * is not waiting for anything: the picture existed, it went somewhere, and it
 * is not coming back. That deserves a sentence, and so does a server that said
 * plainly what was wrong.
 *
 * The ordinary wait returns null and stays quiet. It runs every 1200ms, and a
 * console.error on that cadence is how a real one stops being read.
 *
 * A separate function because a branch inside a JSX arrow is a branch nothing
 * can test, and every silent failure in this path has been in one.
 */
export function phoneMarkProblem(result: PhoneMarkPollResult): string | null {
  if (result.mark) return null;
  // The server's own words first. "Sign in again" explains a row this session
  // can no longer read better than any guess made out here, and it is the one
  // somebody can act on.
  if (result.error) return `[phone-mark] ${result.error}`;
  if (result.collected) {
    return '[phone-mark] this handoff is already collected and returned no signature. A signature drawn on a phone has been lost. Check firm_mark_handoffs for this row.';
  }
  return null;
}

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
  disabled,
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
   * True until the employee has affirmed their intent to sign.
   *
   * The affirmation is asked above the whole signature section and gates it.
   * Without this the QR would be the hole in that gate: the pad would be shut
   * and a code could still be minted, scanned and drawn on, and a mark would
   * come back having been made before anybody affirmed anything.
   */
  disabled?: boolean;
  /**
   * The phone's drawing and the handoff it came from.
   *
   * Both, because the picture alone would let this page claim a phone
   * signature for any image at all. The id goes back to the server with the
   * submission, which finds that row under this session's own user and firm
   * and checks the bytes against the fingerprint the bound phone left. See
   * spendPhoneMarkAttestation in lib/mark-handoff-queries.ts.
   *
   * `markAt` is the third, and it is the SERVER'S instant rather than this
   * browser's. The desk prints a date and a time beside the returned
   * signature, and a clock the client chose is the client's word for when it
   * signed. It is null when the row carries none, and the desk then prints no
   * time rather than reaching for `new Date()`.
   */
  onMark: (dataUrl: string, handoffId: string, markAt: string | null) => void;
}) {
  return (
    <PhoneHandoffCard
      available={available}
      disabled={disabled}
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
        const result = await collectPhoneMarkAction(handoffId);
        if (result.mark) {
          onMark(result.mark, handoffId, result.markAt);
          return true;
        }
        const problem = phoneMarkProblem(result);
        if (problem) console.error(problem);
        return false;
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
        // The gate, said where somebody looking at the shut button is looking.
        // The button carries aria-describedby to this sentence, so it is what
        // a screen reader hears instead of an unexplained disabled control.
        //
        // The phone-only wording keeps the orienting half of `offer`. That
        // sentence is the only thing telling this employee their form cannot
        // be signed on the laptop at all, and on a phone-only template this
        // card is what greets them, so replacing it wholesale with the gate
        // would answer a question they have not asked yet.
        locked: onlyRoute
          ? 'This form is signed on a phone. Tick the box above to confirm your intent, then show a code.'
          : 'Tick the box above to confirm your intent, then you can show a code.',
        scan: 'Scan with your phone and draw your signature there. The code works once and expires in fifteen minutes.',
        alsoHere: onlyRoute
          ? 'Your signature comes back to this page, and you finish the form here.'
          : 'Your signature comes back to this page, and you can still sign here instead.',
      }}
    />
  );
}
