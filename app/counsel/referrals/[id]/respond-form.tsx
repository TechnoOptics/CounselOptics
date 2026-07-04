'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondToReferralAction } from '@/lib/cocounsel-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

export function RespondToReferralForm({
  firmId,
  referralId,
}: {
  firmId: string;
  referralId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState('');

  function go(type: 'accepted' | 'declined') {
    setError(null);
    if (type === 'accepted' && consent.trim().length < 20) {
      setError(
        t('Paste or describe the client consent record (min. 20 characters). Required by Model Rule 1.5(e).'),
      );
      return;
    }
    startTransition(async () => {
      const res = await respondToReferralAction(
        firmId,
        referralId,
        type,
        type === 'accepted' ? consent.trim() : null,
      );
      if (res.ok) router.refresh();
      else setError(res.error ?? t('Failed.'));
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow"><T>Respond to this referral</T></p>
      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        <T>Accepting requires confirming the client has agreed to the
        co-counsel arrangement IN WRITING. Paste the email / text / signed
        consent into the field below; we capture it on the record so the
        bar can verify if asked.</T>
      </p>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          <T>Client consent record</T>
        </span>
        <textarea
          value={consent}
          onChange={(e) => setConsent(e.target.value)}
          rows={4}
          className="input"
          placeholder={t('Email or signed writing where the client agrees to the co-counsel arrangement and the proposed fee split. Min. 20 chars.')}
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => go('declined')}
          disabled={pending}
          className="btn-ghost"
        >
          {pending ? '...' : <T>Pass</T>}
        </button>
        <button
          type="button"
          onClick={() => go('accepted')}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? '...' : <T>Accept with this consent</T>}
        </button>
      </div>
    </section>
  );
}
