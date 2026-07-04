'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  removeFirmMemberAction,
  updateFirmMemberRoleAction,
  transferFirmOwnershipAction,
} from '@/lib/firm-actions';
import type { FirmMember, FirmRole } from '@/lib/firm-types';
import { FIRM_ROLES, FIRM_ROLE_LABEL } from '@/lib/firm-types';
import { T, useT } from '@/components/i18n/LocaleProvider';

// 'owner' is excluded here on purpose: it can only change via
// transferFirmOwnershipAction (below), which keeps firms.created_by in
// sync. Selecting it from this generic dropdown would just be rejected
// server-side, so don't offer it as a target for someone else's role.
const EDITABLE_ROLES: FirmRole[] = FIRM_ROLES.filter((r) => r !== 'owner');

export function TeamMemberRow({
  member,
  firmId,
  canManage,
  isMe,
  isLastOwner,
  otherMembers,
}: {
  member: FirmMember;
  firmId: string;
  canManage: boolean;
  isMe: boolean;
  isLastOwner: boolean;
  otherMembers: FirmMember[];
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<FirmRole>(member.role);
  const [error, setError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');

  function transferOwnership() {
    if (!transferTarget) {
      setError(t('Pick who should become the new owner.'));
      return;
    }
    const target = otherMembers.find((m) => m.userId === transferTarget);
    if (
      !confirm(
        `Make ${target?.displayName ?? target?.email ?? 'this person'} the firm owner? You'll be moved to Admin.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await transferFirmOwnershipAction(firmId, transferTarget);
      if (!res.ok) setError(res.error ?? t('Could not transfer ownership.'));
      else {
        setShowTransfer(false);
        router.refresh();
      }
    });
  }

  function changeRole(newRole: FirmRole) {
    if (newRole === role) return;
    setError(null);
    setRole(newRole);
    startTransition(async () => {
      const res = await updateFirmMemberRoleAction(firmId, member.userId, newRole);
      if (!res.ok) {
        setRole(member.role);
        setError(res.error ?? t('Could not update role.'));
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    if (member.role === 'owner' && isLastOwner) {
      setError(t('You cannot remove the only owner. Promote someone else first.'));
      return;
    }
    if (
      !confirm(
        isMe
          ? t('Leave this firm? You will lose access to its cases, documents, and chat.')
          : `Remove ${member.email ?? member.displayName ?? 'this member'} from the firm?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await removeFirmMemberAction(firmId, member.userId);
      if (!res.ok) setError(res.error ?? t('Could not remove member.'));
      else router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-4 py-2.5 text-ink-900 dark:text-cream-100">
        {member.displayName ?? '-'}
        {isMe && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            <T>(you)</T>
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-ink-700 dark:text-cream-100/80">
        {member.email ?? '-'}
      </td>
      <td className="px-4 py-2.5">
        {member.role === 'owner' ? (
          <div>
            <span className="text-ink-700 dark:text-cream-100/80">{FIRM_ROLE_LABEL.owner}</span>
            {isMe && (
              <button
                type="button"
                onClick={() => setShowTransfer((v) => !v)}
                className="block text-[11px] text-forest-700 dark:text-gold-400 hover:underline mt-0.5"
              >
                <T>Transfer ownership…</T>
              </button>
            )}
            {isMe && showTransfer && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  className="input py-1 text-[12px]"
                >
                  <option value=""><T>Choose new owner…</T></option>
                  {otherMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName ?? m.email ?? m.userId}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={transferOwnership}
                  disabled={pending || !transferTarget}
                  className="text-[12px] btn-secondary py-1 px-2"
                >
                  <T>Confirm</T>
                </button>
              </div>
            )}
          </div>
        ) : canManage ? (
          <select
            value={role}
            onChange={(e) => changeRole(e.target.value as FirmRole)}
            disabled={pending}
            className="input py-1 text-sm"
          >
            {EDITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {FIRM_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-ink-700 dark:text-cream-100/80">
            {FIRM_ROLE_LABEL[role]}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-ink-500 dark:text-cream-100/55 font-mono text-[11px] tabular-nums">
        {new Date(member.joinedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-2.5 text-right">
        {(canManage || isMe) && !(member.role === 'owner' && isLastOwner) && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center justify-center min-h-[40px] px-3 rounded-md text-[12px] text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
          >
            {isMe ? <T>Leave</T> : <T>Remove</T>}
          </button>
        )}
        {error && (
          <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">{error}</p>
        )}
      </td>
    </tr>
  );
}
