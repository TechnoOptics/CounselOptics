'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmSurfaceSettingsAction } from '@/lib/firm-settings-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Owner/admin toggles for hiding whole Counsel surfaces the firm does
 * not use. Saves immediately on change (optimistic) and refreshes so
 * the sidebar + search reflect the choice without a manual reload.
 */
export function FirmSurfaceToggles({
  firmId,
  initial,
}: {
  firmId: string;
  initial: { hideSearch: boolean; hideTimeBilling: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const [hideSearch, setHideSearch] = useState(initial.hideSearch);
  const [hideTimeBilling, setHideTimeBilling] = useState(initial.hideTimeBilling);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function save(next: { hideSearch: boolean; hideTimeBilling: boolean }) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateFirmSurfaceSettingsAction(firmId, next);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        // Roll back the optimistic UI on failure.
        setHideSearch(initial.hideSearch);
        setHideTimeBilling(initial.hideTimeBilling);
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  return (
    <div className="card p-6 space-y-4">
      <Toggle
        checked={hideSearch}
        disabled={pending}
        onChange={(v) => {
          setHideSearch(v);
          save({ hideSearch: v, hideTimeBilling });
        }}
        title={<T>Hide the global search</T>}
        description={
          <T>
            Removes the Ask Advottic search box from the top of every
            Counsel page for everyone in your workspace.
          </T>
        }
      />
      <Toggle
        checked={hideTimeBilling}
        disabled={pending}
        onChange={(v) => {
          setHideTimeBilling(v);
          save({ hideSearch, hideTimeBilling: v });
        }}
        title={<T>Hide Time &amp; Billing</T>}
        description={
          <T>
            Hides Time, Billing, and Trust from the sidebar and blocks
            those pages. Turn this on if your firm handles billing
            elsewhere.
          </T>
        }
      />
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && !error && (
        <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
          <T>Saved.</T>
        </p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/50 p-3.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-gold-500"
      />
      <span>
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100">
          {title}
        </span>
        <span className="block text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5 leading-relaxed">
          {description}
        </span>
      </span>
    </label>
  );
}
