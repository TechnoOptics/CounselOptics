'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  generateScimTokenAction,
  listScimTokensAction,
  revokeScimTokenAction,
  type ScimTokenSummary,
} from '@/lib/scim-actions';
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

/** dd Mon yyyy, locale-agnostic enough for an admin table. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type TokenState = 'active' | 'revoked' | 'expired';
function tokenState(tok: ScimTokenSummary): TokenState {
  if (tok.revokedAt) return 'revoked';
  if (tok.expiresAt && Date.parse(tok.expiresAt) <= Date.now()) return 'expired';
  return 'active';
}

function TokenRow({
  tok,
  onRevoke,
  busy,
}: {
  tok: ScimTokenSummary;
  onRevoke: (id: string) => void;
  busy: boolean;
}) {
  const state = tokenState(tok);
  const stateLabel = state === 'active' ? 'Active' : state === 'revoked' ? 'Revoked' : 'Expired';
  const stateClass =
    state === 'active'
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-ink-500 dark:text-cream-100/50';
  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-200 py-3 first:border-t-0 dark:border-forest-700/40">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm text-forest-900 dark:text-cream-100">
          <T>{tok.label ?? 'SCIM provisioning token'}</T>
          <span className={`ml-2 text-xs font-medium ${stateClass}`}>
            · <T>{stateLabel}</T>
          </span>
        </p>
        <p className="text-xs text-ink-500 dark:text-cream-100/60">
          <T>Created</T> <span data-no-translate>{fmtDate(tok.createdAt)}</span>
          {' · '}
          <T>Last used</T> <span data-no-translate>{fmtDate(tok.lastUsedAt)}</span>
          {' · '}
          <T>Expires</T> <span data-no-translate>{fmtDate(tok.expiresAt)}</span>
        </p>
      </div>
      {state === 'active' ? (
        <button
          type="button"
          onClick={() => onRevoke(tok.id)}
          disabled={busy}
          className="shrink-0 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-950/30"
        >
          <T>Revoke</T>
        </button>
      ) : null}
    </div>
  );
}

export function ScimSettings({ baseUrl }: { baseUrl: string }) {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<ScimTokenSummary[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listScimTokensAction();
    if (res.ok && res.tokens) setTokens(res.tokens);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await generateScimTokenAction();
      if (res.ok && res.token) {
        setToken(res.token);
        await refresh();
      } else {
        setError(res.error ?? t('Could not generate a token.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      const res = await revokeScimTokenAction(id);
      if (!res.ok) setError(res.error ?? t('Could not revoke the token.'));
      await refresh();
    } finally {
      setRevokingId(null);
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
            so copy it before you leave this page. Each token expires after one
            year; revoke a token below the moment it might be exposed.
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

      {tokens && tokens.length > 0 ? (
        <div className="rounded-xl border border-ink-200 p-4 dark:border-forest-700/40">
          <p className="text-sm font-medium text-forest-900 dark:text-cream-100">
            <T>Issued tokens</T>
          </p>
          <p className="mt-1 text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
            <T>
              Every token that can provision your directory. Revoke any you no
              longer use — revoked and expired tokens stop working immediately.
            </T>
          </p>
          <div className="mt-3">
            {tokens.map((tok) => (
              <TokenRow
                key={tok.id}
                tok={tok}
                onRevoke={revoke}
                busy={revokingId === tok.id}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
