'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createFirmWebhookAction,
  deleteFirmWebhookAction,
  setFirmWebhookActiveAction,
  type FirmWebhookConfig,
} from '@/lib/firm-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Outbound-webhook manager for the firm settings page.
 *
 * Three flows:
 *   - "Add webhook" form: posts to createFirmWebhookAction; on success,
 *     the new row appears at the top of the list with full metadata.
 *   - Toggle active / inactive: posts to setFirmWebhookActiveAction;
 *     updates the local row in-place so the UI feels instant. A router
 *     refresh follows so any other tab sees the change.
 *   - Delete: an inline two-step confirm (no native confirm() dialog,
 *     which the Capacitor WebView suppresses), then deleteFirmWebhookAction.
 *
 * The form-state is intentionally kept simple. Server-side validation
 * (URL scheme, vendor URL pattern, etc.) is the source of truth - this
 * client only renders the error message we get back.
 */
export function WebhookManager({
  firmId,
  initialWebhooks,
}: {
  firmId: string;
  initialWebhooks: FirmWebhookConfig[];
}) {
  const t = useT();
  const router = useRouter();
  const [webhooks, setWebhooks] = useState(initialWebhooks);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(initialWebhooks.length === 0);
  // Inline two-step delete confirm. The native confirm() dialog is
  // suppressed / inconsistently styled inside the Capacitor WebView, so
  // a Delete tap could silently no-op on a phone. This mirrors the
  // inline-confirm pattern used by the meeting DisconnectButton.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function onAdd(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createFirmWebhookAction(firmId, formData);
      if (!res.ok) {
        setError(res.error ?? t('Could not save webhook.'));
        return;
      }
      router.refresh();
      setShowAdd(false);
    });
  }

  function onToggle(id: string, active: boolean) {
    setWebhooks((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isActive: active } : w)),
    );
    startTransition(async () => {
      await setFirmWebhookActiveAction(id, active);
      router.refresh();
    });
  }

  function onDelete(id: string) {
    setConfirmingId(null);
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
    startTransition(async () => {
      await deleteFirmWebhookAction(id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {webhooks.length === 0 && !showAdd && (
        <p className="text-sm text-ink-600 dark:text-cream-100/65 italic">
          <T>No outbound webhooks yet.</T>
        </p>
      )}

      {webhooks.length > 0 && (
        <ul className="space-y-3">
          {webhooks.map((w) => (
            <li
              key={w.id}
              className="rounded-xl border border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-900/40 p-4 space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700 dark:text-gold-300">
                      {w.kind}
                    </span>
                    {w.label && (
                      <span className="text-sm font-semibold text-forest-900 dark:text-cream-100">
                        {w.label}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        w.isActive
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'bg-ink-100 text-ink-600 dark:bg-forest-800/50 dark:text-cream-100/55'
                      }`}
                    >
                      {w.isActive ? <T>Active</T> : <T>Paused</T>}
                    </span>
                  </div>
                  <p className="font-mono text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-1 break-all">
                    {w.url}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] shrink-0">
                  {confirmingId === w.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onDelete(w.id)}
                        disabled={pending}
                        className="rounded-md bg-rose-600 text-white inline-flex items-center min-h-[40px] px-3 hover:bg-rose-700 disabled:opacity-50"
                      >
                        <T>Confirm delete</T>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={pending}
                        className="rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 inline-flex items-center min-h-[40px] px-3 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
                      >
                        <T>Cancel</T>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onToggle(w.id, !w.isActive)}
                        disabled={pending}
                        className="rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 inline-flex items-center min-h-[40px] px-3 hover:bg-cream-50 dark:hover:bg-forest-800/30 disabled:opacity-50"
                      >
                        {w.isActive ? <T>Pause</T> : <T>Resume</T>}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(w.id)}
                        disabled={pending}
                        className="rounded-md ring-1 ring-rose-200 dark:ring-rose-900/40 text-rose-700 dark:text-rose-300 inline-flex items-center min-h-[40px] px-3 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
                      >
                        <T>Delete</T>
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500 dark:text-cream-100/55">
                <span>
                  <T>Body echo:</T>{' '}
                  <span className="font-semibold text-ink-700 dark:text-cream-100/85">
                    {w.includeBody ? <T>Full message</T> : <T>Metadata only</T>}
                  </span>
                </span>
                {w.channelFilter && (
                  <span>
                    <T>Scope:</T>{' '}
                    <span className="font-mono">
                      <T>channel</T> {w.channelFilter.slice(0, 8)}…
                    </span>
                  </span>
                )}
                {!w.channelFilter && (
                  <span>
                    <T>Scope:</T> <T>All channels</T>
                  </span>
                )}
                {w.lastFiredAt && (
                  <span>
                    <T>Last fired:</T>{' '}
                    {new Date(w.lastFiredAt).toLocaleString('en-US')}
                  </span>
                )}
                {w.failureCount > 0 && w.lastError && (
                  <span className="text-rose-700 dark:text-rose-300">
                    {w.failureCount} failure(s): {w.lastError}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!showAdd && (
        <button
          type="button"
          onClick={() => {
            setShowAdd(true);
            setError(null);
          }}
          className="btn-secondary text-sm"
        >
          + <T>Add webhook</T>
        </button>
      )}

      {showAdd && (
        <form
          action={onAdd}
          className="rounded-xl border border-ink-200 dark:border-forest-700/40 bg-cream-50/40 dark:bg-forest-900/40 p-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm space-y-1">
              <span className="font-semibold text-forest-900 dark:text-cream-100">
                <T>Where does it post?</T>
              </span>
              <select
                name="kind"
                required
                className="block w-full rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-2.5 py-1.5 text-sm"
              >
                <option value="slack"><T>Slack (Incoming Webhook)</T></option>
                <option value="teams">
                  <T>Microsoft Teams (Incoming Webhook)</T>
                </option>
                <option value="generic"><T>Generic JSON endpoint</T></option>
              </select>
            </label>
            <label className="text-sm space-y-1">
              <span className="font-semibold text-forest-900 dark:text-cream-100">
                <T>Label (optional)</T>
              </span>
              <input
                name="label"
                type="text"
                placeholder={t('e.g. #legal-ops Slack')}
                maxLength={60}
                className="block w-full rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-2.5 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="text-sm space-y-1 block">
            <span className="font-semibold text-forest-900 dark:text-cream-100">
              <T>Webhook URL (https://&hellip;)</T>
            </span>
            <input
              name="url"
              type="url"
              required
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              className="block w-full rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-2.5 py-1.5 text-sm font-mono"
            />
            <span className="block text-[11px] text-ink-500 dark:text-cream-100/55">
              <T>
                Slack: Apps &rarr; Incoming Webhooks &rarr; Add to Workspace.
                Teams: Channel &rarr; Connectors &rarr; Incoming Webhook.
              </T>
            </span>
          </label>
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="includeBody"
              className="h-4 w-4 rounded ring-1 ring-ink-200"
            />
            <span>
              <T>
                Include full message body (leave off for privileged-content
                channels)
              </T>
            </span>
          </label>
          {error && (
            <p className="rounded-md bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-900/40 text-rose-800 dark:text-rose-200 px-3 py-2 text-[12.5px]">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="btn-primary text-sm"
            >
              {pending ? <T>Saving…</T> : <T>Save webhook</T>}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="btn-ghost text-sm"
            >
              <T>Cancel</T>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
