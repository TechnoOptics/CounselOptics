'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

// Firm-provisioned guest logins live on this namespace (mirrors
// GUEST_EMAIL_DOMAIN in lib/guest-account-actions.ts). A guest types just their
// handle; we append the domain. Pasting the full address also works.
const GUEST_EMAIL_DOMAIN = 'guest.advottic.com';

/**
 * Username + password sign-in for firm-provisioned Counsel guests. Advottic's
 * main sign-in is passwordless (magic link / OAuth); guests are the one identity
 * type that uses a password, so they get this dedicated, deliberately plain
 * entry point. On success we hand off to /counsel, where the layout resolves the
 * guest to their matter (or the first-login password change).
 */
export function GuestLoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const handle = username.trim();
    const email = handle.includes('@')
      ? handle.toLowerCase()
      : `${handle.toLowerCase()}@${GUEST_EMAIL_DOMAIN}`;
    try {
      const supabase = createBrowserSupabase();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
      if (!data.session) throw new Error('Signed in but no session was returned.');
      // Hard navigation so the freshly-set session cookies reach the server.
      window.location.href = '/counsel';
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Sign-in failed.';
      setError(
        /invalid login credentials/i.test(raw)
          ? 'That username or password is not correct. Check with the firm that gave you access.'
          : raw,
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-900/50 bg-rose-500/10 px-4 py-3 text-[13px] text-danger-text">
          {error}
        </p>
      )}
      <div>
        <label
          htmlFor="guest-username"
          className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-cream-100/55 mb-1"
        >
          Username
        </label>
        <input
          id="guest-username"
          name="username"
          type="text"
          required
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="input"
          placeholder="the username the firm gave you"
        />
      </div>
      <div>
        <label
          htmlFor="guest-login-password"
          className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-cream-100/55 mb-1"
        >
          Password
        </label>
        <input
          id="guest-login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
