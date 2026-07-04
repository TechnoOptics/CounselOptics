'use client';

/**
 * Home-screen widget bridge - web side.
 *
 * The cases page already computes a tiny glance summary (open-case
 * count + latest update + upcoming hearings + recent actions) for the
 * Wear OS glance. This island forwards the SAME summary to the native
 * WidgetBridge plugin, which persists it to shared storage the home-
 * screen widgets read:
 *   - iOS:     App Group UserDefaults + WidgetCenter reload (WidgetKit)
 *   - Android: SharedPreferences + AppWidgetManager update
 *
 * No-op unless running in a Capacitor shell (iOS or Android) with the
 * WidgetBridge plugin present. Best-effort: any failure is swallowed so
 * it never disrupts the phone UX. Mirrors components/WatchSync.tsx.
 */

import { useEffect } from 'react';

export type WidgetGlance = {
  openCount: number;
  latestTitle: string;
  latestCaseId: string;
  /** Epoch millis of the soonest upcoming hearing, 0 if none. */
  nextHearingAt?: number;
  nextHearingTitle?: string;
  /** The next few upcoming hearings, soonest first. */
  upcoming?: { at: number; title: string }[];
  /** Things acted on a case or to-dos, urgent first. */
  actions?: { text: string; urgent: boolean }[];
};

export function WidgetSync({
  openCount,
  latestTitle,
  latestCaseId,
  nextHearingAt = 0,
  nextHearingTitle = '',
  upcoming = [],
  actions = [],
}: WidgetGlance) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor, registerPlugin } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const platform = Capacitor.getPlatform();
        if (platform !== 'ios' && platform !== 'android') return;
        if (!Capacitor.isPluginAvailable('WidgetBridge')) return;
        const WidgetBridge = registerPlugin<{
          sync(o: {
            openCount: number;
            latestTitle: string;
            latestCaseId: string;
            nextHearingAt: number;
            nextHearingTitle: string;
            upcoming: { at: number; title: string }[];
            actions: { text: string; urgent: boolean }[];
          }): Promise<void>;
        }>('WidgetBridge');
        if (cancelled) return;
        await WidgetBridge.sync({
          openCount,
          latestTitle,
          latestCaseId,
          nextHearingAt,
          nextHearingTitle,
          upcoming,
          actions,
        });
      } catch {
        // Old shell without the plugin, etc. - the widget is a
        // best-effort glance and must never break the phone.
      }
    })();
    return () => {
      cancelled = true;
    };
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
