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
        <p className="text-[10.5px] text-rose-700 dark:text-rose-300 leading-snug">{error}</p>
      )}
      {!isSelf && !isPermanentAdmin && !isAdmin && !isBlocked && (
        <ImpersonateButton userId={userId} />
      )}
    </div>
  );
}

/**
 * "Sign in as" button for HQ admins. Hidden for self, admins (no
 * admin-on-admin impersonation), and blocked accounts. Opens the
 * resulting magic link in a new tab so the admin keeps their own
 * session intact in the original tab.
 *
 * Every successful click writes an audit row in admin_impersonations
 * server-side. The optional `reason` prompt is best-practice for
 * support hygiene (ticket ID + one-line summary).
 */
function ImpersonateButton({ userId }: { userId: string }) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (pending) return;
    const reason = window.prompt(
      'Reason for impersonating this user (optional - ticket ID + summary, recorded in audit log):',
      '',
    );
    if (reason === null) return; // cancel
    setErr(null);
    setPending(true);
    try {
      const r = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason }),
      });
      const j = (await r.json()) as { url?: string; error?: string; detail?: string };
      if (!r.ok || !j.url) {
        setErr(j.detail || j.error || `HTTP ${r.status}`);
        return;
      }
      // Navigate this tab to the target's workspace. The overlay is already
      // armed server-side (a separate cookie); the admin's own session is
      // untouched, and the red banner + "End" returns them to HQ.
      window.location.assign(j.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-forest-900 dark:text-gold-300 underline underline-offset-2 hover:text-gold-700 dark:hover:text-gold-200 disabled:opacity-60 disabled:cursor-not-allowed"
        title="View the app as this user (your admin session stays intact). Audited."
      >
        {pending ? 'Starting…' : 'View as →'}
      </button>
      {err && (
        <p className="text-[10.5px] text-rose-700 dark:text-rose-300 leading-snug mt-0.5">
          {err}
        </p>
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
          checked ? onColor : 'bg-ink-300 dark:bg-white/20'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 m-0.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span
        className={
          checked
            ? 'text-ink-900 dark:text-cream-100'
            : 'text-ink-500 dark:text-cream-100/55'
        }
      >
        {label}
      </span>
    </button>
  );
}
