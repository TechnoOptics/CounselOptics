'use client';

import { useState, useTransition } from 'react';
import {
  setUserAdminAction,
  setUserBlockedAction,
  type AdminToggleResult,
} from '@/lib/actions';

/**
 * Two-toggle row for an admin user table cell. Calls the server actions
 * and surfaces any error inline (e.g. "There must always be at least 2
 * admins."). Optimistic local state means the toggle responds instantly;
 * if the server rejects, we revert and show the error.
 */
export function UserToggles({
  userId,
  initialIsAdmin,
  initialIsBlocked,
  isSelf,
  isPermanentAdmin = false,
}: {
  userId: string;
  initialIsAdmin: boolean;
  initialIsBlocked: boolean;
  isSelf: boolean;
  isPermanentAdmin?: boolean;
}) {
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin);
  const [isBlocked, setIsBlocked] = useState(initialIsBlocked);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handleAdmin(next: boolean) {
    if (pending) return;
    if (isPermanentAdmin && !next) {
      setError('This is a permanent operator account.');
      return;
    }
    const prev = isAdmin;
    setIsAdmin(next);
    setError(null);
    start(async () => {
      const result: AdminToggleResult = await setUserAdminAction(userId, next);
      if (!result.ok) {
        setIsAdmin(prev);
        setError(result.error ?? 'Failed.');
      }
    });
  }

  function handleBlocked(next: boolean) {
    if (pending) return;
    if (isSelf && next) {
      setError("You can't block your own account.");
      return;
    }
    if (isPermanentAdmin && next) {
      setError('Permanent operator accounts cannot be deactivated.');
      return;
    }
    const prev = isBlocked;
    setIsBlocked(next);
    setError(null);
    start(async () => {
      const result: AdminToggleResult = await setUserBlockedAction(userId, next);
      if (!result.ok) {
        setIsBlocked(prev);
        setError(result.error ?? 'Failed.');
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Toggle
          label="Admin"
          checked={isAdmin}
          onChange={handleAdmin}
          disabled={pending || (isSelf && isAdmin) || isPermanentAdmin}
          tone="forest"
          title={
            isPermanentAdmin
              ? 'Permanent operator account'
              : isSelf && isAdmin
                ? 'Demote another admin first'
                : undefined
          }
        />
        <Toggle
          label="Active"
          checked={!isBlocked}
          onChange={(next) => handleBlocked(!next)}
          disabled={pending || isSelf || isPermanentAdmin}
          tone="emerald"
          title={
            isPermanentAdmin
              ? 'Permanent operator account'
              : isSelf
                ? "You can't deactivate your own account"
                : undefined
          }
        />
      </div>
      {error && (
        <p className="text-[10.5px] text-rose-700 leading-snug">{error}</p>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  tone,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  tone: 'forest' | 'emerald';
  title?: string;
}) {
  const onColor = tone === 'forest' ? 'bg-forest-900' : 'bg-emerald-600';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group inline-flex items-center gap-1.5 text-[11px] font-medium ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <span
        className={`relative inline-flex h-5 w-9 flex-none rounded-full transition-colors ${
          checked ? onColor : 'bg-ink-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 m-0.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className={checked ? 'text-ink-900' : 'text-ink-500'}>{label}</span>
    </button>
  );
}
