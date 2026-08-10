'use client';

import { useState, useTransition } from 'react';

import { askColleagueForTemplateAction } from '@/lib/template-requests';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Ask a named colleague to fill in a particular firm form.
 *
 * The card the reference product puts between its queue and its history. What
 * it does here is stated exactly: the colleague gets a notification with a link
 * straight to that form. It does not claim a due date, a status or a reminder,
 * because there is nothing behind any of those. See lib/template-requests.ts.
 *
 * The two selects are populated by the server component from the firm's own
 * published templates and its active workspace people, and the action verifies
 * both again against the caller's session, so choosing something from a stale
 * list is refused rather than acted on.
 */

export type TemplateOption = { id: string; name: string };
export type ColleagueOption = { userId: string; label: string };

export function AskColleagueCard({
  firmId,
  templates,
  colleagues,
}: {
  firmId: string;
  templates: TemplateOption[];
  colleagues: ColleagueOption[];
}) {
  const t = useT();
  const [templateId, setTemplateId] = useState('');
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Nothing to pick from is said plainly rather than drawn as two empty
  // selects over a button that could only ever fail.
  if (templates.length === 0 || colleagues.length === 0) {
    return (
      <p className="rounded-xl border border-edge bg-surface px-4 py-3 text-[13px] text-muted">
        {templates.length === 0 ? (
          <T>
            Publish a form under Employee forms and you can ask a colleague to fill it in
            from here.
          </T>
        ) : (
          <T>
            Nobody has signed in to this workspace yet, so there is no colleague to ask.
          </T>
        )}
      </p>
    );
  }

  const send = () => {
    setError(null);
    setSentTo(null);
    const who = colleagues.find((c) => c.userId === userId)?.label ?? null;
    startTransition(async () => {
      const res = await askColleagueForTemplateAction(firmId, templateId, userId, note);
      if (!res.ok) {
        setError(res.error ?? t('Could not send that request.'));
        return;
      }
      setSentTo(who);
      setNote('');
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-edge bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">
            <T>Which form</T>
          </span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            aria-label={t('Which form')}
            // Template names are the firm's own words.
            data-no-translate
            className="input h-9 w-full px-2 py-0"
          >
            <option value="">{t('Choose a form')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">
            <T>Which colleague</T>
          </span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            aria-label={t('Which colleague')}
            // People's names are user data.
            data-no-translate
            className="input h-9 w-full px-2 py-0"
          >
            <option value="">{t('Choose a colleague')}</option>
            {colleagues.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('Optional: who it is for, and by when you need it')}
        aria-label={t('Note for your colleague')}
        className="input w-full py-2"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !templateId || !userId}
          onClick={send}
          className="btn-primary h-9 px-3 text-[12.5px] disabled:opacity-60"
        >
          {pending ? t('Sending') : t('Ask them to fill it in')}
        </button>
        <p className="text-[12px] text-muted">
          <T>They get a notification with a link straight to this form.</T>
        </p>
      </div>

      {sentTo && (
        <p className="text-[12.5px] text-muted">
          <T>Sent to</T> <span data-no-translate>{sentTo}</span>
          {'. '}
          <T>It will land in this queue once they fill it in and send it.</T>
        </p>
      )}
      {error && <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
