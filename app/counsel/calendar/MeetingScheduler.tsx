'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from '@/components/ExternalLink';
import { scheduleStandaloneMeetingAction } from '@/lib/firm-actions';

/**
 * Schedule a Teams/Zoom meeting straight from the shared calendar.
 * Uses the firm's connected integration; every attendee gets a
 * branded invite with a one-tap add-to-calendar, and the meeting
 * lands on this shared calendar for the whole legal team.
 */
export function MeetingScheduler({
  firmId,
  connected,
}: {
  firmId: string;
  /** Providers actually connected for this firm, e.g. ['microsoft','zoom']. */
  connected: Array<'microsoft' | 'zoom'>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    joinUrl: string;
    provider?: string;
    invited?: number;
  } | null>(null);

  function submit(formData: FormData) {
    setError(null);
    setResult(null);
    const local = String(formData.get('when') ?? '');
    const d = new Date(local);
    if (!local || Number.isNaN(d.getTime())) {
      setError('Pick a date and time.');
      return;
    }
    formData.set('startISO', d.toISOString());
    startTransition(async () => {
      const res = await scheduleStandaloneMeetingAction(firmId, formData);
      if (res.ok && res.joinUrl) {
        setResult({
          joinUrl: res.joinUrl,
          provider: res.provider,
          invited: res.invited,
        });
        router.refresh();
      } else {
        setError(res.error ?? 'Could not schedule the meeting.');
      }
    });
  }

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">New meeting</p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
            Set up a Teams or Zoom call. Invites go out to every
            attendee and it appears on this shared calendar.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary shrink-0"
          >
            Schedule meeting
          </button>
        )}
      </div>

      {open && (
        <form action={submit} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                Title
              </span>
              <input
                name="title"
                placeholder="Case strategy sync"
                required
                className="input"
                disabled={pending}
              />
            </label>
            <label className="block">
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                When
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
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                Duration
              </span>
              <select
                name="durationMin"
                defaultValue="30"
                className="input"
                disabled={pending}
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                Platform
              </span>
              {connected.length === 0 ? (
                <p className="text-[12px] text-amber-700 dark:text-amber-300">
                  No meeting account is connected.{' '}
                  <a
                    href="/counsel/meetings"
                    className="underline font-semibold"
                  >
                    Connect Microsoft 365 or Zoom
                  </a>{' '}
                  first.
                </p>
              ) : (
                <select
                  name="provider"
                  defaultValue={
                    connected.length > 1 ? 'auto' : connected[0]
                  }
                  className="input"
                  disabled={pending}
                >
                  {connected.length > 1 && (
                    <option value="auto">Auto (Teams preferred)</option>
                  )}
                  {connected.includes('microsoft') && (
                    <option value="microsoft">Microsoft Teams</option>
                  )}
                  {connected.includes('zoom') && (
                    <option value="zoom">Zoom</option>
                  )}
                </select>
              )}
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                Attendees{' '}
                <span className="text-ink-500 dark:text-cream-100/70">
                  (emails, comma-separated - you&rsquo;re added
                  automatically)
                </span>
              </span>
              <input
                name="attendees"
                placeholder="counsel@firm.com, client@acme.com"
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
                    href="/counsel/meetings"
                    className="underline font-semibold"
                  >
                    Open Meetings
                  </a>
                </>
              )}
            </p>
          )}
          {result && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-900 dark:text-emerald-100 space-y-1">
              <p>
                Scheduled
                {result.provider
                  ? ` via ${result.provider === 'microsoft' ? 'Teams' : 'Zoom'}`
                  : ''}
                {typeof result.invited === 'number'
                  ? ` - ${result.invited} invite${result.invited === 1 ? '' : 's'} sent.`
                  : '.'}
              </p>
              <p className="break-all">
                Join link:{' '}
                <ExternalLink
                  href={result.joinUrl}
                  className="underline font-semibold"
                >
                  {result.joinUrl}
                </ExternalLink>
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
                setResult(null);
              }}
              disabled={pending}
              className="btn text-ink-600 dark:text-cream-100/70"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn-primary"
            >
              {pending ? 'Scheduling...' : 'Create meeting'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
