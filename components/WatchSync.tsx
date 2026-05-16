'use client';

/**
 * Wear OS bridge - web side (Wear Phase 2).
 *
 * The cases page already loads the user's cases server-side; this
 * island forwards a tiny summary (open-case count + latest update +
 * its case id) to the native AdvotticWatchPlugin, which pushes it
 * over the Wearable Data Layer to the watch.
 *
 * No-op unless running in the Android Capacitor shell with the
 * plugin present (iOS has no Wearable Data Layer; the Apple Watch
 * path is a separate, currently-blocked workstream). Best-effort:
 * any failure is swallowed so it never disrupts the phone UX.
 */

import { useEffect } from 'react';

export function WatchSync({
  openCount,
  latestTitle,
  latestCaseId,
}: {
  openCount: number;
  latestTitle: string;
  latestCaseId: string;
}) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor, registerPlugin } = await import('@capacitor/core');
        if (
          !Capacitor.isNativePlatform() ||
          Capacitor.getPlatform() !== 'android'
        ) {
          return;
        }
        if (!Capacitor.isPluginAvailable('AdvotticWatch')) return;
        const AdvotticWatch = registerPlugin<{
          sync(o: {
            openCount: number;
            latestTitle: string;
            latestCaseId: string;
          }): Promise<void>;
        }>('AdvotticWatch');
        if (cancelled) return;
        await AdvotticWatch.sync({ openCount, latestTitle, latestCaseId });
      } catch {
        // Old shell without the plugin, watch unpaired, etc. - the
        // glance is best-effort and must never break the phone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openCount, latestTitle, latestCaseId]);

  return null;
}
