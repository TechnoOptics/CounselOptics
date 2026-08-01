'use client';

import { useEffect, useState } from 'react';
import { absoluteTimestamp, relativeTime } from '@/lib/intake-conversation-types';

/**
 * A message timestamp that cannot tear during hydration.
 *
 * `relativeTime()` reads the wall clock and the ambient locale/timezone. On
 * the server that is the Vercel container (UTC, ICU default); in the browser
 * it is the reader's machine, several hundred milliseconds later. Rendering it
 * in both passes produced different text on every request thread, which React
 * reports as #425 ("Text content does not match server-rendered HTML") and
 * then escalates to #422 on the enclosing Suspense boundary. That is the crash
 * the employee Hub has been throwing on /portal/[id] and counsel on
 * /counsel/intake/[id].
 *
 * Server render and the first client render therefore both emit
 * `absoluteTimestamp()`, which is pinned to en-US/UTC and identical in both
 * environments, so there is nothing for React to reconcile. After mount the
 * component upgrades to the friendlier relative label in the reader's own
 * locale. No `suppressHydrationWarning` anywhere: the two renders genuinely
 * match, rather than being told to stop complaining that they do not.
 *
 * Same shape as `components/LocaleTime.tsx`, which fixed this class of bug on
 * the HQ surfaces.
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const absolute = absoluteTimestamp(iso);
  // `title` is the absolute stamp in both passes, so the attribute never
  // changes shape during hydration and the exact time is available on hover
  // from the first paint.
  return (
    <time dateTime={iso} className={className} title={absolute}>
      {mounted ? relativeTime(iso) : absolute}
    </time>
  );
}
