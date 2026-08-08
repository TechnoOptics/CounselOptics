'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setFirmMemberRateAction } from '@/lib/time-tracking';
import { parseRateInput, rateCentsToInputValue } from '@/lib/billing-rates';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The hourly rate a member's time is billed at.
 *
 * Rendered only for an owner or admin. That is a presentation choice and not
 * the gate: setFirmMemberRateAction is a `'use server'` export and therefore a
 * public HTTP endpoint, so it runs its own owner/admin check through
 * lib/firm-authz.ts regardless of what this component decides to draw.
 *
 * The typed value is parsed here so the person sees the refusal next to the
 * field, but the server parses nothing and validates the integer it is handed.
 */
export function MemberRateCell({
  firmId,
  memberUserId,
  rateCents,
}: {
  firmId: string;
  memberUserId: string;
  rateCents: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(rateCentsToInputValue(rateCents));
  const [applyToUnbilled, setApplyToUnbilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const saved = rateCentsToInputValue(rateCents);
  const dirty = value.trim() !== saved;

  function save() {
    const parsed = parseRateInput(value);
    if (!parsed.ok) {
      setNote(null);
      setError(parsed.error);
      return;
    }
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = await setFirmMemberRateAction(
        firmId,
        memberUserId,
        parsed.cents,
        { applyToUnbilled },
      );
      if (!res.ok) {
        setError(res.error ?? t('Could not save the rate.'));
        return;
      }
      const repriced = res.repricedEntries ?? 0;
      setNote(
        repriced > 0
          ? t('Saved. Repriced unbilled time entries:') + ` ${repriced}`
          : t('Saved. New time entries will use this rate.'),
      );
      setApplyToUnbilled(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-muted" aria-hidden="true">
          $
        </span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
            setNote(null);
          }}
          disabled={pending}
          inputMode="decimal"
          aria-label={t('Hourly rate in dollars')}
          placeholder={t('No rate')}
          className="input py-1 text-[12px] w-24 tabular-nums"
        />
        <span className="text-[11px] text-muted">
          <T>/hr</T>
        </span>
      </div>

      {dirty && (
        <>
          <label className="flex items-start gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={applyToUnbilled}
              onChange={(e) => setApplyToUnbilled(e.target.checked)}
              disabled={pending}
              className="mt-0.5"
            />
            <span>
              <T>Also apply to this person&rsquo;s unbilled time</T>
            </span>
          </label>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="btn-secondary py-1 px-2 text-[12px]"
          >
            {pending ? <T>Saving...</T> : <T>Save rate</T>}
          </button>
        </>
      )}

      {/*
        Nothing is said under a field that already shows the rate - the number
        would just be printed twice. The line below is only for the state that
        needs explaining: no rate, which silently prices this person's hours at
        nothing.
      */}
      {!dirty && rateCents === null && (
        <p className="text-[11px] text-muted">
          <T>Time logged now bills at $0.00.</T>
        </p>
      )}

      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      {note && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
          {note}
        </p>
      )}
    </div>
  );
}
