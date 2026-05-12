'use client';

import { useState } from 'react';

/**
 * "View as firm owner →" button for the HQ firms table. Calls the
 * existing /api/admin/impersonate endpoint with the firm owner's
 * user_id, then opens the resulting magic link in a new tab.
 *
 * Why this exists separately from the per-user impersonate button
 * in /admin/users: the support workflow from the firms table is
 * different - the admin is investigating a specific FIRM (billing
 * issue, customer complaint, demo) and wants the firm's primary
 * view. Routing through "look up the owner" is the natural
 * starting point.
 *
 * Hardening: the underlying API rejects impersonation of admins,
 * blocked users, or self. If a firm was created by an admin
 * account, the button gets a fail message and no link opens.
 */
export function ImpersonateOwnerButton({
  ownerUserId,
  firmName,
  ownerEmail,
}: {
  ownerUserId: string | null;
  firmName: string;
  ownerEmail: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!ownerUserId) {
    return (
      <span
        className="text-[11px] text-ink-400 italic"
        title="This firm has no recorded creator on auth.users; cannot impersonate."
      >
        Owner unknown
      </span>
    );
  }

  async function go() {
    if (pending) return;
    const reason = window.prompt(
      `Reason for viewing ${firmName} as the firm owner${
        ownerEmail ? ` (${ownerEmail})` : ''
      }? (optional, recorded in audit log)`,
      `Support - viewing ${firmName} workspace`,
    );
    if (reason === null) return; // cancel
    setErr(null);
    setPending(true);
    try {
      const r = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: ownerUserId, reason }),
      });
      const j = (await r.json()) as { url?: string; error?: string; detail?: string };
      if (!r.ok || !j.url) {
        setErr(j.detail || j.error || `HTTP ${r.status}`);
        return;
      }
      window.open(j.url, '_blank', 'noopener,noreferrer');
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
        className="inline-flex items-center gap-1 text-[11px] font-medium text-forest-700 dark:text-gold-300 underline underline-offset-2 hover:text-gold-700 dark:hover:text-gold-200 disabled:opacity-60 disabled:cursor-not-allowed"
        title="Open this firm's workspace as the firm's owner in a new tab. Audited."
      >
        {pending ? 'Generating…' : 'View as owner →'}
      </button>
      {err && (
        <p className="text-[10.5px] text-rose-700 dark:text-rose-300 leading-snug mt-0.5 max-w-[180px]">
          {err}
        </p>
      )}
    </div>
  );
}
