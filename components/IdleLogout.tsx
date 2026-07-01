'use client';

/**
 * Automatic logoff (HIPAA Security Rule 164.312(a)(2)(iii); SOC 2 CC6.1).
 * Signs the user out after a period of inactivity, with a short warning
 * so they can stay signed in, plus an absolute session cap. No-ops for
 * signed-out visitors, so it is safe to mount once in the root layout.
 *
 * Nothing here changes how anyone signs IN, so it cannot lock a user out
 * of the product - at worst it ends a stale session early.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

const IDLE_MS = 30 * 60 * 1000; // sign out after 30 min idle
const WARN_MS = 60 * 1000; // warn 60s before the idle logout
const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // hard cap on total session length
const START_KEY = 'advottic.session_start';

export function IdleLogout() {
  const [hasSession, setHasSession] = useState(false);
  const [warning, setWarning] = useState(false);
  const warningRef = useRef(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armRef = useRef<() => void>(() => {});

  const logout = useCallback(async (reason: 'idle' | 'expired') => {
    try {
      localStorage.removeItem(START_KEY);
    } catch {
      /* ignore */
    }
    try {
      await createBrowserSupabase().auth.signOut();
    } catch {
      /* fall through to hard redirect regardless */
    }
    window.location.assign(`/sign-in?timeout=${reason === 'idle' ? '1' : 'expired'}`);
  }, []);

  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setHasSession(Boolean(session));
      if (!session) {
        try {
          localStorage.removeItem(START_KEY);
        } catch {
          /* ignore */
        }
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hasSession) {
      setWarning(false);
      return;
    }

    let start = 0;
    try {
      start = Number(localStorage.getItem(START_KEY)) || 0;
      if (!start) {
        start = Date.now();
        localStorage.setItem(START_KEY, String(start));
      }
    } catch {
      start = Date.now();
    }

    const clearTimers = () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      if (warnRef.current) clearTimeout(warnRef.current);
    };

    const arm = () => {
      clearTimers();
      warningRef.current = false;
      setWarning(false);
      warnRef.current = setTimeout(() => setWarning(true), IDLE_MS - WARN_MS);
      idleRef.current = setTimeout(() => void logout('idle'), IDLE_MS);
    };
    armRef.current = arm;

    const onActivity = () => {
      // Ignore passive events while the warning is up: the user must click
      // "Stay signed in" so a stray mousemove can't silently dismiss it.
      if (!warningRef.current) arm();
    };

    const events: (keyof WindowEventMap)[] = [
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    arm();

    const abs = setInterval(() => {
      if (Date.now() - start >= ABSOLUTE_MS) void logout('expired');
    }, 60 * 1000);

    return () => {
      clearTimers();
      clearInterval(abs);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [hasSession, logout]);

  if (!hasSession || !warning) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Session about to end"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-forest-950/40 backdrop-blur-sm p-4"
    >
      <div className="max-w-sm rounded-2xl bg-white dark:bg-forest-900 border border-ink-200 dark:border-forest-700/50 shadow-xl p-6 text-center space-y-4">
        <h2 className="font-semibold text-forest-900 dark:text-cream-100">Still there?</h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          For your security, we&rsquo;ll sign you out shortly if there&rsquo;s no activity.
          Your work is saved.
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => armRef.current()}
            className="btn bg-forest-900 text-cream-50 hover:bg-forest-800 dark:bg-cream-100 dark:text-forest-900 px-5"
          >
            Stay signed in
          </button>
          <button type="button" onClick={() => void logout('idle')} className="btn-ghost">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
