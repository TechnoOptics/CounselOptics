'use client';

import { useState } from 'react';
import { generateScimTokenAction } from '@/lib/scim-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-ink-600 dark:text-cream-100/70"><T>{label}</T></p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 truncate rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-forest-900 dark:border-forest-700/40 dark:bg-forest-900/40 dark:text-cream-100">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => undefined,
            );
          }}
          className="shrink-0 rounded-lg border border-ink-200 px-3 py-2 text-xs font-medium text-forest-900 transition hover:bg-ink-50 dark:border-forest-700/40 dark:text-cream-100 dark:hover:bg-forest-900/40"
        >
          {copied ? <T>Copied</T> : <T>Copy</T>}
        </button>
      </div>
    </div>
  );
}

export function ScimSettings({ baseUrl }: { baseUrl: string }) {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await generateScimTokenAction();
      if (res.ok && res.token) setToken(res.token);
      else setError(res.error ?? t('Could not generate a token.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <CopyField label="SCIM base URL (Tenant URL)" value={baseUrl} />
        <p className="text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
          <T>Paste this as the</T> <em><T>Tenant URL</T></em>{' '}
          <T>
            in your identity provider (Microsoft Entra ID, Okta, and any SCIM
            2.0 directory). It provisions and deprovisions people in your firm
            directory automatically as you add or remove them in your IdP.
          </T>
        </p>
      </div>

      <div className="rounded-xl border border-ink-200 p-4 dark:border-forest-700/40">
        <p className="text-sm font-medium text-forest-900 dark:text-cream-100">
          <T>Secret token</T>
        </p>
        <p className="mt-1 text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
          <T>Generate a token, then paste it into your IdP&rsquo;s</T>{' '}
          <em><T>Secret Token</T></em>{' '}
          <T>
            field. For your security we show it only once and store only a hash,
            so copy it before you leave this page. Generating a new token lets
            you rotate; the previous token keeps working until you remove it.
          </T>
        </p>

        {token ? (
          <div className="mt-3 space-y-2">
            <CopyField label="Your new token (copy it now)" value={token} />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <T>This token will not be shown again.</T>
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="mt-4 rounded-lg bg-forest-900 px-4 py-2 text-sm font-medium text-cream-50 transition hover:bg-forest-800 disabled:opacity-60 dark:bg-cream-100 dark:text-forest-900 dark:hover:bg-cream-200"
        >
          {busy ? (
            <T>Generating...</T>
          ) : token ? (
            <T>Generate another token</T>
          ) : (
            <T>Generate token</T>
          )}
        </button>
      </div>
    </div>
  );
}
