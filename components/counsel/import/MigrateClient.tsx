'use client';

import { useState, useTransition } from 'react';
import {
  importMigrationBundleAction,
  type MigrationResult,
} from '@/lib/migration-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

/**
 * "Migrate from another platform" panel. Two ways in:
 *  - Universal JSON bundle (records + attachments + history + notes): the
 *    richest path; other tools export to it or we map their export to it.
 *  - ServiceNow connector: pulls records + attachments live via the API.
 * Both call the same firm-scoped ingest, which preserves original dates.
 */
export function MigrateClient() {
  const t = useT();
  const [mode, setMode] = useState<'json' | 'servicenow'>('json');
  const [json, setJson] = useState('');
  const [sn, setSn] = useState({
    instanceUrl: '',
    token: '',
    table: 'incident',
    query: '',
  });
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [pending, start] = useTransition();

  function runJson() {
    setResult(null);
    start(async () => {
      setResult(await runGatedAction(() => importMigrationBundleAction({ kind: 'json', text: json })));
    });
  }

  function runServiceNow() {
    setResult(null);
    start(async () => {
      setResult(
        await runGatedAction(() => importMigrationBundleAction({
          kind: 'servicenow',
          instanceUrl: sn.instanceUrl.trim(),
          token: sn.token.trim(),
          table: sn.table.trim() || undefined,
          query: sn.query.trim() || undefined,
        })),
      );
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setJson(await f.text());
  }

  const inputClass =
    'w-full rounded-lg border border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900 px-3 py-2 text-sm text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-400/60';

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(['json', 'servicenow'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              mode === m
                ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950'
                : 'bg-ink-100 text-ink-600 dark:bg-forest-800/60 dark:text-cream-100/70'
            }`}
          >
            {m === 'json' ? <T>Universal bundle (JSON)</T> : <T>ServiceNow</T>}
          </button>
        ))}
      </div>

      {mode === 'json' ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            <T>
              Import a universal bundle: matters with their attachments, notes,
              and history. Original dates are preserved, so the workspace looks
              exactly as established as it was on your old platform.
            </T>
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={onFile}
            aria-label={t('Choose a JSON bundle file')}
            className="block text-sm text-ink-600 dark:text-cream-100/70"
          />
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={10}
            placeholder='{ "source": "Clio", "cases": [ { "title": "...", "openedAt": "2024-03-01", "attachments": [...], "history": [...] } ] }'
            aria-label={t('Migration bundle JSON')}
            className={`${inputClass} font-mono text-[12px]`}
          />
          <button
            type="button"
            onClick={runJson}
            disabled={pending || !json.trim()}
            className="btn-primary disabled:opacity-60"
          >
            {pending ? <T>Importing…</T> : <T>Import bundle</T>}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            <T>
              Connect ServiceNow to pull records and their attachments directly.
              Use a service account token scoped to read the table and its
              attachments.
            </T>
          </p>
          <input
            value={sn.instanceUrl}
            onChange={(e) => setSn({ ...sn, instanceUrl: e.target.value })}
            placeholder="https://your-instance.service-now.com"
            aria-label={t('ServiceNow instance URL')}
            className={inputClass}
          />
          <input
            value={sn.token}
            onChange={(e) => setSn({ ...sn, token: e.target.value })}
            placeholder="API token (or 'Basic …')"
            aria-label={t('ServiceNow API token')}
            type="password"
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={sn.table}
              onChange={(e) => setSn({ ...sn, table: e.target.value })}
              placeholder="Table (e.g. incident)"
              aria-label={t('ServiceNow table')}
              className={inputClass}
            />
            <input
              value={sn.query}
              onChange={(e) => setSn({ ...sn, query: e.target.value })}
              placeholder="Optional filter (sysparm_query)"
              aria-label={t('ServiceNow query filter')}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={runServiceNow}
            disabled={pending || !sn.instanceUrl.trim() || !sn.token.trim()}
            className="btn-primary disabled:opacity-60"
          >
            {pending ? <T>Importing…</T> : <T>Pull from ServiceNow</T>}
          </button>
        </div>
      )}

      {result && (
        <div
          className={`rounded-lg border p-4 text-sm ${
            result.ok
              ? 'border-emerald-300/70 bg-emerald-50/60 text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-200'
              : 'border-rose-300/70 bg-rose-50/60 text-rose-900 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-200'
          }`}
        >
          {result.ok ? (
            <>
              <p className="font-medium">
                <T>Imported</T> {result.casesCreated}{' '}
                <T>{result.casesCreated === 1 ? 'matter' : 'matters'}</T>{' '}
                <T>and</T> {result.attachmentsCreated}{' '}
                <T>
                  {result.attachmentsCreated === 1
                    ? 'attachment'
                    : 'attachments'}
                </T>{' '}
                <T>from</T> {result.source}.
              </p>
              {!!result.failures?.length && (
                <ul className="mt-2 list-disc pl-5 text-[13px]">
                  {result.failures.slice(0, 10).map((f, i) => (
                    <li key={i}>
                      {f.case}: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>{result.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
