'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmTokenAction, createTokenAction } from './actions';
// Reached from the counsel route through TokensPanel. A pure passthrough
// outside a LocaleProvider, so the consumer route is unchanged.
import { T, useT } from '@/components/i18n/LocaleProvider';

export function NewTokenForm({
  adminFirms = [],
}: {
  adminFirms?: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'personal' | 'firm'>('personal');
  const [firmId, setFirmId] = useState(adminFirms[0]?.id ?? '');
  const [created, setCreated] = useState<{ token: string; prefix: string } | null>(
    null,
  );

  function submit(formData: FormData) {
    setError(null);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError(t('Name is required.'));
      return;
    }
    if (kind === 'firm' && !firmId) {
      setError(t('Pick the firm this integration token belongs to.'));
      return;
    }
    startTransition(async () => {
      const res =
        kind === 'firm'
          ? await createFirmTokenAction(name, firmId)
          : await createTokenAction(name);
      if (res.ok && res.token) {
        setCreated({ token: res.token, prefix: res.prefix ?? '' });
        router.refresh();
      } else {
        setError(res.error ?? t('Could not create token.'));
      }
    });
  }

  if (created) {
    return (
      <div className="card p-5 ring-1 ring-amber-300/50 dark:ring-amber-700/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-3">
        <p className="eyebrow text-amber-800 dark:text-amber-200">
          <T>Token created - save it now</T>
        </p>
        <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
          <T>
            This is the only time we&rsquo;ll show the full token. After you
            leave this page, only the prefix is visible.
          </T>
        </p>
        <pre className="text-[12px] font-mono p-3 rounded-md bg-white dark:bg-forest-950 ring-1 ring-amber-200 dark:ring-amber-700/40 break-all whitespace-pre-wrap select-all">
{created.token}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(created.token)}
            className="btn-secondary text-sm"
          >
            <T>Copy</T>
          </button>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="btn-ghost text-sm"
          >
            <T>Done</T>
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="card p-5 space-y-3">
      <p className="eyebrow">
        <T>Issue a new token</T>
      </p>
      {adminFirms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setKind('personal')}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition-colors ${
              kind === 'personal'
                ? 'bg-gold-500/20 ring-gold-500/40 text-gold-700 dark:text-gold-200'
                : 'ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/85'
            }`}
          >
            <T>Personal (read-only)</T>
          </button>
          <button
            type="button"
            onClick={() => setKind('firm')}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ring-1 transition-colors ${
              kind === 'firm'
                ? 'bg-gold-500/20 ring-gold-500/40 text-gold-700 dark:text-gold-200'
                : 'ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/85'
            }`}
          >
            <T>Firm integration (read + write)</T>
          </button>
        </div>
      )}
      {kind === 'firm' && (
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            <T>Firm</T>
          </span>
          <select
            value={firmId}
            onChange={(e) => setFirmId(e.target.value)}
            className="input"
          >
            {adminFirms.map((f) => (
              <option key={f.id} value={f.id} data-no-translate>
                {f.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11.5px] text-ink-500 dark:text-cream-100/55">
            <T>
              For partner apps (e.g. the Zinpro One integration). The token is
              bound to this firm and carries the write scope the partner API
              requires.
            </T>
          </span>
        </label>
      )}
      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          <T>Name</T>
        </span>
        <input
          name="name"
          required
          placeholder={
            kind === 'firm'
              ? 'Zinpro One integration'
              : t('Browser extension on my laptop')
          }
          className="input"
        />
      </label>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          {kind === 'firm' ? (
            <>
              <T>Scopes:</T>{' '}
              <code className="font-mono" data-no-translate>
                read, write
              </code>
              <T>
                , firm-bound. Hand it to the partner over a password-manager
                share, never email or chat.
              </T>
            </>
          ) : (
            <>
              <T>Default scope is</T>{' '}
              <code className="font-mono" data-no-translate>
                read
              </code>
              <T>
                . Tokens never expire automatically; revoke them from the list
                below when you&rsquo;re done.
              </T>
            </>
          )}
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? <T>Creating...</T> : <T>Create token</T>}
        </button>
      </div>
    </form>
  );
}
