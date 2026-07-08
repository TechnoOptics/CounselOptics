'use client';

import { useState, useTransition } from 'react';
import {
  inviteMatterCollaboratorAction,
  removeMatterCollaboratorAction,
} from '@/lib/firm-actions';
import type { Collaborator, CollaboratorRole } from '@/lib/types';

/**
 * Firm-facing labels for the four invite roles, keyed by the underlying
 * case_collaborators role that gets stored. A matter opened before this
 * feature may still carry a legacy 'witness' collaborator, so that's
 * covered too.
 */
const FIRM_ROLE_LABEL: Record<CollaboratorRole, string> = {
  represented: 'Represented party',
  attorney: 'Co-counsel',
  editor: 'Contributor',
  viewer: 'Viewer',
  witness: 'Witness',
};

/** The picker options - the `value` is the firm-facing key the server maps. */
const INVITE_ROLES: Array<{
  value: string;
  label: string;
  blurb: string;
}> = [
  {
    value: 'represented',
    label: 'Represented party (client)',
    blurb: 'Your client. Can view the matter and contribute their own evidence and statements.',
  },
  {
    value: 'co_counsel',
    label: 'Co-counsel',
    blurb: 'Attorney-level. Can view the matter, contribute, and add exhibits.',
  },
  {
    value: 'contributor',
    label: 'Contributor',
    blurb: 'Can add evidence and notes, but cannot manage the matter or invite others.',
  },
  {
    value: 'viewer',
    label: 'Viewer',
    blurb: 'Read-only access to the matter.',
  },
];

export function MatterInviteForm({
  caseId,
  collaborators,
  canManage,
}: {
  caseId: string;
  collaborators: Collaborator[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState('represented');

  function invite(formData: FormData) {
    setError(null);
    setInfo(null);
    const email = String(formData.get('email') ?? '').trim();
    startTransition(async () => {
      const result = await inviteMatterCollaboratorAction(caseId, formData);
      if (!result.ok) {
        setError(result.error ?? 'Invite failed.');
        return;
      }
      setShowForm(false);
      setInfo(
        result.emailed
          ? `Invite sent to ${email}. They'll get an email with a sign-in link.`
          : `${email} was added to the matter. Email delivery is unconfigured, so let them know directly.`,
      );
    });
  }

  function remove(id: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await removeMatterCollaboratorAction(caseId, id);
      if (!result.ok) setError(result.error ?? 'Remove failed.');
    });
  }

  const activeRoleBlurb = INVITE_ROLES.find((r) => r.value === role)?.blurb;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
            People on this matter
          </h2>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            {collaborators.length === 0
              ? 'Invite your client, co-counsel, or a contributor.'
              : `${collaborators.length} ${collaborators.length === 1 ? 'person' : 'people'} invited`}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setShowForm((s) => !s);
              setError(null);
              setInfo(null);
            }}
            className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            {showForm ? 'Cancel' : 'Invite to matter'}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {info}
        </p>
      )}

      {showForm && canManage && (
        <form action={invite} className="card p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                htmlFor="matter-invite-email"
              >
                Email
              </label>
              <input
                id="matter-invite-email"
                name="email"
                type="email"
                required
                placeholder="person@example.com"
                className="input"
              />
            </div>
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                htmlFor="matter-invite-role"
              >
                Role
              </label>
              <select
                id="matter-invite-role"
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="input"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {activeRoleBlurb && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
              {activeRoleBlurb} If they already have an Advottic account they get
              access immediately; otherwise their invite is held until they sign
              up with this email.
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      )}

      {collaborators.length > 0 && (
        <ul className="space-y-2">
          {collaborators.map((c) => (
            <li
              key={c.id}
              className="card p-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-forest-900 dark:text-cream-100 truncate">
                    {c.email}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-forest-50 dark:bg-forest-800/50 text-forest-900 dark:text-cream-100/85 ring-forest-200 dark:ring-forest-700/40">
                    {FIRM_ROLE_LABEL[c.role] ?? c.role}
                  </span>
                  {c.acceptedAt ? (
                    <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-900/50">
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-amber-200 dark:ring-amber-900/50">
                      Pending signup
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums mt-1">
                  Invited {new Date(c.invitedAt).toLocaleDateString()}
                  {c.acceptedAt &&
                    ` · joined ${new Date(c.acceptedAt).toLocaleDateString()}`}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  className="shrink-0 text-[12px] text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-200 underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
