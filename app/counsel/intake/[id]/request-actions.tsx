'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  setIntakeReminderAction,
  convertIntakeToCaseAction,
} from '@/lib/firm-actions';
import { runGatedAction } from '@/lib/gated-action';

/**
 * Reminder + e-signature actions for a request. The reminder is
 * swept by the existing deadlines cron and notifies the requester +
 * the legal team when due. Send-to-sign reuses the built signing
 * flow (upload a doc, then send) - we link straight into it.
 */
export function RequestActions({
  firmId,
  intakeId,
  currentReminder,
  caseId = null,
}: {
  firmId: string;
  intakeId: string;
  currentReminder: string; // ISO or ''
  /** Set once this intake has been converted into a case. */
  caseId?: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [convertPending, startConvert] = useTransition();
  const [convertError, setConvertError] = useState<string | null>(null);

  function convert() {
    setConvertError(null);
    startConvert(async () => {
      const res = await runGatedAction(() => convertIntakeToCaseAction(firmId, intakeId));
      if (res.ok && res.caseId) {
        router.push(`/counsel/cases/${res.caseId}`);
      } else {
        setConvertError(res.error ?? t('Could not open the matter.'));
      }
    });
  }

  // ISO -> value for <input type=datetime-local> (local, no seconds)
  const toLocal = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate(),
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [when, setWhen] = useState(toLocal(currentReminder));

  function save(clear: boolean) {
    setError(null);
    setOk(null);
    let iso = '';
    if (!clear) {
      const d = new Date(when);
      if (!when || Number.isNaN(d.getTime())) {
        setError(t('Pick a date and time for the reminder.'));
        return;
      }
      iso = d.toISOString();
    }
    startTransition(async () => {
      const res = await setIntakeReminderAction(firmId, intakeId, iso);
      if (res.ok) {
        setOk(clear ? t('Reminder cleared.') : t('Reminder set.'));
        if (clear) setWhen('');
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the reminder.'));
      }
    });
  }

  return (
   <div className="space-y-4">
    <section className="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow"><T>Take it on</T></p>
        <p className="text-[13px] text-ink-700 dark:text-cream-100/85 mt-1 max-w-xl leading-relaxed">
          {caseId
            ? <T>This request is in the team&rsquo;s active queue.</T>
            : <T>Move this into the team&rsquo;s active queue. The requester, summary and
              jurisdiction carry over, so nothing needs re-keying.</T>}
        </p>
        {convertError && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300 mt-1">
            {convertError}
          </p>
        )}
      </div>
      {caseId ? (
        <a
          href={`/counsel/cases/${caseId}`}
          className="btn-secondary !py-1.5 text-[13px] text-center whitespace-nowrap"
        >
          <T>Open it &rarr;</T>
        </a>
      ) : (
        <button
          type="button"
          onClick={convert}
          disabled={convertPending}
          className="btn-primary !py-1.5 text-[13px] whitespace-nowrap disabled:opacity-60"
        >
          {convertPending ? <T>Moving…</T> : <T>Move to active queue</T>}
        </button>
      )}
    </section>

    <section className="card p-5 grid sm:grid-cols-2 gap-5">
      <div className="space-y-2">
        <p className="eyebrow"><T>Reminder</T></p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          <T>Get pinged when this contract/request is due. Notifies you,
          the legal team, and the requester.</T>
        </p>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="input"
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => save(false)}
            disabled={pending}
            className="btn-primary !py-1 text-[13px]"
          >
            {pending ? <T>Saving...</T> : currentReminder ? <T>Update</T> : <T>Set reminder</T>}
          </button>
          {currentReminder && (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={pending}
              className="text-[12px] underline text-ink-600 dark:text-cream-100/70"
            >
              <T>Clear</T>
            </button>
          )}
        </div>
        {currentReminder && (
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
            <T>Currently due</T>{' '}
            {new Date(currentReminder).toLocaleString()}
          </p>
        )}
        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
        {ok && (
          <p className="text-[12px] text-emerald-700 dark:text-emerald-300">
            {ok}
          </p>
        )}
      </div>

      <div className="space-y-2 sm:border-l sm:border-ink-200 sm:dark:border-forest-700/40 sm:pl-5">
        <p className="eyebrow"><T>E-signature</T></p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          <T>Send a document to the parties to sign - external people or
          employees. Signatures + dates render onto the final PDF with
          a tamper-evident audit trail.</T>
        </p>
        <div className="flex flex-col gap-1.5 pt-1">
          <a
            href="/counsel/documents"
            className="btn-primary !py-1 text-[13px] text-center"
          >
            <T>Upload &amp; send for signature</T>
          </a>
          <a
            href="/counsel/signing"
            className="text-[12px] underline text-ink-700 dark:text-cream-100/85"
          >
            <T>Track signing requests &rarr;</T>
          </a>
        </div>
      </div>
    </section>
   </div>
  );
}
