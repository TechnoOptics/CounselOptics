'use client';

import { useState } from 'react';
import {
  saveFirmPolicyAction,
  deleteFirmPolicyAction,
  type FirmPolicy,
} from '@/lib/firm-policies';
import { EmptyState } from '@/components/counsel/ui';

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
    'w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[14px] text-foreground outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25';

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {editing ? (
        <div className="space-y-3 rounded-xl border border-edge bg-surface p-5">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">Policy name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gifts & entertainment policy" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">
              Policy text (paste the full policy)
            </span>
            <textarea rows={16} className={`${inputCls} font-mono text-[12.5px]`} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !name.trim() || !content.trim()} onClick={() => void save()} className="btn-primary disabled:opacity-50">
              {busy ? 'Saving…' : 'Save policy'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-ghost text-sm">
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
            <EmptyState
              title="No policies yet"
              sub="Until you add some, the employee checker tells people to file a request."
            />
          ) : (
            <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge">
              {policies.map((p) => (
                <li key={p.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-foreground">{p.name}</p>
                    <p className="truncate text-[12px] text-muted">
                      {Math.round(p.content.length / 1000)}k characters
                    </p>
                  </div>
                  <button type="button" onClick={() => openEditor(p)} className="text-[13px] font-medium text-gold-700 hover:underline dark:text-gold-300">
                    Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => void remove(p.id)} className="text-[13px] text-muted hover:text-rose-600">
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
