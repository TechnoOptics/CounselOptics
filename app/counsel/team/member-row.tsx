'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  removeFirmMemberAction,
  updateFirmMemberRoleAction,
} from '@/lib/firm-actions';
import type { FirmMember, FirmRole } from '@/lib/firm-types';
import { FIRM_ROLES, FIRM_ROLE_LABEL } from '@/lib/firm-types';

const EDITABLE_ROLES: FirmRole[] = FIRM_ROLES;

export function TeamMemberRow({
  member,
  firmId,
  canManage,
  isMe,
  isLastOwner,
}: {
  member: FirmMember;
  firmId: string;
  canManage: boolean;
  isMe: boolean;
  isLastOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<FirmRole>(member.role);
  const [error, setError] = useState<string | null>(null);

  function changeRole(newRole: FirmRole) {
    if (newRole === role) return;
    if (member.role === 'owner' && isLastOwner && newRole !== 'owner') {
      setError('Promote another owner first - a firm needs at least one owner.');
      return;
    }
    setError(null);
    setRole(newRole);
    startTransition(async () => {
      const res = await updateFirmMemberRoleAction(firmId, member.userId, newRole);
      if (!res.ok) {
        setRole(member.role);
        setError(res.error ?? 'Could not update role.');
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    if (member.role === 'owner' && isLastOwner) {
      setError('You cannot remove the only owner. Promote someone else first.');
      return;
    }
    if (
      !confirm(
        isMe
          ? 'Leave this firm? You will lose access to its cases, documents, and chat.'
          : `Remove ${member.email ?? member.displayName ?? 'this member'} from the firm?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await removeFirmMemberAction(firmId, member.userId);
      if (!res.ok) setError(res.error ?? 'Could not remove member.');
      else router.refresh();
    });
  }

  return (
    <tr>
      <td className="px-4 py-2.5 text-ink-900 dark:text-cream-100">
        {member.displayName ?? '-'}
        {isMe && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            (you)
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-ink-700 dark:text-cream-100/80">
        {member.email ?? '-'}
      </td>
      <td className="px-4 py-2.5">
        {canManage ? (
          <select
            value={role}
            onChange={(e) => changeRole(e.target.value as FirmRole)}
            disabled={pending || (member.role === 'owner' && isLastOwner && !isMe)}
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
            className="text-[12px] text-rose-700 dark:text-rose-300 hover:underline"
          >
            {isMe ? 'Leave' : 'Remove'}
          </button>
        )}
        {error && (
          <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">{error}</p>
        )}
      </td>
    </tr>
  );
}
