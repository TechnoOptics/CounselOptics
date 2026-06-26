/**
 * Blank-launch self-heal for the native shells.
 *
 * Why this exists
 * ---------------
 * The iOS/Android apps are remote-URL WebViews of advottic.com. App
 * Store review rejected build 1.0(19) under Guideline 2.1(a) with "a
 * blank page when we launch the app" - the reviewer's iPad showed a
 * solid #0F2D24 screen (the Capacitor `ios.backgroundColor`) for 2+
 * minutes. That exact color means the web document never painted: not
 * the light body (#fff), not the dark body (#0a1f19), and not
 * app/global-error.tsx (#0c1f17 + branded Reload).
 *
 * It slips past every existing guard (SafeMount, the Suspense
 * boundaries, error.tsx, global-error.tsx) because NOTHING THROWS - it
 * is an empty / never-painted document. Two known ways this happens in
 * the WKWebView:
 *   1. A hydration mismatch trips React #419 (discard SSR HTML,
 *      client-render the whole root); during that re-render the
 *      layout's `<Suspense fallback={null}>` shows nothing while a
 *      child suspends, and a stalled chunk leaves it blank forever.
 *   2. A critical JS/CSS chunk fails to execute in WebKit, so the
 *      document loads (HTTP 200) but never renders.
 *
 * Neither is a thrown error, so the React-level boundaries never fire.
 * This runs as a synchronous <head> script - independent of the React
 * bundle - and recovers regardless of which path caused the blank.
 *
 * Behaviour (native shells only; the open web is never touched):
 *   - ~8s after window load, check whether the body painted any real
 *     content. A healthy load (SSR or hydrated) always has visible body
 *     text within a couple of seconds; a blank launch leaves it empty.
 *   - If blank, reload (up to twice) - #419 and chunk hiccups are
 *     usually transient and a fresh load succeeds.
 *   - If still blank after two reloads, inject a branded, actionable
 *     Reload screen with plain DOM so a bare native-background void is
 *     never what a user - or an App Review reviewer - is left staring
 *     at. The sessionStorage counter caps reloads so there is no loop.
 */
// Advottic app icon (96px, base64) so the fallback shows the real brand mark
// even when the network/CDN is degraded — the fallback must be self-contained.
const ADV_ICON = 'data:image/png;base64,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';
const WATCHDOG = `(function(){try{
var KEY='adv-blank-reloads';
function isNativeApp(){try{var c=window.Capacitor;return !!(c&&typeof c.isNativePlatform==='function'&&c.isNativePlatform());}catch(_){return false;}}
function hasPainted(){var b=document.body;if(!b)return false;return (b.innerText||'').replace(/\\s+/g,'').length>20;}
function showFallback(){try{
if(document.getElementById('adv-blank-fallback'))return;
var d=document.createElement('div');
d.id='adv-blank-fallback';
d.setAttribute('style','position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0c1f17;color:#f5efe2;font-family:-apple-system,BlinkMacSystemFont,\\'Segoe UI\\',Roboto,sans-serif;padding:24px;text-align:center');
d.innerHTML='<div style="max-width:320px"><img src="${ADV_ICON}" alt="Advottic" style="width:72px;height:72px;margin:0 auto 18px;border-radius:16px;display:block"><p style="font-size:15px;opacity:.85;margin:0 0 16px;line-height:1.4">Advottic had trouble loading. Tap reload to try again.</p><button id="adv-blank-reload" style="color:#e6c878;background:transparent;border:1px solid rgba(230,200,120,.4);border-radius:10px;padding:11px 24px;font-size:15px;font-weight:600">Reload</button></div>';
(document.body||document.documentElement).appendChild(d);
var btn=document.getElementById('adv-blank-reload');
if(btn)btn.addEventListener('click',function(){try{sessionStorage.removeItem(KEY);}catch(_){}location.reload();});
}catch(_){}}
function check(){try{
if(!isNativeApp())return;
if(hasPainted()){try{sessionStorage.removeItem(KEY);}catch(_){}return;}
var n=0;try{n=parseInt(sessionStorage.getItem(KEY)||'0',10)||0;}catch(_){}
if(n<2){try{sessionStorage.setItem(KEY,String(n+1));}catch(_){}location.reload();return;}
showFallback();
}catch(_){}}
window.addEventListener('load',function(){setTimeout(check,8000);});
}catch(_){}})();`;

export function BlankScreenWatchdog() {
  return <script dangerouslySetInnerHTML={{ __html: WATCHDOG }} />;
}
