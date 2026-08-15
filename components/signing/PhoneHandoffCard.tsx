'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * The QR card that sits on a desk, and the one lifecycle behind it.
 *
 * Two ceremonies offer a phone handoff. An outside signer's laptop mints a
 * code whose phone COMPLETES the signature. An employee's desk mints one whose
 * phone hands a picture back and can do nothing else. The credentials, the
 * tables and the endpoints behind those are different and are meant to be:
 * see lib/mark-handoff.ts for why a session-authenticated person cannot be
 * given the signer's handoff.
 *
 * What is identical is everything on this side of them. Ask for a code, show
 * it, watch for the other device finishing, stop offering it when it dies, and
 * never mint before the surface says it may. That was written once for the
 * signer and was about to be written a second time for the employee, which is
 * how two surfaces start disagreeing about how long a code lasts or whether a
 * failed mint is an error or an empty card. So the copy is props and the
 * mechanism is not.
 *
 * Nothing here decides anything a server relies on. `mint` and `poll` are
 * whole server actions supplied by the caller and both re-check on the server
 * what this component believes, because a component's state proves nothing to
 * a public HTTP endpoint, which is what every 'use server' export is.
 */

export type PhoneHandoffMint =
  | {
      ok: true;
      svg: string;
      expiresInSeconds: number;
      /**
       * A handle on the row that was just minted, handed back to `poll`.
       *
       * The signer's mint returns none, because that poll asks about the
       * signature the page already holds a token for. The employee's returns
       * the handoff id, because the desk has to ask about the specific code it
       * put on screen. It is NOT a credential: it is a uuid the caller's own
       * session already owns, and the endpoint behind the poll finds its row
       * under that session's user and firm rather than under this string.
       */
      ref?: string;
    }
  | { ok: false; error: string };

type Phase =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'showing'; svg: string; expiresInMs: number; ref: string | null }
  | { kind: 'expired' }
  | { kind: 'unavailable'; message: string };

/**
 * How often the desk asks whether the phone has finished.
 *
 * This was 4000ms and read as broken. A person signs on the phone, watches
 * the desk, and nothing happens for up to four seconds; the reasonable
 * conclusion is that the handoff failed, so they scan again or sign on the
 * pad instead. The mark was on its way the whole time.
 *
 * 1200ms is chosen against what it costs rather than by feel. The window is
 * bounded by the row's own expiry (HANDOFF_TTL_MINUTES), only one code is up
 * at a time per person, and the endpoint behind it is a single indexed row
 * read under the caller's own session. So the extra requests are a few dozen
 * cheap reads across one short signing session, against a person otherwise
 * concluding the feature does not work.
 */
const POLL_MS = 1200;

export const HANDOFF_UNREACHABLE =
  'Could not reach the server. You can sign on this page instead.';

export type PhoneHandoffCopy = {
  /** Offered, and the button would work. */
  offer: string;
  /** Offered, but not yet: the surface is holding it back. */
  notYet: string;
  /** Under the code, once it is on screen. */
  scan: string;
  /** Under that: the route that stays open while the code is up. */
  alsoHere: string;
};

export function PhoneHandoffCard({
  mint,
  poll,
  onFinished,
  available,
  copy,
}: {
  /** Asks the server for a code. */
  mint: () => Promise<PhoneHandoffMint>;
  /** True once the other device has finished. Called only while a code is up,
   *  with the `ref` the mint returned. */
  poll: (ref: string | null) => Promise<boolean>;
  onFinished: () => void;
  /** Whether pressing the button could reach the mint at all. */
  available: boolean;
  copy: PhoneHandoffCopy;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Held in refs and read inside the callbacks, never named in an effect's
  // dependency list. A parent passing inline arrow functions would otherwise
  // tear down and restart the poll on each of its own renders.
  const mintRef = useRef(mint);
  mintRef.current = mint;
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const availableRef = useRef(available);
  availableRef.current = available;

  const showCode = useCallback(async () => {
    // The disabled button says this; this says it again, so the property
    // survives someone re-enabling the button for a reason that seemed good at
    // the time. The server says it a third time, and that one is the control.
    if (!availableRef.current) return;
    setPhase({ kind: 'minting' });
    try {
      const result = await mintRef.current();
      if (!result.ok) {
        setPhase({ kind: 'unavailable', message: result.error });
        return;
      }
      setPhase({
        kind: 'showing',
        svg: result.svg,
        ref: result.ref ?? null,
        // The server's own lifetime, travelling with the code, because the
        // module holding the constant imports node:crypto and cannot be pulled
        // into a browser bundle. A constant retyped here is one that drifts.
        expiresInMs: result.expiresInSeconds * 1000,
      });
    } catch {
      setPhase({ kind: 'unavailable', message: HANDOFF_UNREACHABLE });
    }
  }, []);

  const showing = phase.kind === 'showing';
  const showingRef = phase.kind === 'showing' ? phase.ref : null;

  // While a code is on screen, watch for the other device finishing. Polled
  // rather than pushed on both surfaces: the signer's page is
  // unauthenticated, so a realtime channel there would subscribe successfully
  // and then silently never fire.
  useEffect(() => {
    if (!showing) return;
    let stopped = false;
    const check = async () => {
      try {
        if ((await pollRef.current(showingRef)) && !stopped) finishedRef.current();
      } catch {
        // A dropped poll is not worth telling anyone about. The next one is
        // POLL_MS away and the pad on this page still works.
      }
    };
    // Ask once immediately. setInterval's first tick is a whole POLL_MS away,
    // so without this the desk is deaf for the first interval after the code
    // goes up, which is exactly when a fast signer finishes.
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [showing, showingRef]);

  // The row dies on its own at expires_at, so the screen stops offering a code
  // the server would refuse. This clock is cosmetic: the row is the authority
  // and a phone scanning a stale code is turned away by it whatever this
  // component believes.
  useEffect(() => {
    if (phase.kind !== 'showing') return;
    const timer = setTimeout(() => setPhase({ kind: 'expired' }), phase.expiresInMs);
    return () => clearTimeout(timer);
  }, [phase]);

  const messageId = useId();

  return (
    <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-4">
      {phase.kind === 'showing' ? (
        <div className="flex flex-col items-center text-center">
          <div
            className="w-40 h-40 sm:w-44 sm:h-44 [&>svg]:w-full [&>svg]:h-full rounded-md overflow-hidden"
            // The string is an SVG our own server built from our own template
            // in lib/qr-svg.ts, out of a token our own server minted. No part
            // of it comes from a signer, a firm or a request body, so there is
            // nothing here to sanitise.
            dangerouslySetInnerHTML={{ __html: phase.svg }}
          />
          <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed max-w-sm">
            {copy.scan}
          </p>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-2 leading-relaxed max-w-sm">
            {copy.alsoHere}
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
                    ? copy.offer
                    : copy.notYet}
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
 * A sentence and a ghost button read as a footnote on a card that already has
 * a pad on it, which is how this option got looked past twice. Decorative, so
 * it is hidden from the reading order: the sentence beside it already says
 * everything.
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
