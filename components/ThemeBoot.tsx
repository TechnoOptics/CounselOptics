import type { CounselTheme } from '@/lib/counsel-theme-values';

/**
 * Pre-hydration theme bootstrap. Renders an inline script that runs
 * synchronously in <head> to set the `dark` class on <html> before
 * the page paints, avoiding a flash of the wrong theme.
 *
 * Resolution order (first match wins):
 *   1. `surfaceTheme`, when this route is painted by a shell that
 *      carries its own theme. See lib/counsel-theme-values.ts.
 *   2. `data-server-theme` attribute on <html> set by the layout from
 *      the signed-in user's profiles.theme value
 *   3. `advottic-theme` localStorage key (last manual selection)
 *   4. OS prefers-color-scheme: dark
 *
 * The actual theme switcher writes back to localStorage AND fires a
 * server action that persists profiles.theme, so the cycle stays
 * consistent across devices for authed users.
 *
 * `html.dataset.theme` always records the READER's own preference, never
 * the surface's. It is what the consumer switcher reads back, and what
 * components/SurfaceThemeSync.tsx hands `<html>` back to when a
 * client-side navigation leaves a shell route.
 */
export function ThemeBoot({
  serverTheme,
  surfaceTheme,
}: {
  serverTheme?: 'light' | 'dark' | 'system';
  /** Set only on a route whose shell owns the theme. */
  surfaceTheme?: CounselTheme;
}) {
  // Stringify so we can inject the resolved server value at SSR time.
  const initial = serverTheme ?? 'light';
  const code = `
(function(){
  try{
    var html = document.documentElement;
    var server = ${JSON.stringify(initial)};
    var surface = ${JSON.stringify(surfaceTheme ?? null)};
    var stored = null;
    try { stored = localStorage.getItem('advottic-theme'); } catch(_){}
    var pref = stored || server || 'system';
    var dark = pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', surface ? surface === 'dark' : dark);
    html.dataset.theme = pref;
  }catch(_){}
})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
