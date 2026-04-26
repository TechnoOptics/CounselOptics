/**
 * Pre-hydration theme bootstrap. Renders an inline script that runs
 * synchronously in <head> to set the `dark` class on <html> before
 * the page paints, avoiding a flash of the wrong theme.
 *
 * Resolution order (first match wins):
 *   1. `data-server-theme` attribute on <html> set by the layout from
 *      the signed-in user's profiles.theme value
 *   2. `advottic-theme` localStorage key (last manual selection)
 *   3. OS prefers-color-scheme: dark
 *
 * The actual theme switcher writes back to localStorage AND fires a
 * server action that persists profiles.theme, so the cycle stays
 * consistent across devices for authed users.
 */
export function ThemeBoot({ serverTheme }: { serverTheme?: 'light' | 'dark' | 'system' }) {
  // Stringify so we can inject the resolved server value at SSR time.
  const initial = serverTheme ?? 'light';
  const code = `
(function(){
  try{
    var html = document.documentElement;
    var server = ${JSON.stringify(initial)};
    var stored = null;
    try { stored = localStorage.getItem('advottic-theme'); } catch(_){}
    var pref = stored || server || 'system';
    var dark = pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', dark);
    html.dataset.theme = pref;
  }catch(_){}
})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
