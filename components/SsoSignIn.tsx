'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

/**
 * Enterprise SSO entry. The user gives their work email; we take the
 * domain and ask Supabase to start the SAML flow for that domain's
 * configured IdP (Entra, Okta, ...). Supabase returns the IdP redirect
 * URL. If no SSO connection exists for the domain yet, we say so plainly
 * and let them fall back to the other sign-in options above.
 *
 * The per-domain SAML connection itself is provisioned in Supabase (with
 * the customer's IdP metadata). Once it exists, this flow "just works".
 */
export function SsoSignIn() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const domain = email.trim().split('@')[1]?.toLowerCase();
    if (!domain) {
      setError('Enter your work email so we can find your organization.');
      return;
    }
    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      const { data, error: ssoErr } = await supabase.auth.signInWithSSO({ domain });
      if (ssoErr) {
        setError(
          /provider|not found|no sso/i.test(ssoErr.message)
            ? 'Single sign-on isn’t set up for that domain yet. Ask your administrator, or use another option above.'
            : ssoErr.message,
        );
        setPending(false);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setError('Could not start single sign-on. Please use another option above.');
      setPending(false);
    } catch {
      setError('Something went wrong starting single sign-on.');
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-center text-sm font-medium text-forest-700 dark:text-gold-300 hover:underline underline-offset-4"
      >
        Sign in with your organization (SSO)
      </button>
    );
  }

  return (
    <form onSubmit={start} className="mt-3 space-y-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Work email for single sign-on"
        autoFocus
        className="w-full rounded-lg border border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900 px-3 py-2.5 text-sm text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-400/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full disabled:opacity-60"
      >
        {pending ? 'Redirecting…' : 'Continue with SSO'}
      </button>
      {error && (
        <p className="text-[13px] text-rose-700 dark:text-rose-300 leading-relaxed">
          {error}
        </p>
      )}
    </form>
  );
}
