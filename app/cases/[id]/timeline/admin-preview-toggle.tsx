'use client';

import { useState } from 'react';

/**
 * Admin-only QA control: preview the timeline as a firm, a consumer (minimal
 * submit view), or a locked/upsell viewer, without giving up admin status.
 * Sets the adv_tl_preview cookie (read server-side by resolveTimelineAccess)
 * and reloads. Rendered only for admins.
 */

const COOKIE = 'adv_tl_preview';
type Mode = 'firm' | 'consumer' | 'locked';

const MODES: { k: Mode; label: string }[] = [
  { k: 'firm', label: 'Firm (full)' },
  { k: 'consumer', label: 'Consumer (minimal)' },
  { k: 'locked', label: 'Locked (upsell)' },
];

export function AdminPreviewToggle({ current }: { current: Mode }) {
  const [pending, setPending] = useState(false);

  function set(mode: Mode) {
    setPending(true);
    // 'firm' is the default (no cookie); the others are explicit previews.
    document.cookie =
      mode === 'firm'
        ? `${COOKIE}=; path=/; max-age=0`
        : `${COOKIE}=${mode}; path=/; max-age=2592000`;
    window.location.reload();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
      <span className="font-semibold text-amber-800 dark:text-amber-300">Admin preview</span>
      {/* `text-warn-text`, not a faded amber-700: /80 is 3.54:1 and /70 is
          2.95:1 on this banner's amber-50 fill. The token is 6.84:1 there and
          is what the rest of the product uses for warning words. */}
      <span className="text-warn-text dark:text-amber-200/70">viewing timeline as</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-amber-300/60 dark:border-amber-500/40">
        {MODES.map((m) => (
          <button
            key={m.k}
            type="button"
            disabled={pending || current === m.k}
            onClick={() => set(m.k)}
            aria-pressed={current === m.k}
            className={`px-2.5 py-1 font-medium transition-colors disabled:cursor-default ${
              current === m.k
                ? 'bg-amber-500 text-white'
                : 'bg-white/60 text-amber-800 hover:bg-amber-100 dark:bg-forest-900/40 dark:text-amber-200 dark:hover:bg-forest-900/70'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {current !== 'firm' && (
        <span className="text-warn-text dark:text-amber-200/60">Only you (admin) see this; real users are unaffected.</span>
      )}
    </div>
  );
}
