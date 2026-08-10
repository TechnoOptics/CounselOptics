'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from '@/components/ExternalLink';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { scheduleStandaloneMeetingAction } from '@/lib/firm-actions';
import { runGatedAction } from '@/lib/gated-action';
import { PanelCard } from '@/components/counsel/patterns';

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
  const t = useT();
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
      setError(t('Pick a date and time.'));
      return;
    }
    formData.set('startISO', d.toISOString());
    startTransition(async () => {
      const res = await runGatedAction(() => scheduleStandaloneMeetingAction(firmId, formData));
      if (res.ok && res.joinUrl) {
        setResult({
          joinUrl: res.joinUrl,
          provider: res.provider,
          invited: res.invited,
        });
        router.refresh();
      } else {
        setError(res.error ?? t('Could not schedule the meeting.'));
      }
    });
  }

  return (
    <PanelCard title={<T>New meeting</T>} bodyClassName="p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] text-muted">
            <T>Set up a Teams or Zoom call. Invites go out to every
            attendee and it appears on this shared calendar.</T>
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
                placeholder={t('Case strategy sync')}
                required
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
                <option value="90"><T>90 minutes</T></option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>Platform</T>
              </span>
              {connected.length === 0 ? (
                <p className="text-[12px] text-amber-700 dark:text-amber-300">
                  <T>No meeting account is connected.</T>{' '}
                  {/* The connectors live at the foot of THIS page. This
                      used to point at /counsel/meetings, which has been
                      a redirect back to here since W20, so the link
                      reloaded the page you were already on. */}
                  <a href="#connectors" className="underline font-semibold">
                    <T>Connect Microsoft 365 or Zoom</T>
                  </a>{' '}
                  <T>first.</T>
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
                    <option value="auto"><T>Auto (Teams preferred)</T></option>
                  )}
                  {connected.includes('microsoft') && (
                    <option value="microsoft"><T>Microsoft Teams</T></option>
                  )}
                  {connected.includes('zoom') && (
                    <option value="zoom"><T>Zoom</T></option>
                  )}
                </select>
              )}
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                <T>Attendees</T>{' '}
                <span className="text-muted">
                  <T>(emails, comma-separated - you&rsquo;re added
                  automatically)</T>
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
                  <a href="#connectors" className="underline font-semibold">
                    <T>Go to the connections panel</T>
                  </a>
                </>
              )}
            </p>
          )}
          {result && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-[13px] text-emerald-900 dark:text-emerald-100 space-y-1">
              <p>
                <T>Scheduled</T>
                {result.provider
                  ? ` via ${result.provider === 'microsoft' ? 'Teams' : 'Zoom'}`
                  : ''}
                {typeof result.invited === 'number'
                  ? ` - ${result.invited} invite${result.invited === 1 ? '' : 's'} sent.`
                  : '.'}
              </p>
              <p className="break-all">
                <T>Join link:</T>{' '}
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
              className="btn text-muted"
            >
              {result ? <T>Done</T> : <T>Cancel</T>}
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
    </PanelCard>
  );
}
