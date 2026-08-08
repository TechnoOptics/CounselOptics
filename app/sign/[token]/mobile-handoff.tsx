'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { handoffCodeAvailable } from '@/lib/signing-handoff-consent';
import {
  mintSigningHandoffAction,
  signingCompletedAction,
} from './handoff-actions';

/**
 * Sign on your phone, from the laptop that started the ceremony.
 *
 * An additional option beside draw, type and upload, never a
 * replacement for them. The pad is a few pixels above this on the
 * capture card, so a signer whose camera will not focus, whose phone is
 * in another room, or whose code expires has somewhere to go without
 * asking anyone for anything.
 *
 * This renders on both steps, and mints on neither until there is a
 * consent to carry. The disclosure step gets the same card with the
 * button disabled, because an option nobody can find is an option
 * nobody has: this was looked for twice on the first screen and not
 * found there. What must not move earlier is the MINT. A code minted
 * before the disclosure is affirmed would hand a phone a session the
 * signer had not consented to, which is the whole difference between a
 * handoff and a second front door.
 *
 * Both the disabled state and the guard inside showCode ask
 * handoffCodeAvailable, which is the mint's own consent check rather
 * than a second rule that reads like it. lib/signing-handoff-mint.ts
 * asks it again on the server, because the action behind this button is
 * a public endpoint and this component's state proves nothing to it.
 *
 * The QR itself is minted on our server and arrives as inline SVG. The
 * durable /sign/[token] credential is never in it: an internal signer
 * has no access code in front of that URL, so a code encoding it could
 * be photographed off this screen and used to sign as them.
 */

const POLL_MS = 4000;

type Phase =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'showing'; svg: string; expiresInMs: number }
  | { kind: 'expired' }
  | { kind: 'unavailable'; message: string };

export function MobileHandoff({
  signerToken,
  consent,
  onSigned,
}: {
  /** The durable signing credential this page already holds. */
  signerToken: string;
  /** The disclosure affirmed on this laptop, carried onto the handoff
   *  so a signature finished on the phone is recorded as completely as
   *  one finished here. Empty on the disclosure step, which is exactly
   *  what holds the code back there: there is nothing yet to carry. */
  consent: {
    electronicRecordsConsentedAt: string | null;
    hardwareSoftwareConfirmedAt: string | null;
    documentPresented: boolean;
    documentReviewedAt: string | null;
  };
  /** The phone finished. The card moves to its signed state. */
  onSigned: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Read inside the poll and the mint, never in the effect dependency
  // list. A new object identity for the consent prop on every render of
  // the parent would otherwise tear down and restart the poll.
  const consentRef = useRef(consent);
  consentRef.current = consent;
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;

  const showCode = useCallback(async () => {
    // Nothing is minted, and no server action is called, until there is
    // a disclosure to carry. The disabled button below says so; this
    // says it again, so the property survives someone re-enabling the
    // button for a reason that seemed good at the time.
    if (!handoffCodeAvailable(consentRef.current)) return;
    setPhase({ kind: 'minting' });
    try {
      const result = await mintSigningHandoffAction(
        signerToken,
        consentRef.current,
      );
      if (!result.ok) {
        setPhase({ kind: 'unavailable', message: result.error });
        return;
      }
      setPhase({
        kind: 'showing',
        svg: result.svg,
        // The server's own lifetime, travelling with the code. A
        // constant retyped here would be one that drifts from
        // HANDOFF_TTL_MINUTES, and lib/signing-handoff cannot be
        // imported into a browser bundle to read it.
        expiresInMs: result.expiresInSeconds * 1000,
      });
    } catch {
      setPhase({
        kind: 'unavailable',
        message:
          'Could not reach the server. You can sign on this page instead.',
      });
    }
  }, [signerToken]);

  const showing = phase.kind === 'showing';
  // Whether pressing the button would reach the mint at all. The
  // disclosure step holds an empty consent, so this is false there and
  // true from the moment the signer continues.
  const available = handoffCodeAvailable(consent);
  const messageId = useId();

  // While a code is on screen, watch for the phone finishing. Polled
  // rather than pushed: see signingCompletedAction for why a realtime
  // channel on this page would subscribe and then never fire.
  useEffect(() => {
    if (!showing) return;
    let stopped = false;

    const check = async () => {
      try {
        const { signed } = await signingCompletedAction(signerToken);
        if (signed && !stopped) onSignedRef.current();
      } catch {
        // A dropped poll is not worth telling the signer about. The
        // next one is four seconds away and the pad still works.
      }
    };

    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [showing, signerToken]);

  // The row dies on its own at expires_at, so the screen stops offering
  // a code the server would refuse. This clock is only cosmetic: the
  // handoff row is the authority, and a phone scanning a stale code is
  // turned away by it whatever this component believes.
  useEffect(() => {
    if (phase.kind !== 'showing') return;
    const timer = setTimeout(
      () => setPhase({ kind: 'expired' }),
      phase.expiresInMs,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4">
      {phase.kind === 'showing' ? (
        <div className="flex flex-col items-center text-center">
          <div
            className="w-40 h-40 sm:w-44 sm:h-44 [&>svg]:w-full [&>svg]:h-full rounded-md overflow-hidden"
            // The string is an SVG our own server built from our own
            // template in lib/qr-svg.ts, out of a token our own server
            // minted. No part of it comes from a signer, a firm or a
            // request body, so there is nothing here to sanitise.
            dangerouslySetInnerHTML={{ __html: phase.svg }}
          />
          <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed max-w-sm">
            Scan with your phone to sign with your finger. The code works once
            and expires in fifteen minutes.
          </p>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-2 leading-relaxed max-w-sm">
            You can keep signing on this page instead. Whichever you finish
            first is the one that counts.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <QrMark />
            <p
              id={messageId}
              className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-relaxed"
            >
              {phase.kind === 'expired'
                ? 'That code has expired. You can show a new one, or sign on this page.'
                : phase.kind === 'unavailable'
                  ? phase.message
                  : available
                    ? 'Prefer to sign with your finger? Use your phone.'
                    : // True before consent and after it. It offers the
                      // ask rather than the outcome, because the mint
                      // can still refuse on the next step and the
                      // signer should not have been promised otherwise.
                      'You can finish this on your phone. Agree to the disclosure above and continue, then ask for a code to scan on step 2.'}
            </p>
          </div>
          <button
            type="button"
            onClick={showCode}
            disabled={phase.kind === 'minting' || !available}
            aria-describedby={messageId}
            className="btn-ghost text-sm ring-1 ring-ink-200 dark:ring-forest-700/60 disabled:opacity-55 disabled:cursor-not-allowed"
          >
            {phase.kind === 'minting'
              ? 'Preparing a code...'
              : phase.kind === 'idle'
                ? 'Sign with mobile'
                : 'Show a new code'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The option, drawn as the thing it is.
 *
 * A sentence and a ghost button read as a footnote on a card that
 * already has a pad on it, which is how this option got looked past
 * twice. Decorative, so it is hidden from the reading order: the
 * sentence beside it already says everything.
 */
function QrMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="w-5 h-5 shrink-0 mt-0.5 text-ink-400 dark:text-cream-100/45"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3.5v3.5H14z" />
      <path d="M21 14v3.5M17.5 21H21" />
    </svg>
  );
}
