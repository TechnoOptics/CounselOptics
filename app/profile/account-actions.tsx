'use client';

import { useState } from 'react';

export function AccountActions() {
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
      if (!res.ok) throw new Error(data.error || 'Could not delete account.');
      // Sign out and bounce home
      await fetch('/auth/sign-out', { method: 'POST' });
      window.location.assign('/?account=deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete account.');
      setDeleting(false);
    }
  }

  return (
    <div className="card p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-forest-900">Your data</h2>
        <p className="text-sm text-ink-600 mt-1 leading-relaxed">
          Download a JSON export of every record we hold for you, or delete your account
          entirely. These are your rights under GDPR / CCPA.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportData} className="btn-secondary">
          Download my data (JSON)
        </button>
        <button
          type="button"
          onClick={() => setShowDelete((s) => !s)}
          className="btn-ghost text-rose-700 hover:text-rose-900 hover:bg-rose-50"
        >
          {showDelete ? 'Cancel' : 'Delete my account'}
        </button>
      </div>

      {showDelete && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 space-y-3">
          <p className="text-sm text-rose-900 leading-relaxed">
            <strong>This is permanent.</strong> All your cases, exhibits, AI reviews, exhibit
            plans, defense advice, profile, and uploaded files will be deleted. Stripe billing
            history is retained as required by law.
          </p>
          <p className="text-sm text-rose-900">
            Type <code className="font-mono text-xs">DELETE MY ACCOUNT</code> to confirm:
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
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleting || confirm.trim().toUpperCase() !== 'DELETE MY ACCOUNT'}
              className="btn bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-sm"
            >
              {deleting ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </div>
          {error && (
            <p className="rounded-md border border-rose-300 bg-rose-100 px-3 py-2 text-xs text-rose-900">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
