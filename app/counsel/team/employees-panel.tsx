'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addFirmEmployeeAction,
  setFirmEmployeeActiveAction,
  setFirmEmployeeRoleAction,
  type FirmEmployeeListItem,
} from '@/lib/firm-actions';
import type { PortalRole } from '@/lib/portal-features';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { runGatedAction } from '@/lib/gated-action';

/**
 * Owner/admin panel: the non-legal employees who get the scoped
 * /portal surface (not the full Counsel app). Tier 2 - manual add.
 * Tier 3 replaces this with Entra/Google directory sync (see
 * docs/ENTERPRISE_WORKSPACE.md); the table below stays the same.
 */
export function EmployeesPanel({
  firmId,
  initial,
  roles,
}: {
  firmId: string;
  initial: FirmEmployeeListItem[];
  roles: PortalRole[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function add(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await runGatedAction(() => addFirmEmployeeAction(firmId, formData));
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not add employee.'));
      }
    });
  }

  function toggle(id: string, active: boolean) {
    startTransition(async () => {
      await setFirmEmployeeActiveAction(firmId, id, active);
      router.refresh();
    });
  }

  function assignRole(id: string, roleKey: string) {
    startTransition(async () => {
      await setFirmEmployeeRoleAction(firmId, id, roleKey);
      router.refresh();
    });
  }

  return (
    <section className="card p-5 sm:p-6 space-y-4">
      <div>
        <p className="eyebrow"><T>Employees</T></p>
        <p className="text-[12px] text-muted mt-1 max-w-2xl leading-relaxed">
          <T>People here get the employee portal only - file requests to
          legal, track their own, run Advottic Review. They never see
          cases, clients, or the rest of Counsel.</T>
        </p>
      </div>

      <form action={add} className="grid sm:grid-cols-4 gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder={t('employee@company.com')}
          className="input sm:col-span-2"
          disabled={pending}
        />
        <input
          name="displayName"
          placeholder={t('Name (optional)')}
          className="input"
          disabled={pending}
        />
        <input
          name="department"
          placeholder={t('Dept (optional)')}
          className="input"
          disabled={pending}
        />
        <div className="sm:col-span-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted">
            <T>They get portal access the next time they sign in with this
            email.</T>
          </p>
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? t('Saving...') : t('Add employee')}
          </button>
        </div>
        {error && (
          <p className="sm:col-span-4 rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}
        {ok && (
          <p className="sm:col-span-4 rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            <T>Saved.</T>
          </p>
        )}
      </form>

      {initial.length > 0 && (
        <ul className="divide-y divide-edge">
          {initial.map((e) => {
            const inactive = e.deactivatedAt !== null;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p
                    className={`font-medium truncate ${
                      inactive
                        ? 'text-muted line-through'
                        : 'text-foreground'
                    }`}
                  >
                    {e.displayName || e.email}
                  </p>
                  <p className="text-[12px] text-muted truncate">
                    {e.email}
                    {e.department && ` · ${e.department}`}
                    {' · '}
                    {e.linked ? <T>active account</T> : <T>not signed in yet</T>}
                    {e.source !== 'manual' && ` · ${e.source}`}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <select
                    value={e.roleKey ?? ''}
                    onChange={(ev) => assignRole(e.id, ev.target.value)}
                    disabled={pending || inactive}
                    aria-label={`Role for ${e.displayName || e.email}`}
                    className="text-[12px] rounded-md bg-transparent ring-1 ring-edge px-2 py-1 text-foreground disabled:opacity-50"
                  >
                    <option value=""><T>Default access</T></option>
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => toggle(e.id, inactive)}
                    disabled={pending}
                    className="inline-flex items-center min-h-[40px] px-2.5 rounded-md text-[12px] text-foreground ring-1 ring-edge hover:bg-surface-2 disabled:opacity-50"
                  >
                    {inactive ? <T>Reactivate</T> : <T>Deactivate</T>}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
