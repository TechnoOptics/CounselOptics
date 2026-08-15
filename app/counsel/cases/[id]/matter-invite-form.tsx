'use client';

import { useState, useTransition } from 'react';
import {
  inviteMatterCollaboratorAction,
  removeMatterCollaboratorAction,
} from '@/lib/firm-actions';
import {
  createFirmGuestAccountAction,
  setFirmGuestActiveAction,
} from '@/lib/guest-account-actions';
import type { CaseGuestAccount } from '@/lib/counsel-guest';
import type { Collaborator, CollaboratorRole } from '@/lib/types';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDateNumeric } from '@/lib/format';
import type { FirmCopy } from '@/lib/firm-vocabulary';

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

/**
 * The picker options - the `value` is the firm-facing key the server maps.
 *
 * A function rather than a const because the first row names the person the
 * matter is FOR, and that is the one word a workspace's type changes. The
 * other three are attorney-side roles and read the same everywhere.
 */
function inviteRoles(copy: FirmCopy): Array<{
  value: string;
  label: string;
  blurb: string;
}> {
  return [
  {
    value: 'represented',
    label: copy.matterRoleLabel,
    blurb: copy.matterRoleBlurb,
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
}

export function MatterInviteForm({
  caseId,
  collaborators,
  canManage,
  canProvisionGuests = false,
  guestAccounts = [],
  copy,
}: {
  caseId: string;
  collaborators: Collaborator[];
  canManage: boolean;
  canProvisionGuests?: boolean;
  guestAccounts?: CaseGuestAccount[];
  /** Resolved by the page from the firm's type. See lib/firm-vocabulary.ts. */
  copy: FirmCopy;
}) {
  const roles = inviteRoles(copy);
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

  // Removing a collaborator ends their access to the matter immediately. It is
  // not a toggle: getting them back means a fresh invitation they have to
  // accept again.
  const [removing, setRemoving] = useState<Collaborator | null>(null);

  // Firm-provisioned guest accounts (owner/admin only).
  const [showGuest, setShowGuest] = useState(false);
  const [newCredential, setNewCredential] = useState<{
    username: string;
    tempPassword: string;
  } | null>(null);

  function createGuest(formData: FormData) {
    setError(null);
    setInfo(null);
    setNewCredential(null);
    startTransition(async () => {
      const result = await createFirmGuestAccountAction(caseId, formData);
      if (!result.ok || !result.username || !result.tempPassword) {
        setError(result.error ?? 'Could not create the guest account.');
        return;
      }
      setShowGuest(false);
      setNewCredential({
        username: result.username,
        tempPassword: result.tempPassword,
      });
    });
  }

  function toggleGuest(guestAccountId: string, active: boolean) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const result = await setFirmGuestActiveAction(guestAccountId, active);
      if (!result.ok) setError(result.error ?? 'Could not update the guest.');
    });
  }

  const activeRoleBlurb = roles.find((r) => r.value === role)?.blurb;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-forest-900 dark:text-cream-100">
            People on this matter
          </h2>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            {collaborators.length === 0
              ? copy.matterInviteHint
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
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                htmlFor="matter-invite-name"
              >
                Name
              </label>
              <input
                id="matter-invite-name"
                name="inviteeName"
                type="text"
                placeholder="Jordan Rivera"
                className="input"
              />
            </div>
            <div>
              <label
                className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                htmlFor="matter-invite-org"
              >
                Organization
              </label>
              <input
                id="matter-invite-org"
                name="organization"
                type="text"
                placeholder="Rivera & Associates"
                className="input"
              />
            </div>
          </div>
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
                {roles.map((r) => (
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
                  <StatusPill size="sm" color={PILL_COLORS.neutral}>
                    {FIRM_ROLE_LABEL[c.role] ?? c.role}
                  </StatusPill>
                  {c.acceptedAt ? (
                    <StatusPill size="sm" color={PILL_COLORS.good}>
                      Active
                    </StatusPill>
                  ) : (
                    <StatusPill size="sm" color={PILL_COLORS.waiting}>
                      Pending signup
                    </StatusPill>
                  )}
                </div>
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono tabular-nums mt-1">
                  Invited {formatDateNumeric(c.invitedAt)}
                  {c.acceptedAt &&
                    ` · joined ${formatDateNumeric(c.acceptedAt)}`}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setRemoving(c)}
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

      {canProvisionGuests && (
        <div className="mt-4 pt-4 border-t border-ink-100 dark:border-forest-700/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
                Firm-provisioned guest access
              </h3>
              <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                Create a login for co-counsel who don&rsquo;t have an Advottic
                account. They sign in at{' '}
                <span className="font-mono">/guest-login</span> and set their own
                password on first use.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowGuest((s) => !s);
                setNewCredential(null);
                setError(null);
              }}
              className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            >
              {showGuest ? 'Cancel' : 'Create guest account'}
            </button>
          </div>

          {newCredential && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">Guest account created.</p>
              <p className="mt-1">
                Share these once - the password is shown only now:
              </p>
              <dl className="mt-2 font-mono text-[12px] space-y-0.5">
                <div>
                  Username: <span className="font-semibold">{newCredential.username}</span>
                </div>
                <div>
                  Temporary password:{' '}
                  <span className="font-semibold">{newCredential.tempPassword}</span>
                </div>
              </dl>
              <p className="mt-2 text-[11px]">
                They&rsquo;ll be asked to choose their own password on first login.
              </p>
            </div>
          )}

          {showGuest && (
            <form action={createGuest} className="card p-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                    htmlFor="guest-display-name"
                  >
                    Name
                  </label>
                  <input
                    id="guest-display-name"
                    name="displayName"
                    type="text"
                    placeholder="Jordan Smith"
                    className="input"
                  />
                </div>
                <div>
                  <label
                    className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-500 dark:text-cream-100/55 mb-1"
                    htmlFor="guest-username"
                  >
                    Username base
                  </label>
                  <input
                    id="guest-username"
                    name="username"
                    type="text"
                    placeholder="jsmith"
                    className="input"
                  />
                </div>
              </div>
              <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
                We add a short suffix so the username is unique. This guest gets
                co-counsel access to this matter only.
              </p>
              <div className="flex justify-end">
                <button type="submit" disabled={pending} className="btn-primary">
                  {pending ? 'Creating…' : 'Create guest'}
                </button>
              </div>
            </form>
          )}

          {guestAccounts.length > 0 && (
            <ul className="space-y-2">
              {guestAccounts.map((g) => (
                <li
                  key={g.guestAccountId}
                  className="card p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-mono font-semibold text-forest-900 dark:text-cream-100 truncate">
                        {g.username}
                      </span>
                      {g.deactivatedAt ? (
                        <StatusPill size="sm" color={PILL_COLORS.neutral}>
                          Deactivated
                        </StatusPill>
                      ) : (
                        <StatusPill size="sm" color={PILL_COLORS.good}>
                          Active
                        </StatusPill>
                      )}
                      {g.mustChangePassword && !g.deactivatedAt && (
                        <StatusPill size="sm" color={PILL_COLORS.waiting}>
                          Password not set
                        </StatusPill>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleGuest(g.guestAccountId, Boolean(g.deactivatedAt))}
                    disabled={pending}
                    className={
                      g.deactivatedAt
                        ? 'shrink-0 text-[12px] text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200 underline'
                        : 'shrink-0 text-[12px] text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-200 underline'
                    }
                  >
                    {g.deactivatedAt ? 'Reactivate' : 'Deactivate'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          question="Remove this person from the matter?"
          detail="Their access ends straight away, including anything already shared with them. To bring them back you would invite them again and they would have to accept."
          confirmLabel="Remove"
          cancelLabel="Keep their access"
          busy={pending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const c = removing;
            setRemoving(null);
            remove(c.id);
          }}
        />
      )}
    </section>
  );
}
