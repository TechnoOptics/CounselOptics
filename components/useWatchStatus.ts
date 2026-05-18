'use client';

/**
 * Watch detection - web side.
 *
 * Two questions the phone app may want answered:
 *  - isWatch: is the page itself being rendered on a watch-class
 *    device (form factor).
 *  - watchPaired / watchReachable / watchAppInstalled: is there a
 *    Wear OS watch with the Advottic watch app paired and reachable.
 *
 * The authoritative source is the native AdvotticWatch plugin
 * (watchStatus). Off the Android Capacitor shell this degrades to a
 * conservative user-agent guess for isWatch and "no watch" for the
 * rest - never throws, always returns something usable.
 */

import { useEffect, useState } from 'react';

export type WatchStatus = {
  /** This device is a watch-class device. */
  isWatch: boolean;
  /** A Wear OS node is connected to this phone. */
  watchPaired: boolean;
  /** A paired watch is reachable right now. */
  watchReachable: boolean;
  /** A node advertises the Advottic watch-app capability. */
  watchAppInstalled: boolean;
  nodeCount: number;
  /** Still resolving the native query. */
  loading: boolean;
};

const NO_WATCH = {
  watchPaired: false,
  watchReachable: false,
  watchAppInstalled: false,
  nodeCount: 0,
};

/**
 * Best-effort web-only guess that the page is rendered on a watch.
 * Wear OS WebView user-agents are not standardised, so this is a
 * heuristic fallback only; the native plugin is authoritative.
 */
export function isWearOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\bwatch\b/i.test(ua) || /wear\s?os/i.test(ua);
}

export function useWatchStatus(): WatchStatus {
  const [status, setStatus] = useState<WatchStatus>({
    isWatch: false,
    ...NO_WATCH,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const settle = (s: Omit<WatchStatus, 'loading'>) => {
      if (!cancelled) setStatus({ ...s, loading: false });
    };

    (async () => {
      try {
        const { Capacitor, registerPlugin } = await import('@capacitor/core');
        if (
          !Capacitor.isNativePlatform() ||
          Capacitor.getPlatform() !== 'android' ||
          !Capacitor.isPluginAvailable('AdvotticWatch')
        ) {
          settle({ isWatch: isWearOS(), ...NO_WATCH });
          return;
        }
        const AdvotticWatch = registerPlugin<{
          watchStatus(): Promise<{
            isWatch: boolean;
            watchPaired: boolean;
            watchReachable: boolean;
            watchAppInstalled: boolean;
            nodeCount: number;
          }>;
        }>('AdvotticWatch');
        const r = await AdvotticWatch.watchStatus();
        settle({
          isWatch: !!r.isWatch,
          watchPaired: !!r.watchPaired,
          watchReachable: !!r.watchReachable,
          watchAppInstalled: !!r.watchAppInstalled,
          nodeCount: typeof r.nodeCount === 'number' ? r.nodeCount : 0,
        });
      } catch {
        // Old shell without the method, no Wear stack, etc.
        settle({ isWatch: isWearOS(), ...NO_WATCH });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
