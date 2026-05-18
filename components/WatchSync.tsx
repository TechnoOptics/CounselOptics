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
  nextHearingAt = 0,
  nextHearingTitle = '',
  upcoming = [],
  actions = [],
}: {
  openCount: number;
  latestTitle: string;
  latestCaseId: string;
  /** Epoch millis of the soonest upcoming hearing, 0 if none. */
  nextHearingAt?: number;
  nextHearingTitle?: string;
  /** The next few upcoming hearings (the wrist docket), soonest first. */
  upcoming?: { at: number; title: string }[];
  /** Action Center items: things acted on a case or to-dos, urgent first. */
  actions?: { text: string; urgent: boolean }[];
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
            nextHearingAt: number;
            nextHearingTitle: string;
            upcoming: { at: number; title: string }[];
            actions: { text: string; urgent: boolean }[];
          }): Promise<void>;
        }>('AdvotticWatch');
        if (cancelled) return;
        await AdvotticWatch.sync({
          openCount,
          latestTitle,
          latestCaseId,
          nextHearingAt,
          nextHearingTitle,
          upcoming,
          actions,
        });
      } catch {
        // Old shell without the plugin, watch unpaired, etc. - the
        // glance is best-effort and must never break the phone.
      }
    })();
    return () => {
      cancelled = true;
    };
    // upcoming is a fresh array each render; key on its content so the
    // effect only re-syncs when the docket actually changes.
  }, [
    openCount,
    latestTitle,
    latestCaseId,
    nextHearingAt,
    nextHearingTitle,
    JSON.stringify(upcoming),
    JSON.stringify(actions),
  ]);

  return null;
}
