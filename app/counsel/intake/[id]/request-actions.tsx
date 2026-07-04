'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setIntakeReminderAction,
  convertIntakeToCaseAction,
} from '@/lib/firm-actions';

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [convertPending, startConvert] = useTransition();
  const [convertError, setConvertError] = useState<string | null>(null);

  function convert() {
    setConvertError(null);
    startConvert(async () => {
      const res = await convertIntakeToCaseAction(firmId, intakeId);
      if (res.ok && res.caseId) {
        router.push(`/counsel/cases/${res.caseId}`);
      } else {
        setConvertError(res.error ?? 'Could not open the matter.');
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
        setError('Pick a date and time for the reminder.');
        return;
      }
      iso = d.toISOString();
    }
    startTransition(async () => {
      const res = await setIntakeReminderAction(firmId, intakeId, iso);
      if (res.ok) {
        setOk(clear ? 'Reminder cleared.' : 'Reminder set.');
        if (clear) setWhen('');
        router.refresh();
      } else {
        setError(res.error ?? 'Could not save the reminder.');
      }
    });
  }

  return (
   <div className="space-y-4">
    <section className="card p-5 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow">Matter</p>
        <p className="text-[13px] text-ink-700 dark:text-cream-100/85 mt-1 max-w-xl leading-relaxed">
          {caseId
            ? 'This request has been opened as a matter in your caseload.'
            : 'Accept this request and open it as a matter. It joins the firm caseload with the client, summary, and jurisdiction pre-filled.'}
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
          View matter &rarr;
        </a>
      ) : (
        <button
          type="button"
          onClick={convert}
          disabled={convertPending}
          className="btn-primary !py-1.5 text-[13px] whitespace-nowrap disabled:opacity-60"
        >
          {convertPending ? 'Opening…' : 'Open as a matter'}
        </button>
      )}
    </section>

    <section className="card p-5 grid sm:grid-cols-2 gap-5">
      <div className="space-y-2">
        <p className="eyebrow">Reminder</p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          Get pinged when this contract/request is due. Notifies you,
          the legal team, and the requester.
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
            {pending ? 'Saving...' : currentReminder ? 'Update' : 'Set reminder'}
          </button>
          {currentReminder && (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={pending}
              className="text-[12px] underline text-ink-600 dark:text-cream-100/70"
            >
              Clear
            </button>
          )}
        </div>
        {currentReminder && (
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
            Currently due{' '}
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
        <p className="eyebrow">E-signature</p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
          Send a document to the parties to sign - external people or
          employees. Signatures + dates render onto the final PDF with
          a tamper-evident audit trail.
        </p>
        <div className="flex flex-col gap-1.5 pt-1">
          <a
            href="/counsel/documents"
            className="btn-primary !py-1 text-[13px] text-center"
          >
            Upload &amp; send for signature
          </a>
          <a
            href="/counsel/signing"
            className="text-[12px] underline text-ink-700 dark:text-cream-100/85"
          >
            Track signing requests &rarr;
          </a>
        </div>
      </div>
    </section>
   </div>
  );
}
