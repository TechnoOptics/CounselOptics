'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import {
  COUNSEL_TILES,
  COUNSEL_TILE_CATEGORIES,
  DEFAULT_ENABLED_TILES,
  type CounselTileId,
} from '@/lib/counsel-dashboard';
import { updateCounselDashboardPreferencesAction } from '@/lib/dashboard-actions';

/**
 * "Customize" affordance in the dashboard header. Opens a panel
 * grouped by category (Work / Firm data / Shortcuts) where the user
 * checks the tiles they want and uses up / down arrows to reorder.
 * Saving calls the server action and revalidates /counsel so the
 * new layout renders on the next paint.
 *
 * Reorder via up / down arrows rather than drag-and-drop on purpose
 * - it works on touch, with keyboards, with screen readers, and adds
 * no dependency. Sufficient for ~15 items.
 */
export function DashboardCustomizer({
  initialEnabled,
  isAdmin,
}: {
  initialEnabled: CounselTileId[];
  /** Admin-only tiles are hidden from non-admins in the picker. */
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<CounselTileId[]>(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const visibleCatalog = COUNSEL_TILES.filter(
    (t) => isAdmin || !t.adminOnly,
  );
  const enabledSet = new Set(enabled);

  function toggle(id: CounselTileId) {
    setEnabled((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }

  function move(id: CounselTileId, direction: -1 | 1) {
    setEnabled((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + direction;
      if (target < 0 || target >= next.length) return next;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }

  function reset() {
    setEnabled([...DEFAULT_ENABLED_TILES]);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCounselDashboardPreferencesAction({
        enabled,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-forest-700/40 bg-forest-900/40 px-3 py-1.5 text-[12.5px] text-cream-100/80 hover:bg-forest-800/60 hover:text-cream-100 transition-colors"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <PencilIcon />
        Customize dashboard
      </button>

      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          ariaLabel="Customize dashboard"
          size="sm"
        >
          <div className="p-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-forest-700/40">
            <div>
              <p className="font-display text-base font-medium text-cream-100">
                Customize your dashboard
              </p>
              <p className="text-[12px] text-cream-100/60 mt-0.5 leading-relaxed">
                Pick which tiles you want and arrange them in the
                order you want. Welcome + Ask Advottic always stay at
                the top.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-cream-100/55 hover:text-cream-100 text-lg leading-none px-1"
              aria-label="Close"
            >
              x
            </button>
          </div>

          {/* Reorder list - shows currently-enabled tiles in user's
              order with arrow buttons to move them up + down. */}
          {enabled.length > 0 ? (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cream-100/45 mb-1.5">
                On your dashboard ({enabled.length})
              </p>
              <ul className="space-y-1">
                {enabled.map((id, i) => {
                  const meta = visibleCatalog.find((t) => t.id === id);
                  if (!meta) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md bg-forest-900/40 ring-1 ring-forest-700/40 px-2 py-1.5"
                    >
                      <span className="flex-1 text-[13px] text-cream-100">
                        {meta.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => move(id, -1)}
                        disabled={i === 0}
                        className="text-cream-100/50 hover:text-cream-100 disabled:opacity-30 px-1"
                        aria-label={`Move ${meta.label} up`}
                      >
                        <UpIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(id, 1)}
                        disabled={i === enabled.length - 1}
                        className="text-cream-100/50 hover:text-cream-100 disabled:opacity-30 px-1"
                        aria-label={`Move ${meta.label} down`}
                      >
                        <DownIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        className="text-rose-300/70 hover:text-rose-200 text-[11px] px-1.5"
                        aria-label={`Remove ${meta.label}`}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-cream-100/55">
              No tiles selected. Your dashboard will show only the
              welcome banner + Ask Advottic.
            </p>
          )}

          {/* Catalog grouped by category. Already-enabled tiles get a
              filled checkbox + dimmed label so the user can see what
              they already added without losing context. */}
          <div className="mt-4 pt-3 border-t border-forest-700/40 space-y-3">
            {COUNSEL_TILE_CATEGORIES.map((cat) => {
              const items = visibleCatalog.filter((t) => t.category === cat.id);
              if (items.length === 0) return null;
              return (
                <div key={cat.id}>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-cream-100/55">
                    {cat.label}
                  </p>
                  <p className="text-[11px] text-cream-100/45 mb-1.5">
                    {cat.description}
                  </p>
                  <ul className="space-y-1">
                    {items.map((t) => {
                      const isOn = enabledSet.has(t.id);
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => toggle(t.id)}
                            className={`w-full text-left flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
                              isOn
                                ? 'bg-gold-500/10 ring-1 ring-gold-500/30'
                                : 'hover:bg-cream-100/5'
                            }`}
                          >
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded border ${
                                isOn
                                  ? 'bg-gold-400 border-gold-400 text-forest-950'
                                  : 'border-cream-100/40'
                              }`}
                              aria-hidden
                            >
                              {isOn ? <CheckIcon /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] text-cream-100">
                                {t.label}
                              </span>
                              <span className="block text-[11px] text-cream-100/55 leading-snug">
                                {t.description}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {error && (
            <p className="mt-3 text-[12px] text-rose-300">{error}</p>
          )}

          <div className="mt-4 pt-3 border-t border-forest-700/40 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={reset}
              className="text-[12px] text-cream-100/55 hover:text-cream-100 underline underline-offset-2"
            >
              Reset to defaults
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-3 py-1.5 rounded-md text-[12.5px] text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="btn-primary text-[12.5px] px-3 py-1.5 disabled:opacity-50"
              >
                {pending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function UpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
function DownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
