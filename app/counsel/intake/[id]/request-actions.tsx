'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { setIntakeReminderAction } from '@/lib/firm-actions';
import { formatDateTimeNumeric } from '@/lib/format';

/**
 * Reminder + e-signature actions for a request. The reminder is
 * swept by the existing deadlines cron and notifies the requester +
 * the legal team when due. Send-to-sign reuses the built signing
 * flow (upload a doc, then send) - we link straight into it.
 *
 * Taking the request on used to be the first card here. It is the record's
 * primary action, so it now sits in the action bar with the rest of the
 * controls that change the record; see ConvertToMatter.
 */
export function RequestActions({
  firmId,
  intakeId,
  currentReminder,
}: {
  firmId: string;
  intakeId: string;
  currentReminder: string; // ISO or ''
}) {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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
    <section className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="eyebrow"><T>Reminder</T></p>
        <p className="text-[12px] text-muted leading-relaxed">
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
              className="text-[12px] underline text-muted"
            >
              <T>Clear</T>
            </button>
          )}
        </div>
        {currentReminder && (
          <p className="text-[11px] text-muted">
            <T>Currently due</T>{' '}
            {formatDateTimeNumeric(currentReminder)}
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

      <div className="space-y-2 sm:border-l sm:border-edge sm:pl-5">
        <p className="eyebrow"><T>E-signature</T></p>
        <p className="text-[12px] text-muted leading-relaxed">
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
            className="text-[12px] underline text-foreground"
          >
            <T>Track signing requests &rarr;</T>
          </a>
        </div>
      </div>
    </section>
   </div>
  );
}
