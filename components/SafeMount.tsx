'use client';

import { Component, type ReactNode } from 'react';

/**
 * Error boundary for non-essential, always-mounted client helpers
 * (native bridges, banners, capture deterrents, watch inbox, distress
 * overlay). If any of them throws during render - notably the React
 * #419 "hydration recovered by client-rendering the entire root" path
 * that a hydration mismatch triggers inside the iOS WKWebView - this
 * contains the failure to the helper subtree and renders nothing, so
 * the real page content still paints. Without it, one helper throwing
 * unmounts the whole root and the app shows a blank screen (dark green
 * in dark mode), which is exactly the App Store 2.1 "blank page on
 * launch" rejection.
 *
 * The caught error is still POSTed to /api/crash so the underlying bug
 * stays visible in crash_reports (the WKWebView is otherwise a black
 * box - this is how an app-only crash surfaces server-side).
 */
export class SafeMount extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    try {
      const body = JSON.stringify({
        message: `SafeMount${this.props.label ? `:${this.props.label}` : ''}: ${
          error?.message ?? 'unknown'
        }`,
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
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
