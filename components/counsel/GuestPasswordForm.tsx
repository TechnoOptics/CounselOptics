'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setGuestPasswordAction } from '@/lib/guest-account-actions';

/**
 * Password set/change form for a provisioned Counsel guest. Used by the
 * first-login force-change wall and by the guest profile page. On success it
 * navigates to `redirectTo` (the matter for the force-change flow).
 */
export function GuestPasswordForm({
  submitLabel = 'Save password',
  redirectTo,
}: {
  submitLabel?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await setGuestPasswordAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not save the password.');
        return;
      }
      setDone(true);
      if (redirectTo) {
        router.replace(redirectTo);
        router.refresh();
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-900/50 bg-rose-500/10 px-4 py-3 text-[13px] text-danger-text">
          {error}
        </p>
      )}
      {done && !redirectTo && (
        <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-4 py-3 text-[13px] text-emerald-200">
          Password updated.
        </p>
      )}
      <div>
        <label
          htmlFor="guest-password"
          className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-cream-100/55 mb-1"
        >
          New password
        </label>
        <input
          id="guest-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={12}
          className="input"
          placeholder="At least 12 characters"
        />
      </div>
      <div>
        <label
          htmlFor="guest-password-confirm"
          className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-cream-100/55 mb-1"
        >
          Confirm password
        </label>
        <input
          id="guest-password-confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          minLength={12}
          className="input"
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
