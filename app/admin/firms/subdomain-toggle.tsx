'use client';

import { useState, useTransition } from 'react';
import {
  provisionTenantSubdomainAction,
  revokeTenantSubdomainAction,
} from '@/lib/actions';

/**
 * One-click subdomain provisioning for a firm row in the HQ Firms
 * table. Wraps the provision + revoke server actions:
 *
 *   off -> on  : calls provisionTenantSubdomainAction. Server action
 *                hits the Vercel API to register <slug>.advottic.com,
 *                flips firms.subdomain_enabled, invalidates the cache.
 *   on  -> off : calls revokeTenantSubdomainAction. Server action
 *                flips the flag off first (so middleware stops routing
 *                tenant traffic immediately) then detaches from Vercel.
 *
 * The button disables itself during the round-trip and surfaces any
 * server-returned error inline. On success the page revalidates and
 * the new state shows after a refresh.
 */
export function SubdomainToggle({
  firmId,
  slug,
  enabled,
}: {
  firmId: string;
  slug: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const isEnabled = optimistic ?? enabled;
  const hostname = `${slug}.advottic.com`;

  function toggle() {
    setError(null);
    const next = !isEnabled;
    setOptimistic(next);
    startTransition(async () => {
      const action = next
        ? provisionTenantSubdomainAction
        : revokeTenantSubdomainAction;
      const result = await action(firmId);
      if (!result.ok) {
        setError(result.error ?? 'Subdomain change failed.');
        // Revert optimistic state on failure.
        setOptimistic(enabled);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={isEnabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
            isEnabled
              ? 'bg-emerald-500 focus-visible:outline-emerald-400'
              : 'bg-ink-300 dark:bg-forest-700 focus-visible:outline-cream-100/50'
          } ${pending ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transform transition-transform ${
              isEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
        {isEnabled ? (
          <a
            href={`https://${hostname}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] text-emerald-700 dark:text-emerald-300 hover:underline truncate"
            title={`Open ${hostname}`}
          >
            {hostname} ↗
          </a>
        ) : (
          <span className="font-mono text-[12px] text-ink-400 dark:text-cream-100/40 truncate">
            disabled
          </span>
        )}
      </div>
      {pending && (
        <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
          {isEnabled ? 'Provisioning…' : 'Revoking…'}
        </span>
      )}
      {error && (
        <span className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
          {error}
        </span>
      )}
    </div>
  );
}
