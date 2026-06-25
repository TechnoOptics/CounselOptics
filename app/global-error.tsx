'use client';

import { useEffect } from 'react';

/**
 * Root error boundary. Next.js renders this in place of the ENTIRE root
 * layout when the layout (or anything it renders) throws during render -
 * including the React #419 "client-render the whole root" recovery path
 * that a hydration mismatch trips inside the iOS WKWebView.
 *
 * Why it exists: without it, a throw at the root unmounts everything and
 * the WebView shows a blank screen (dark green in dark mode = the native
 * background), which is exactly the App Store Guideline 2.1 "blank page
 * when we launch the app" rejection. This replaces that blank with a
 * branded, actionable Reload screen, and POSTs the real error to
 * /api/crash so the otherwise-invisible WKWebView crash is captured.
 *
 * It must render its own <html>/<body> (it stands in for the root
 * layout) and be a Client Component.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        message: `GlobalError: ${error?.message ?? 'unknown'}`,
        stack: error?.stack ?? null,
        url:
          typeof location !== 'undefined'
            ? location.pathname + (location.search || '')
            : null,
      });
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon(
          '/api/crash',
          new Blob([body], { type: 'application/json' }),
        );
      } else if (typeof fetch !== 'undefined') {
        fetch('/api/crash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* never let the reporter throw */
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#0c1f17',
          color: '#f5efe2',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 360 }}>
          <div
            style={{
              width: 72,
              height: 72,
              margin: '0 auto 20px',
              borderRadius: 18,
              background: 'linear-gradient(135deg, #c9a14f, #e6c878)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 700,
              color: '#0c1f17',
            }}
          >
            A
          </div>
          <p style={{ fontSize: 15, opacity: 0.85, margin: '0 0 18px', lineHeight: 1.4 }}>
            Advottic ran into a problem loading. Reload to continue.
          </p>
          <button
            onClick={() => {
              try {
                reset();
              } catch {
                /* fall through to a hard reload */
              }
              if (typeof location !== 'undefined') location.reload();
            }}
            style={{
              color: '#e6c878',
              background: 'transparent',
              cursor: 'pointer',
              fontWeight: 600,
              border: '1px solid rgba(230, 200, 120, 0.4)',
              borderRadius: 10,
              padding: '11px 24px',
              fontSize: 15,
            }}
          >
            Reload Advottic
          </button>
        </div>
      </body>
    </html>
  );
}
