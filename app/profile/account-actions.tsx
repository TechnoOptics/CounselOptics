'use client';

import { useState } from 'react';
// Shared with the counsel account page. A pure passthrough outside a
// LocaleProvider, so the consumer profile is unchanged.
import { T, useT } from '@/components/i18n/LocaleProvider';

export function AccountActions() {
  const t = useT();
  const [confirm, setConfirm] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    window.location.assign('/api/account/export');
  }

  async function deleteAccount() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirm.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('Could not delete account.'));
      // Sign out and bounce home
      await fetch('/auth/sign-out', { method: 'POST' });
      window.location.assign('/?account=deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not delete account.'));
      setDeleting(false);
    }
  }

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-forest-900">
          <T>Your data</T>
        </h2>
        <p className="text-sm text-ink-600 mt-1 leading-relaxed">
          <T>
            Download a JSON export of every record we hold for you, or delete
            your account entirely. These are your rights under GDPR / CCPA.
          </T>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportData} className="btn-secondary">
          <T>Download my data (JSON)</T>
        </button>
        <button
          type="button"
          onClick={() => setShowDelete((s) => !s)}
          className="btn-ghost text-rose-700 hover:text-rose-900 hover:bg-rose-50"
        >
          {showDelete ? <T>Cancel</T> : <T>Delete my account</T>}
        </button>
      </div>

      {/* Dark variants on the panel below matter beyond consumer dark mode:
          this card also renders on the firm account page, which is always
          dark, and a destructive confirmation must not be the one light-red
          box on a black screen. */}
      {showDelete && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 dark:border-rose-700/40 dark:bg-rose-950/20 p-4 space-y-3">
          <p className="text-sm text-rose-900 dark:text-rose-200 leading-relaxed">
            <strong>
              <T>This is permanent.</T>
            </strong>{' '}
            <T>
              All your cases, exhibits, Advottic Reviews, profile, and uploaded
              files will be deleted. Stripe billing history is retained as
              required by law.
            </T>
          </p>
          <p className="text-sm text-rose-900 dark:text-rose-200">
            {/* The phrase inside the <code> is what the reader has to type
                back, character for character, so it must stay in English
                whatever the interface language is. */}
            <T>Type</T>{' '}
            <code className="font-mono text-xs" data-no-translate>
              DELETE MY ACCOUNT
            </code>{' '}
            <T>to confirm:</T>
          </p>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE MY ACCOUNT"
            className="input"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDelete(false);
                setConfirm('');
                setError(null);
              }}
              className="btn-ghost"
              disabled={deleting}
            >
              <T>Cancel</T>
            </button>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting || confirm.trim().toUpperCase() !== 'DELETE MY ACCOUNT'}
              className="btn bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm"
            >
              {deleting ? (
                <T>Deleting&hellip;</T>
              ) : (
                <T>Delete account permanently</T>
              )}
            </button>
          </div>
          {error && (
            <p className="rounded-md border border-rose-300 bg-rose-100 dark:border-rose-700/50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-200">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
