'use client';

import { useState, useTransition } from 'react';
import { savePartnerConfigAction } from '@/lib/partner-config';
import type {
  PartnerIntegrationConfig,
  PartnerQuestion,
} from '@/lib/partner-config-core';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Counsel → Settings → "Partner app integration".
 *
 * The legal team controls what the company's companion app (e.g. the
 * Zinpro employee app) sees and does:
 *   - the acknowledgment message shown to an employee right after they
 *     file a request (usually the team's response-time promise),
 *   - the intake questions the partner form asks,
 *   - the outbound webhook (URL + rotatable signing secret),
 *   - the stale-ticket reminder window.
 *
 * Everything saves through one action; server-side validation is the
 * source of truth and this client just renders errors it gets back.
 */
export function PartnerIntegrationManager({
  firmId,
  initial,
}: {
  firmId: string;
  initial: PartnerIntegrationConfig;
}) {
  const [config, setConfig] = useState(initial);
  const [ackMessage, setAckMessage] = useState(initial.ackMessage);
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl);
  const [remindAfterHours, setRemindAfterHours] = useState(initial.remindAfterHours);
  const [questions, setQuestions] = useState<PartnerQuestion[]>(initial.questions);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  function save(rotateSecret = false) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await savePartnerConfigAction(firmId, {
        ackMessage,
        questions,
        webhookUrl,
        remindAfterHours,
        rotateSecret,
      });
      if (!res.ok || !res.config) {
        setError(res.error ?? 'Could not save.');
        return;
      }
      setConfig(res.config);
      setAckMessage(res.config.ackMessage);
      setSaved(true);
    });
  }

  function updateQuestion(i: number, patch: Partial<PartnerQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  const inputCls =
    'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';
  const labelCls =
    'text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-cream-100/40';

  return (
    <div className="space-y-6">
      {/* Acknowledgment message */}
      <div className="space-y-1.5">
        <p className={labelCls}>
          <T>Confirmation message after filing</T>
        </p>
        <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <T>
            Shown to the employee in the partner app the moment their request is
            filed. Most teams state their usual response time here.
          </T>
        </p>
        <textarea
          rows={3}
          value={ackMessage}
          onChange={(e) => setAckMessage(e.target.value)}
          maxLength={500}
          className={inputCls}
        />
      </div>

      {/* Intake questions */}
      <div className="space-y-2">
        <p className={labelCls}>
          <T>Intake questions</T>
        </p>
        <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <T>
            Asked on the partner app&apos;s &ldquo;New legal request&rdquo; form, in this
            order. Answers appear on the request in your Intake inbox.
          </T>
        </p>
        {questions.map((q, i) => (
          <div
            key={q.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 p-2.5 dark:border-forest-700/40"
          >
            <input
              value={q.label}
              onChange={(e) => updateQuestion(i, { label: e.target.value })}
              placeholder="Question, e.g. Which business unit is this for?"
              className={`${inputCls} min-w-[220px] flex-1`}
            />
            <select
              value={q.type}
              onChange={(e) =>
                updateQuestion(i, { type: e.target.value as PartnerQuestion['type'] })
              }
              className={`${inputCls} w-auto`}
            >
              <option value="text">Free text</option>
              <option value="select">Choice list</option>
              <option value="yesno">Yes / No</option>
            </select>
            {q.type === 'select' && (
              <input
                value={(q.options ?? []).join(', ')}
                onChange={(e) =>
                  updateQuestion(i, {
                    options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="Options, comma-separated"
                className={`${inputCls} min-w-[180px] flex-1`}
              />
            )}
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600 dark:text-cream-100/70">
              <input
                type="checkbox"
                checked={q.required === true}
                onChange={(e) => updateQuestion(i, { required: e.target.checked })}
              />
              <T>Required</T>
            </label>
            <button
              type="button"
              onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
              className="text-[12.5px] text-rose-600 underline dark:text-rose-300"
            >
              <T>Remove</T>
            </button>
          </div>
        ))}
        {questions.length < 12 && (
          <button
            type="button"
            onClick={() =>
              setQuestions((qs) => [
                ...qs,
                { id: crypto.randomUUID(), label: '', type: 'text', required: false },
              ])
            }
            className="text-[13px] text-gold-700 underline dark:text-gold-300"
          >
            <T>+ Add a question</T>
          </button>
        )}
      </div>

      {/* Webhook */}
      <div className="space-y-1.5">
        <p className={labelCls}>
          <T>Event webhook (partner backend)</T>
        </p>
        <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <T>
            We POST signed events (legal replies, status changes) to this https
            URL so the partner app can update instantly instead of polling.
          </T>
        </p>
        <input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://partner.example.com/advottic/events"
          className={inputCls}
        />
        {config.webhookSecret && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-600 dark:text-cream-100/70">
            <span className={labelCls}>
              <T>Signing secret</T>
            </span>
            <code className="rounded bg-ink-100 px-2 py-0.5 font-mono text-[12px] dark:bg-forest-900/70">
              {showSecret ? config.webhookSecret : '••••••••••••••••••••'}
            </code>
            <button
              type="button"
              onClick={() => setShowSecret((s) => !s)}
              className="underline"
            >
              {showSecret ? <T>Hide</T> : <T>Reveal</T>}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save(true)}
              className="underline"
            >
              <T>Rotate</T>
            </button>
          </div>
        )}
      </div>

      {/* Reminder window */}
      <div className="space-y-1.5">
        <p className={labelCls}>
          <T>Remind the team about unanswered requests after</T>
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={720}
            value={remindAfterHours}
            onChange={(e) => setRemindAfterHours(Number(e.target.value) || 0)}
            className={`${inputCls} w-24`}
          />
          <span className="text-[13px] text-ink-600 dark:text-cream-100/70">
            <T>hours (0 turns reminders off)</T>
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => save(false)}
          className="btn-primary disabled:opacity-50"
        >
          {pending ? <T>Saving…</T> : <T>Save partner settings</T>}
        </button>
        {saved && !pending && (
          <span className="text-[13px] text-forest-700 dark:text-emerald-300">
            <T>Saved.</T>
          </span>
        )}
      </div>
    </div>
  );
}
