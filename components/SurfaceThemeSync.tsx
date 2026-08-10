'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  COUNSEL_THEME_COOKIE,
  shellOwnsHtmlTheme,
} from '@/lib/counsel-theme-values';

/**
 * Keeps `<html>`'s theme class pointing at the surface being painted,
 * across client-side navigation.
 *
 * components/ThemeBoot.tsx settles the FIRST painted frame, from the
 * server, and cannot do more than that: it is one inline script in
 * <head> and the root layout stays mounted, so it never runs again. A
 * reader who opens a light counsel matter and then follows the footer
 * link to /about would keep the counsel answer on the consumer page,
 * and one who goes the other way would keep the consumer answer on the
 * workspace - which is the bug this whole change is about, arriving one
 * navigation later.
 *
 * So the same decision is re-made on every path change, from the same
 * two inputs the server used: the path, and the counsel theme cookie.
 * The cookie is first-party and not httpOnly (lib/counsel-theme.ts), so
 * the browser can read the same value the server did rather than being
 * told it separately and drifting.
 *
 * Off a shell route this hands `<html>` back to the reader's own
 * preference, which ThemeBoot recorded in `dataset.theme` and which
 * nothing here ever overwrites.
 */
export function SurfaceThemeSync() {
  const pathname = usePathname();

  useEffect(() => {
    const html = document.documentElement;
    if (shellOwnsHtmlTheme(pathname ?? '')) {
      const cookie = document.cookie
        .split('; ')
        .find((part) => part.startsWith(`${COUNSEL_THEME_COOKIE}=`));
      // Dark unless this reader has opted into light, which is the same
      // default getCounselTheme applies on the server.
      const light = cookie?.slice(COUNSEL_THEME_COOKIE.length + 1) === 'light';
      html.classList.toggle('dark', !light);
      return;
    }
    const pref = html.dataset.theme || 'light';
    const dark =
      pref === 'dark' ||
      (pref === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', dark);
  }, [pathname]);

  return null;
}
