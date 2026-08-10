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
import { relativeTime } from '@/components/counsel/patterns';
import { MemberRateCell } from './member-rate-cell';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDateTimeNumeric } from '@/lib/format';

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
  rateCents,
}: {
  member: FirmMember;
  firmId: string;
  canManage: boolean;
  isMe: boolean;
  isLastOwner: boolean;
  otherMembers: FirmMember[];
  /**
   * Undefined when the viewer is not an owner/admin, which is also when the
   * page draws no rate column - so the value never reaches a client that has
   * no cell to put it in.
   */
  rateCents?: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<FirmRole>(member.role);
  const [error, setError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [confirming, setConfirming] = useState<'remove' | 'transfer' | null>(null);
  const [transferTarget, setTransferTarget] = useState('');

  function transferOwnership() {
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
    setError(null);
    startTransition(async () => {
      const res = await removeFirmMemberAction(firmId, member.userId);
      if (!res.ok) setError(res.error ?? t('Could not remove member.'));
      else router.refresh();
    });
  }

  return (
    <tr className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2">
      <td className="px-3 py-2.5 text-[13px] font-medium text-foreground">
        <span data-no-translate>{member.displayName ?? '-'}</span>
        {isMe && (
          <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-muted">
            <T>(you)</T>
          </span>
        )}
      </td>
      <td
        className="px-3 py-2.5 font-mono text-[12px] text-muted"
        data-no-translate
      >
        {member.email ?? '-'}
      </td>
      <td className="px-3 py-2.5 text-[12.5px]">
        {member.role === 'owner' ? (
          <div>
            <span className="text-foreground">{FIRM_ROLE_LABEL.owner}</span>
            {isMe && (
              <button
                type="button"
                onClick={() => setShowTransfer((v) => !v)}
                className="block text-[11px] text-accent-text hover:underline mt-0.5"
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
                  onClick={() => {
                    if (!transferTarget) {
                      setError(t('Pick who should become the new owner.'));
                      return;
                    }
                    setConfirming('transfer');
                  }}
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
          <span className="text-foreground">
            {FIRM_ROLE_LABEL[role]}
          </span>
        )}
      </td>
      {canManage && (
        <td className="px-3 py-2.5 align-top">
          <MemberRateCell
            firmId={firmId}
            memberUserId={member.userId}
            rateCents={rateCents ?? null}
          />
        </td>
      )}
      <td
        className="px-3 py-2.5 text-[12px] text-muted"
        title={formatDateTimeNumeric(member.joinedAt)}
        suppressHydrationWarning
      >
        {relativeTime(member.joinedAt) ?? ''}
      </td>
      <td className="px-3 py-2.5 text-right">
        {(canManage || isMe) && !(member.role === 'owner' && isLastOwner) && (
          <button
            type="button"
            onClick={() => {
              if (member.role === 'owner' && isLastOwner) {
                setError(t('You cannot remove the only owner. Promote someone else first.'));
                return;
              }
              setConfirming('remove');
            }}
            disabled={pending}
            className="inline-flex items-center justify-center min-h-[40px] px-3 rounded-md text-[12px] text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50"
          >
            {isMe ? <T>Leave</T> : <T>Remove</T>}
          </button>
        )}
        {error && (
          <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">{error}</p>
        )}

        {/* Both of these were native confirm() calls, which the Capacitor
            WebView suppresses: on a phone, tapping Remove dropped a colleague
            (or the reader themselves) out of the firm with no question. The
            dialog portals to <body>, so it fits inside a table cell. */}
        {confirming === 'remove' && (
          <ConfirmDialog
            question={isMe ? t('Leave this firm?') : t('Remove this person from the firm?')}
            detail={
              isMe
                ? t('You lose access to this firm\u2019s matters, documents and chat. An owner or admin would have to invite you back.')
                : t('They lose access to this firm\u2019s matters, documents and chat. Their past work stays on the matters it belongs to.')
            }
            confirmLabel={isMe ? t('Leave') : t('Remove')}
            cancelLabel={t('Cancel')}
            busy={pending}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              remove();
            }}
          />
        )}
        {confirming === 'transfer' && (
          <ConfirmDialog
            question={t('Make this person the firm owner?')}
            detail={t('They take over ownership of the firm and you are moved to Admin. Only the new owner can hand it back.')}
            confirmLabel={t('Transfer ownership')}
            cancelLabel={t('Cancel')}
            tone="neutral"
            busy={pending}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              transferOwnership();
            }}
          />
        )}
      </td>
    </tr>
  );
}
