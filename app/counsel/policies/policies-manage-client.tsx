'use client';

import { useState } from 'react';
import {
  saveFirmPolicyAction,
  deleteFirmPolicyAction,
  type FirmPolicy,
} from '@/lib/firm-policies';
import { EmptyState } from '@/components/counsel/ui';
import { MonoRef, relativeTime, shortRef } from '@/components/counsel/patterns';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { formatNumber } from '@/lib/format';

/**
 * The policy library, as the configuration-list pattern in
 * docs/TECHOTTIC-PARITY-SPEC.md section 3: one card per policy rather
 * than one row, carrying what somebody has to know before opening it.
 *
 * Three parts of that pattern are absent, each because `firm_policies`
 * has four columns and does not have the thing behind them. There is no
 * scope chip and no scope strip, because a policy has no category to
 * scope it by, so a strip would have been one option that filtered
 * nothing. There is no DEFAULT badge and no status pill, because a
 * policy has no default flag and no published state: everything in the
 * library is live for the employee checker the moment it is saved. And
 * there are no type chips, because a policy is one block of text rather
 * than a set of fields.
 *
 * What is left is real: the two numbers on each card are counted from
 * that policy's own text, and the date is its own `createdAt`.
 */
export function PoliciesManageClient({
  firmId,
  initialPolicies,
}: {
  firmId: string;
  initialPolicies: FirmPolicy[];
}) {
  const t = useT();
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
      setError(res.error ?? t('Could not save.'));
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
    else setError(res.error ?? t('Could not delete.'));
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="card p-3 text-[13px] text-danger-text">{error}</p>
      )}

      {editing ? (
        <div className="card space-y-3 p-5">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">
              <T>Policy name</T>
            </span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Gifts and entertainment policy')}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-foreground">
              <T>Policy text (paste the full policy)</T>
            </span>
            <textarea
              rows={16}
              className="input font-mono text-[12.5px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !name.trim() || !content.trim()}
              onClick={() => void save()}
              className="btn-primary disabled:opacity-50"
            >
              {busy ? t('Saving') : t('Save policy')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="btn-ghost text-sm"
            >
              <T>Cancel</T>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* The count lives here rather than in the page subtitle
              because adding or deleting a policy updates this list
              without a reload, and a server-rendered count would sit
              there being wrong. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => openEditor('new')}
              className="btn-primary"
            >
              <T>Add policy</T>
            </button>
            <p className="text-[12px] tabular-nums text-muted">
              {policies.length}{' '}
              {policies.length === 1 ? <T>policy</T> : <T>policies</T>}{' '}
              <T>in the library</T>
            </p>
          </div>
          {policies.length === 0 ? (
            <EmptyState
              title={<T>No policies yet.</T>}
              sub={
                <T>
                  Until you add some, the employee checker tells people to file
                  a request.
                </T>
              }
            />
          ) : (
            <ul className="grid gap-3">
              {policies.map((p) => {
                const words = p.content.trim()
                  ? p.content.trim().split(/\s+/).length
                  : 0;
                return (
                  <li key={p.id} className="card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p
                        className="min-w-0 text-[14px] font-semibold text-foreground"
                        data-no-translate
                      >
                        {p.name}
                      </p>
                      <MonoRef title={`${t('Policy id')} ${p.id}`}>
                        {shortRef(p.id)}
                      </MonoRef>
                    </div>
                    {/* One measure of length, not two. Words and characters
                        answer the same question, and a reader comparing two
                        policies at a glance was being handed the same fact
                        twice in different units. */}
                    <p className="mt-2 text-[12px] text-muted">
                      {formatNumber(words)} <T>words</T>
                      {' · '}
                      <T>added</T> {relativeTime(p.createdAt) ?? ''}
                    </p>
                    <div className="mt-3 flex items-center gap-4 border-t border-edge pt-3">
                      <button
                        type="button"
                        onClick={() => openEditor(p)}
                        className="text-[13px] font-medium text-accent-text hover:underline"
                      >
                        <T>Edit</T>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(p.id)}
                        className="text-[13px] text-muted hover:text-danger-text"
                      >
                        <T>Delete</T>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
