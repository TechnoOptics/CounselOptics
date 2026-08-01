'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

/**
 * The header's account pill. Shared with the server-rendered signed-out link
 * in UserMenu so the two can never drift apart visually.
 */
export const HEADER_LINK_CLASS =
  'inline-flex items-center gap-1 rounded-md bg-cream-200 hover:bg-cream-100 text-forest-900 font-semibold text-[12px] sm:text-sm px-2.5 sm:px-4 py-1 sm:py-1.5 shadow-sm ring-1 ring-cream-100/30 transition-colors whitespace-nowrap';

export function HeaderArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Header account control for statically prerendered routes (the guides, the
 * Spanish pages, the glossary, the tools, the templates). Those pages are
 * built with no request behind them, so the server cannot read the session
 * and the layout ships the anonymous header. A signed-in reader was told
 * "Sign in" on a page they were reading while logged in, with no link back
 * into the app (live audit 2026-08-01, BR-L11).
 *
 * The prerendered HTML keeps the signed-out link, which is the right default
 * and the right thing for crawlers, and means server and first client render
 * agree. On mount we ask the browser Supabase client whether there is a live
 * session (a local cookie read, unless the access token has expired, in which
 * case the client refreshes it) and if there is, the control becomes a route
 * back into the consumer app. The pages stay static.
 *
 * This is deliberately only the account pill, not the whole authenticated
 * header: search, notifications and the token gauge stay off on these
 * marketing / reference routes rather than forcing them to render dynamically.
 */
export function HeaderAuthProbe() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await createBrowserSupabase().auth.getSession();
        if (active && data.session) setSignedIn(true);
      } catch {
        // Supabase not configured, or storage unavailable: keep the
        // signed-out link, which is always a safe answer.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // data-testid is the only way to tell this apart from the server-rendered
  // link in a browser: both render identical markup until the session
  // resolves. It is what the live check for BR-L11 asserts against.
  return (
    <Link
      href={signedIn ? '/cases' : '/sign-in'}
      className={HEADER_LINK_CLASS}
      data-testid="header-auth-probe"
    >
      {signedIn ? 'Your cases' : 'Sign in'}
      <HeaderArrowIcon />
    </Link>
  );
}
