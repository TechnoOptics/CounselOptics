'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteFirmClientAction } from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

export function InviteClientForm({ firmId }: { firmId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await runGatedAction(() => inviteFirmClientAction(firmId, formData));
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not invite client.'));
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-3">
      <p className="eyebrow"><T>Invite a client</T></p>
      <div className="grid sm:grid-cols-3 gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="client@example.com"
          className="input sm:col-span-2"
          disabled={pending}
        />
        <input
          name="displayName"
          placeholder={t('Display name (optional)')}
          className="input"
          disabled={pending}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted">
          <T>They&rsquo;ll get a magic-link email and an Advottic account.</T>
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <T>Sending...</T> : <T>Send invitation</T>}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          <T>Invitation sent.</T>
        </p>
      )}
    </form>
  );
}
