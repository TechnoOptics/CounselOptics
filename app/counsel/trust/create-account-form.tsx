'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTrustAccountAction } from '@/lib/trust-accounting';
import { US_STATE_CODES } from '@/lib/trust-amount';
import { T, useT } from '@/components/i18n/LocaleProvider';

// Single source of truth, shared with the server action's validation so the
// dropdown can never offer a state the write would reject.
const STATES = US_STATE_CODES;

/**
 * One-time setup of the firm's first trust account.
 *
 * The write goes through createTrustAccountAction, a server action, so it
 * carries the cookie session. This form previously built its own
 * `createClient(url, anonKey)` browser client, which looks for a session in
 * localStorage; this app keeps the session in cookies, so every insert arrived
 * unauthenticated, auth.uid() was null, and the RLS check on
 * firm_trust_accounts rejected it. No trust account was ever created.
 */
export function CreateAccountForm({ firmId }: { firmId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    const bank = String(formData.get('bank') ?? '').trim();
    const state = String(formData.get('state') ?? '').trim();
    const acct = String(formData.get('acct') ?? '').trim();
    if (!name || !state) {
      setError(t('Enter a label for this account and choose a state.'));
      return;
    }
    startTransition(async () => {
      const res = await createTrustAccountAction(firmId, {
        name,
        bankName: bank,
        accountLast4: acct,
        state,
      });
      if (res.ok) router.refresh();
      else setError(res.error ?? t('That account could not be saved. Please try again.'));
    });
  }

  return (
    <form action={submit} className="card p-5 space-y-4">
      <p className="eyebrow"><T>Add your first trust account</T></p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Account label</T>
          </span>
          <input
            name="name"
            required
            placeholder={t('Main IOLTA')}
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Bank</T>
          </span>
          <input name="bank" placeholder={t('Bank name')} className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Last 4 of account number</T>
          </span>
          <input
            name="acct"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="1234"
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>State</T>
          </span>
          <select name="state" className="input" required defaultValue="">
            <option value="" disabled>
              <T>Pick a state</T>
            </option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t('Saving...') : t('Add account')}
        </button>
      </div>
    </form>
  );
}
