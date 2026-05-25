'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DistressMatch } from '@/lib/distress-detector';

/**
 * Full-screen red alert that surfaces when the in-app distress
 * detector fires a `distress:detected` window event. Mounted in
 * the root layout so every signed-in surface (Bella, Decoder,
 * voice transcripts, case notes) shares the same UI.
 *
 * Buttons:
 *   1. Call 911 (tel:911)               - always available
 *   2. Text 988 (sms:988)               - always available
 *   3. Trigger Safe Witness             - press-and-hold 2s
 *                                          ONLY enabled when the
 *                                          user has contacts saved
 *   4. I'm safe, dismiss                - suppresses the overlay
 *                                          for the current phrase
 *                                          for 5 minutes
 *
 * The Safe Witness trigger is a 2s press-and-hold rather than a
 * single tap because false positives are the operator's biggest
 * risk - we want the user to have a clear "this is what I'm doing"
 * moment before the SMS / email fan-out to their contacts fires.
 * Mirrors the watch's 4-second press-and-hold intentionality.
 */
export function DistressOverlay() {
  const [match, setMatch] = useState<DistressMatch | null>(null);
  // 0..1 progress for the Safe Witness press-and-hold ring.
  const [holdProgress, setHoldProgress] = useState(0);
  // Whether we've already kicked off the alert (so a long press
  // doesn't fire it twice).
  const [triggered, setTriggered] = useState(false);
  // Whether the user has any Safe Witness contacts configured.
  // Defaults to null = unknown; the fetch below populates it the
  // first time the overlay fires.
  const [hasContacts, setHasContacts] = useState<boolean | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  // Phrases recently dismissed → don't re-surface for 5 minutes.
  // Storing in a ref keeps it stable across re-renders without
  // bouncing state.
  const dismissedRef = useRef<Map<string, number>>(new Map());

  // Subscribe to the global distress event.
  useEffect(() => {
    function onDistress(e: Event) {
      const ce = e as CustomEvent<DistressMatch>;
      const detail = ce.detail;
      if (!detail) return;
      // Suppression: same phrase dismissed in the last 5 min → no-op.
      const dismissedAt = dismissedRef.current.get(detail.phrase);
      if (dismissedAt && Date.now() - dismissedAt < 5 * 60_000) return;
      setMatch(detail);
      setHoldProgress(0);
      setTriggered(false);
      setTriggerError(null);
    }
    window.addEventListener('distress:detected', onDistress);
    return () => window.removeEventListener('distress:detected', onDistress);
  }, []);

  // First time the overlay shows, ask the server whether the user
  // has any Safe Witness contacts. Result is cached for the page
  // lifetime via the `hasContacts !== null` guard.
  useEffect(() => {
    if (!match) return;
    if (hasContacts !== null) return;
    let cancelled = false;
    fetch('/api/safe/contacts/count', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((j: { count?: number }) => {
        if (cancelled) return;
        setHasContacts((j.count ?? 0) > 0);
      })
      .catch(() => {
        if (cancelled) return;
        // Treat as no-contacts on lookup failure so the trigger
        // button shows the configure-first hint rather than firing
        // into a black hole.
        setHasContacts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [match, hasContacts]);

  // Press-and-hold for the Safe Witness trigger. We use rAF rather
  // than setInterval so the ring animates smoothly with vsync.
  const HOLD_MS = 2_000;
  const startHold = useCallback(() => {
    if (triggered) return;
    holdStartRef.current = performance.now();
    function step(now: number) {
      const start = holdStartRef.current;
      if (start == null) return;
      const elapsed = now - start;
      const p = Math.min(1, elapsed / HOLD_MS);
      setHoldProgress(p);
      if (p >= 1) {
        holdRafRef.current = null;
        holdStartRef.current = null;
        fireSafeWitness();
        return;
      }
      holdRafRef.current = requestAnimationFrame(step);
    }
    holdRafRef.current = requestAnimationFrame(step);
  }, [triggered]);

  const cancelHold = useCallback(() => {
    if (holdRafRef.current != null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    holdStartRef.current = null;
    setHoldProgress(0);
  }, []);

  async function fireSafeWitness() {
    if (triggered) return;
    setTriggered(true);
    setTriggerError(null);
    // Browser geolocation, best-effort with a 4s budget. If we
    // can't get a fix we still fire the alert - the email + SMS
    // still go out with whatever location was last known.
    let lat: number | null = null;
    let lng: number | null = null;
    let acc: number | null = null;
    try {
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          resolve(null);
          return;
        }
        const t = setTimeout(() => resolve(null), 4_000);
        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(t);
            resolve(p);
          },
          () => {
            clearTimeout(t);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 4_000, maximumAge: 30_000 },
        );
      });
      if (pos) {
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        acc = pos.coords.accuracy;
      }
    } catch {
      /* swallow - alert still fires without location */
    }
    try {
      const r = await fetch('/api/safe/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'web',
          note: 'Fired from in-app distress overlay.',
          lat,
          lng,
          accuracy_m: acc,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        contacts_alerted?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setTriggerError(j.error ?? `Could not send (HTTP ${r.status}).`);
        setTriggered(false);
        return;
      }
      // Successful fire - we leave triggered=true so the button
      // visibly disables and the success state takes over.
    } catch (e) {
      setTriggerError(
        e instanceof Error ? e.message : 'Network error firing alert.',
      );
      setTriggered(false);
    }
  }

  function dismiss() {
    if (match) {
      dismissedRef.current.set(match.phrase, Date.now());
    }
    cancelHold();
    setMatch(null);
    setTriggered(false);
    setTriggerError(null);
  }

  // Pointer-up anywhere cancels an in-progress hold. Otherwise the
  // user could press, drag off the button, and the hold would keep
  // running silently in the background.
  useEffect(() => {
    if (!match) return;
    function onUp() {
      if (holdRafRef.current != null) cancelHold();
    }
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [match, cancelHold]);

  if (!match) return null;

  const acute = match.tier === 'acute';
  const ringDegrees = Math.round(holdProgress * 360);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="distress-overlay-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-rose-950/80 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative max-w-md w-[92%] sm:w-full mx-auto bg-[#1B0F0F] ring-1 ring-rose-400/40 rounded-2xl p-6 sm:p-7 space-y-4 shadow-2xl">
        {/* Dismiss in the top corner so it's discoverable but not
            the loudest action. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss alert"
          className="absolute top-2.5 right-3 text-rose-100/60 hover:text-rose-100 text-xl leading-none"
        >
          &times;
        </button>

        <div className="text-center space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.25em] text-rose-300 font-semibold">
            Are you okay?
          </p>
          <h2
            id="distress-overlay-title"
            className="font-display text-2xl text-cream-100 leading-snug"
          >
            {acute
              ? "It sounds like you're in crisis. You're not alone."
              : "It sounds like you may be in danger."}
          </h2>
          <p className="text-[13px] text-rose-100/80 leading-relaxed">
            {acute
              ? "If you're thinking about hurting yourself or ending your life, talk to someone now."
              : "If someone is hurting you or you're in immediate danger, call 911. We can also alert your trusted contacts."}
          </p>
        </div>

        {/* Primary actions */}
        <div className="grid grid-cols-2 gap-2">
          <a
            href="tel:911"
            className="block text-center px-3 py-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[15px]"
          >
            Call 911
          </a>
          <a
            href={acute ? 'tel:988' : 'sms:988'}
            className="block text-center px-3 py-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-rose-950 font-bold text-[15px]"
          >
            {acute ? 'Call 988' : 'Text 988'}
          </a>
        </div>

        {/* Safe Witness trigger - press-and-hold to fire the SMS +
            email fan-out to all configured contacts. */}
        <div className="rounded-xl bg-rose-500/10 ring-1 ring-rose-400/30 p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-rose-300 font-semibold">
            Safe Witness
          </p>
          {hasContacts === false ? (
            <div className="space-y-2">
              <p className="text-[13px] text-rose-100/85 leading-snug">
                No Safe Witness contacts saved yet. Add at least one
                trusted person at <span className="font-mono">/profile</span>{' '}
                so a future press can reach them in a tap.
              </p>
              <a
                href="/profile#safe-witness"
                className="block text-center text-[12.5px] px-3 py-2 rounded-md bg-cream-100/10 hover:bg-cream-100/20 text-cream-100 font-semibold"
              >
                Set up Safe Witness
              </a>
            </div>
          ) : triggered && !triggerError ? (
            <p className="text-[13px] text-emerald-300 leading-snug">
              <strong>Alert sent.</strong> Your contacts have been notified
              by email and (when carrier-verified) SMS. They can see your
              live location on the alert page.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-rose-100/85 leading-snug">
                Press and hold to alert every trusted contact you've
                saved. They'll see a verification PIN, your location,
                and a tap-to-call link.
              </p>
              <button
                type="button"
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
                disabled={triggered || hasContacts === null}
                className="relative w-full px-3 py-3 rounded-lg bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-white font-bold text-[14px] overflow-hidden select-none touch-none"
                aria-label="Press and hold for 2 seconds to trigger Safe Witness"
              >
                {/* The progress ring sweeps from 0° → 360° while
                    the user holds. conic-gradient is widely
                    supported in modern browsers. */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-lg pointer-events-none"
                  style={{
                    background: `conic-gradient(rgba(255,255,255,0.35) ${ringDegrees}deg, transparent 0deg)`,
                    mixBlendMode: 'overlay',
                  }}
                />
                <span className="relative">
                  {holdProgress > 0 && holdProgress < 1
                    ? `Hold… ${Math.ceil(2 - holdProgress * 2)}s`
                    : triggered
                      ? 'Sending…'
                      : hasContacts === null
                        ? 'Loading…'
                        : 'Hold to trigger Safe Witness'}
                </span>
              </button>
              {triggerError && (
                <p className="text-[12px] text-rose-300 mt-1">{triggerError}</p>
              )}
            </>
          )}
        </div>

        {/* Always-visible crisis resources, regardless of tier. */}
        <div className="border-t border-rose-500/20 pt-3 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.2em] text-rose-300/70 font-semibold">
            Always available
          </p>
          <ul className="text-[12px] text-rose-100/80 space-y-1 leading-relaxed">
            <li>
              <strong className="text-cream-100">988 Suicide & Crisis Lifeline</strong>{' '}
              -{' '}
              <a href="tel:988" className="underline">
                call or text 988
              </a>
            </li>
            <li>
              <strong className="text-cream-100">Crisis Text Line</strong> - text{' '}
              <a href="sms:741741&body=HOME" className="underline">
                HOME to 741741
              </a>
            </li>
            <li>
              <strong className="text-cream-100">Domestic Violence Hotline</strong>{' '}
              -{' '}
              <a href="tel:18007997233" className="underline">
                1-800-799-7233
              </a>
            </li>
          </ul>
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="block w-full text-center text-[12px] text-rose-100/60 hover:text-rose-100 py-2"
          >
            I&rsquo;m safe - dismiss this for now
          </button>
        </div>
      </div>
    </div>
  );
}
