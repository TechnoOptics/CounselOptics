'use client';

import { useState } from 'react';
import {
  saveFirmPolicyAction,
  deleteFirmPolicyAction,
  type FirmPolicy,
} from '@/lib/firm-policies';

/** Paste-and-save policy library management for the legal team. */
export function PoliciesManageClient({
  firmId,
  initialPolicies,
}: {
  firmId: string;
  initialPolicies: FirmPolicy[];
}) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [editing, setEditing] = useState<FirmPolicy | 'new' | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEditor = (p: FirmPolicy | 'new') => {
    setEditing(p);
    setName(p === 'new' ? '' : p.name);
    setContent(p === 'new' ? '' : p.content);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await saveFirmPolicyAction(firmId, {
      id: editing !== 'new' && editing ? editing.id : undefined,
      name,
      content,
    });
    setBusy(false);
    if (!res.ok || !res.policy) {
      setError(res.error ?? 'Could not save.');
      return;
    }
    const p = res.policy;
    setPolicies((list) => {
      const i = list.findIndex((x) => x.id === p.id);
      if (i === -1) return [...list, p].sort((a, b) => a.name.localeCompare(b.name));
      const next = [...list];
      next[i] = p;
      return next;
    });
    setEditing(null);
  };

  const remove = async (id: string) => {
    setBusy(true);
    const res = await deleteFirmPolicyAction(firmId, id);
    setBusy(false);
    if (res.ok) setPolicies((list) => list.filter((p) => p.id !== id));
    else setError(res.error ?? 'Could not delete.');
  };

  const inputCls =
    'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {editing ? (
        <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-5 dark:border-forest-700/50 dark:bg-forest-900/40">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Policy name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gifts & entertainment policy" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
              Policy text (paste the full policy)
            </span>
            <textarea rows={16} className={`${inputCls} font-mono text-[12.5px]`} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !name.trim() || !content.trim()} onClick={() => void save()} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : 'Save policy'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-[14px] text-ink-500 hover:bg-cream-50 dark:text-cream-100/55 dark:hover:bg-forest-800/50">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => openEditor('new')} className="btn-primary">
            + Add policy
          </button>
          {policies.length === 0 ? (
            <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
              No policies yet. Until you add some, the employee checker tells people to file a request.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 dark:divide-forest-800/50 dark:border-forest-700/50">
              {policies.map((p) => (
                <li key={p.id} className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-forest-900/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-forest-900 dark:text-cream-100">{p.name}</p>
                    <p className="truncate text-[12px] text-ink-500 dark:text-cream-100/55">
                      {Math.round(p.content.length / 1000)}k characters
                    </p>
                  </div>
                  <button type="button" onClick={() => openEditor(p)} className="text-[13px] font-medium text-gold-700 hover:underline dark:text-gold-300">
                    Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => void remove(p.id)} className="text-[13px] text-ink-400 hover:text-rose-600 dark:text-cream-100/40">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
