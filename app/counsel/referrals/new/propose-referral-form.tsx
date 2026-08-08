'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { proposeReferralAction } from '@/lib/cocounsel-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

export function ProposeReferralForm({
  firmId,
  availableFirms,
}: {
  firmId: string;
  availableFirms: Array<{ id: string; name: string; jurisdictions: string[] | null }>;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [splitPct, setSplitPct] = useState(33);

  function submit(formData: FormData) {
    setError(null);
    const referredFirmId = String(formData.get('referredFirmId') ?? '').trim();
    const matterSummary = String(formData.get('matterSummary') ?? '').trim();
    const state = String(formData.get('state') ?? '').trim();
    if (!referredFirmId) {
      setError(t('Pick a firm to refer to.'));
      return;
    }
    if (!state) {
      setError(t('Pick the matter state.'));
      return;
    }
    startTransition(async () => {
      const res = await proposeReferralAction(firmId, {
        referredFirmId,
        matterSummary,
        proposedSplitPercent: splitPct,
        state,
      });
      if (res.ok && res.referralId) {
        router.push(`/counsel/referrals/${res.referralId}`);
      } else {
        setError(res.error ?? t('Could not propose referral.'));
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-5">
      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">
          <T>Refer to firm</T>
        </span>
        <select name="referredFirmId" className="input" required defaultValue="">
          <option value="" disabled>
            <T>Pick a firm</T>
          </option>
          {availableFirms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.jurisdictions && f.jurisdictions.length > 0
                ? ` (${f.jurisdictions.slice(0, 3).join(', ')})`
                : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">
          <T>State for the matter</T>
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

      <label className="block">
        <span className="block text-sm font-medium text-foreground mb-1.5">
          <T>Matter brief</T>
        </span>
        <textarea
          name="matterSummary"
          rows={4}
          required
          className="input"
          placeholder={t("What the matter is, why the other firm is a good fit, the client's deadline. Min. 20 chars.")}
          maxLength={2000}
        />
      </label>

      <div>
        <label className="block">
          <span className="block text-sm font-medium text-foreground mb-1.5">
            <T>Proposed fee split:</T> {splitPct}<T>% to the receiving firm,</T>{' '}
            {100 - splitPct}<T>% to your firm</T>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={splitPct}
            onChange={(e) => setSplitPct(Number(e.currentTarget.value))}
            className="w-full"
          />
        </label>
        <p className="text-[11.5px] text-muted leading-relaxed mt-1">
          <T>State bar rules vary on referral fees (Model Rule 1.5(e) and
          analogues). Most require the split be in proportion to work
          performed OR each firm assume joint responsibility. Confirm the
          rule for</T> {' '}
          <span className="font-mono"><T>your matter&rsquo;s state</T></span> <T>before
          finalizing.</T>
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <T>Sending...</T> : <T>Propose referral</T>}
        </button>
      </div>
    </form>
  );
}
