'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from '@/components/ExternalLink';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { scheduleMeetingFromIntakeAction } from '@/lib/firm-actions';

/**
 * Schedule a Teams/Zoom meeting straight from the request. Uses the
 * firm's connected integration; the join link is posted into the
 * thread and the requester is notified.
 */
export function ScheduleMeetingPanel({
  firmId,
  intakeId,
  defaultTitle,
}: {
  firmId: string;
  intakeId: string;
  defaultTitle: string;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setJoinUrl(null);
    const local = String(formData.get('when') ?? '');
    const d = new Date(local);
    if (!local || Number.isNaN(d.getTime())) {
      setError(t('Pick a date and time.'));
      return;
    }
    formData.set('startISO', d.toISOString());
    startTransition(async () => {
      const res = await scheduleMeetingFromIntakeAction(
        firmId,
        intakeId,
        formData,
      );
      if (res.ok) {
        setJoinUrl(res.joinUrl ?? null);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not schedule the meeting.'));
      }
    });
  }

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow"><T>Meeting</T></p>
          <p className="text-[12px] text-muted mt-1">
            <T>Schedule a Teams or Zoom call on this request - the link
            drops into the thread.</T>
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary shrink-0"
          >
            <T>Schedule meeting</T>
          </button>
        )}
      </div>

      {open && (
        <form action={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>Title</T>
              </span>
              <input
                name="title"
                defaultValue={defaultTitle}
                className="input"
                disabled={pending}
              />
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>When</T>
              </span>
              <input
                name="when"
                type="datetime-local"
                required
                className="input"
                disabled={pending}
              />
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>Duration</T>
              </span>
              <select
                name="durationMin"
                defaultValue="30"
                className="input"
                disabled={pending}
              >
                <option value="15"><T>15 minutes</T></option>
                <option value="30"><T>30 minutes</T></option>
                <option value="45"><T>45 minutes</T></option>
                <option value="60"><T>60 minutes</T></option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>Extra attendees</T>{' '}
                <span className="text-muted">
                  <T>(emails, comma-separated - the requester is added
                  automatically)</T>
                </span>
              </span>
              <input
                name="attendees"
                placeholder="counsel@firm.com, vendor@acme.com"
                className="input"
                disabled={pending}
              />
            </label>
          </div>
          {error && (
            <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-[13px] text-rose-800 dark:text-rose-200">
              {error}
              {/connect/i.test(error) && (
                <>
                  {' '}
                  <a
                    href="/counsel/calendar"
                    className="underline font-semibold"
                  >
                    <T>Open Calendar</T>
                  </a>
                </>
              )}
            </p>
          )}
          {joinUrl && (
            <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-900 dark:text-emerald-100">
              <T>Scheduled. Join link posted to the thread:</T>{' '}
              <ExternalLink
                href={joinUrl}
                className="underline font-semibold break-all"
              >
                {joinUrl}
              </ExternalLink>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="btn text-muted"
            >
              <T>Cancel</T>
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn-primary"
            >
              {pending ? <T>Scheduling...</T> : <T>Create meeting</T>}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
