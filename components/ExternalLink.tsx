'use client';

import { useCallback, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { isNativeApp, resolveNativeBrowserUrl } from '@/lib/platform';

/**
 * Drop-in replacement for `<a href target="_blank" rel="noopener
 * noreferrer">` for links that leave the app (court sites, scheduling
 * pages, external resources). Inside the Capacitor native shell, a
 * plain target="_blank" anchor commonly no-ops or behaves
 * unpredictably in the WKWebView/Android WebView - only the OAuth
 * sign-in flow (app/sign-in/sign-in-buttons.tsx) used the correct
 * pattern (@capacitor/browser's Browser.open) before this component
 * existed. On the web this renders and behaves exactly like a normal
 * external anchor - no behavior change there.
 */
export function ExternalLink({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handleClick = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (!isNativeApp()) return;
      e.preventDefault();
      // Absolute, because Browser.open rejects a relative URL and the
      // fallback below would then navigate the WebView away from the
      // page this link is on, taking any state on it with it.
      const url = resolveNativeBrowserUrl(href, window.location.href);
      import('@capacitor/browser')
        .then(({ Browser }) => Browser.open({ url }))
        .catch(() => {
          window.location.href = url;
        });
    },
    [href, onClick],
  );

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
