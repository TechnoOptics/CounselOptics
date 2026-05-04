'use client';

import { createBrowserClient } from '@supabase/ssr';
import { cookieDomainForHost } from './cookie-domain';

export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.',
    );
  }
  // Promote cookie Domain to .advottic.com on production so a sign-in
  // minted in the apex tab is visible to hq.advottic.com and
  // enterprise.advottic.com without a sign-in bounce per subdomain.
  // On localhost / preview deployments the helper returns undefined and
  // cookies stay host-scoped (the correct behavior for dev).
  const domain =
    typeof window !== 'undefined'
      ? cookieDomainForHost(window.location.hostname)
      : undefined;
  return createBrowserClient(url, anon, {
    cookieOptions: domain ? { domain } : undefined,
  });
}
