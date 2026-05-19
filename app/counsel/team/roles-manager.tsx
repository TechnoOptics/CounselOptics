'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  savePortalRoleAction,
  deletePortalRoleAction,
  enterPortalPreviewAction,
} from '@/lib/firm-actions';
import {
  PORTAL_FEATURES,
  ROLE_PRESETS,
  type PortalRole,
  type PortalFeature,
} from '@/lib/portal-features';

/**
 * Owner/admin: define portal roles/groups (named feature bundles),
 * assign them to employees (in EmployeesPanel), and preview the
 * portal as any role without a second login. More features in a role
 * = more of the portal unlocked for everyone in it.
 */
export function RolesManager({
  firmId,
  initial,
}: {
  firmId: string;
  initial: PortalRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [features, setFeatures] = useState<Set<PortalFeature>>(new Set());

  function reset() {
    setEditKey(null);
    setName('');
    setFeatures(new Set());
    setError(null);
  }

  function loadPreset(p: PortalRole) {
    setEditKey(null);
    setName(p.name);
    setFeatures(new Set(p.features));
  }

  function loadForEdit(r: PortalRole) {
    setEditKey(r.key);
    setName(r.name);
    setFeatures(new Set(r.features));
    setError(null);
  }

  function toggle(f: PortalFeature) {
    setFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function save() {
    if (!name.trim()) {
      setError('Give the role a name.');
      return;
    }
    const fd = new FormData();
    fd.set('name', name.trim());
    if (editKey) fd.set('key', editKey);
    features.forEach((f) => fd.append('feature', f));
    setError(null);
    startTransition(async () => {
      const res = await savePortalRoleAction(firmId, fd);
      if (res.ok) {
        reset();
        router.refresh();
      } else {
        setError(res.error ?? 'Could not save the role.');
      }
    });
  }

  function remove(key: string) {
    startTransition(async () => {
      await deletePortalRoleAction(firmId, key);
      if (editKey === key) reset();
      router.refresh();
    });
  }

  function preview(roleKey: string) {
    startTransition(async () => {
      // Server action redirects into /portal.
      await enterPortalPreviewAction(firmId, roleKey);
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-5">
      <div>
        <p className="eyebrow">Roles &amp; access</p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 max-w-2xl leading-relaxed">
          Build groups of employees and choose what each group can do
          in the portal. Assign a role to a person below; more features
          in their role unlock more of the portal for them.
        </p>
      </div>

      {/* Existing roles */}
      {initial.length > 0 && (
        <ul className="space-y-2">
          {initial.map((r) => (
            <li
              key={r.key}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-forest-900 dark:text-cream-100">
                  {r.name}
                </p>
                <div className="flex items-center gap-3 text-[12px]">
                  <button
                    type="button"
                    onClick={() => preview(r.key)}
                    disabled={pending}
                    className="underline text-gold-700 dark:text-gold-200 hover:opacity-80"
                  >
                    Preview as this
                  </button>
                  <button
                    type="button"
                    onClick={() => loadForEdit(r)}
                    disabled={pending}
                    className="underline text-ink-700 dark:text-cream-100/85"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    disabled={pending}
                    className="underline text-rose-600 dark:text-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.features.length === 0 ? (
                  <span className="text-[11px] italic text-ink-500 dark:text-cream-100/55">
                    View own requests only
                  </span>
                ) : (
                  r.features.map((f) => (
                    <span
                      key={f}
                      className="inline-flex items-center rounded-full bg-gold-500/15 ring-1 ring-gold-500/25 px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-700 dark:text-gold-200"
                    >
                      {PORTAL_FEATURES.find((x) => x.key === f)?.label ?? f}
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Builder */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-forest-900 dark:text-cream-100">
            {editKey ? 'Edit role' : 'New role'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => loadPreset(p)}
                disabled={pending}
                className="text-[11px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-1 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/50"
              >
                + {p.name}
              </button>
            ))}
          </div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Role / group name (e.g. Procurement, Engineering leads)"
          className="input"
          disabled={pending}
        />
        <div className="grid sm:grid-cols-2 gap-2">
          {PORTAL_FEATURES.map((f) => {
            const on = f.base || features.has(f.key);
            return (
              <label
                key={f.key}
                className={`flex items-start gap-2.5 rounded-md ring-1 p-2.5 ${
                  f.base
                    ? 'ring-ink-100 dark:ring-forest-700/30 opacity-70'
                    : 'ring-ink-200 dark:ring-forest-700/40 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={pending || f.base}
                  onChange={() => toggle(f.key)}
                  className="mt-0.5 h-4 w-4 flex-none accent-gold-500"
                />
                <span>
                  <span className="block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                    {f.label}
                    {f.base && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-400 dark:text-cream-100/40">
                        always on
                      </span>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/55">
                    {f.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => preview('')}
            disabled={pending}
            className="text-[12px] underline text-ink-600 dark:text-cream-100/70"
          >
            Preview default access
          </button>
          <div className="flex gap-2">
            {editKey && (
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="btn text-ink-600 dark:text-cream-100/70"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending || !name.trim()}
              className="btn-primary"
            >
              {pending
                ? 'Saving...'
                : editKey
                  ? 'Save role'
                  : 'Create role'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
