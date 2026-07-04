'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { T, useT } from '@/components/i18n/LocaleProvider';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

/**
 * One-time setup of the firm's first trust account. Subsequent
 * accounts can be added via /counsel/settings (out of scope for v1).
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
      setError(t('Name and state are required.'));
      return;
    }
    startTransition(async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
      const client = createClient(url, anon);
      const masked = acct
        ? `****${acct.slice(-4)}`
        : null;
      const { error: insertErr } = await client
        .from('firm_trust_accounts')
        .insert({
          firm_id: firmId,
          name,
          bank_name: bank || null,
          account_number_masked: masked,
          state,
          is_iolta: true,
        });
      if (insertErr) setError(insertErr.message);
      else router.refresh();
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
