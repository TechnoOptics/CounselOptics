'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateNumeric } from '@/lib/format';

/**
 * EvidencePicker.
 *
 * Multi-select chip picker for pulling existing items from the
 * user's Vault (uploaded documents + photos) or Contracts library
 * onto a new case at creation time. Eliminates the
 * create-then-re-upload friction in the existing flow.
 *
 * Renders inside <NewCaseForm /> as a collapsed section that
 * opens on click. Items load lazily on first open so a user who
 * doesn't need this never pays for the request.
 *
 * Selected item IDs are serialized into a hidden form field
 * (default name "attachedItems") as JSON, so the createCaseAction
 * server action can attach them to the new case in the same
 * transaction.
 *
 * Source endpoint: GET /api/cases/new-evidence -> { vault: [...],
 * contracts: [...] }. Both arrays contain { id, title, kind,
 * created_at, size_label }. Empty arrays render an inline
 * "nothing in your vault yet" hint.
 */
export type EvidenceItem = {
  id: string;
  source: 'vault' | 'contract';
  title: string;
  kind: string | null;
  created_at: string;
  size_label: string | null;
};

export function EvidencePicker({
  hiddenFieldName = 'attachedItems',
  helperText,
  onChange,
}: {
  hiddenFieldName?: string;
  helperText?: string;
  /** Called with the serialized selection whenever it changes. Needed by
   *  the smart-assist wizard, whose real <form> is a sibling of this
   *  component - the local hidden input below never reaches it, so the
   *  wizard mirrors the value into its own state instead. Forms that
   *  render this picker INSIDE their <form> (e.g. the long case form) can
   *  ignore this and rely on the hidden input. */
  onChange?: (serialized: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  // A load either has not happened, failed, or succeeded and found nothing.
  // Those are three different things to say, and this used to say the third
  // for all of them, or show the reader a raw status code.
  const [error, setError] = useState(false);
  const [vault, setVault] = useState<EvidenceItem[]>([]);
  const [contracts, setContracts] = useState<EvidenceItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'vault' | 'contracts'>('vault');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    setError(false);
    fetch('/api/cases/new-evidence', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as {
          vault?: EvidenceItem[];
          contracts?: EvidenceItem[];
        };
      })
      .then((j) => {
        setVault(
          (j.vault ?? []).map((it) => ({ ...it, source: 'vault' as const })),
        );
        setContracts(
          (j.contracts ?? []).map((it) => ({
            ...it,
            source: 'contract' as const,
          })),
        );
        setLoaded(true);
      })
      .catch(() => {
        // Deliberately NOT `e.message`. That put "HTTP 500" in front of the
        // reader, which tells them nothing they can act on and reads as
        // something being badly wrong with their case. The thrown message is
        // still useful in the console for whoever is debugging; what the
        // reader gets is what happened and what to do.
        setError(true);
        // `loaded` means the request SETTLED, not that it succeeded. Without
        // this the effect re-fired the moment `loading` went false and the
        // panel hammered a failing endpoint forever; that loop predates this
        // change. Retrying is `setLoaded(false)`, once, on purpose.
        setLoaded(true);
      })
      .finally(() => setLoading(false));
  }, [open, loaded, loading]);

  const current = tab === 'vault' ? vault : contracts;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return current;
    return current.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        (it.kind ?? '').toLowerCase().includes(q),
    );
  }, [current, query]);

  // Serialize selected ids so the server action can read them with
  // formData.get('attachedItems'). We include the source on each
  // entry so the server can dispatch to the right source-table.
  const serialized = useMemo(() => {
    const all = [...vault, ...contracts].filter((it) => selected.has(it.id));
    return JSON.stringify(
      all.map((it) => ({ id: it.id, source: it.source })),
    );
  }, [vault, contracts, selected]);

  // Mirror the serialized selection out to a controlled parent (the
  // wizard) whenever it changes. Ref-held so a parent that passes a fresh
  // callback each render can't turn this into a re-render loop - it fires
  // only when `serialized` actually changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current?.(serialized);
  }, [serialized]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50/40 dark:border-forest-700/40 dark:bg-forest-900/40">
      <input type="hidden" name={hiddenFieldName} value={serialized} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-forest-900 dark:text-cream-100">
            Attach existing evidence{' '}
            <span className="text-ink-400 font-normal">
              ({selected.size} selected)
            </span>
          </span>
          <span className="block text-xs text-ink-500 dark:text-cream-100/55 mt-0.5">
            {helperText ??
              'Pull files from your vault or contracts. Adds them as exhibits on this case.'}
          </span>
        </span>
        <span
          className={`text-xs font-mono text-ink-500 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3 animate-fade-in">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-ink-200/60 dark:border-forest-700/40">
            <button
              type="button"
              onClick={() => setTab('vault')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                tab === 'vault'
                  ? 'border-forest-900 text-forest-900 dark:border-cream-100 dark:text-cream-100'
                  : 'border-transparent text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100'
              }`}
            >
              Vault {vault.length > 0 && <span className="ml-1 text-ink-400">{vault.length}</span>}
            </button>
            <button
              type="button"
              onClick={() => setTab('contracts')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                tab === 'contracts'
                  ? 'border-forest-900 text-forest-900 dark:border-cream-100 dark:text-cream-100'
                  : 'border-transparent text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100'
              }`}
            >
              Contracts{' '}
              {contracts.length > 0 && (
                <span className="ml-1 text-ink-400">{contracts.length}</span>
              )}
            </button>
          </div>
          {/* Search inside current tab. Only renders when there's
              something to search through; otherwise the empty-state
              copy is what carries the message. */}
          {current.length > 4 && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${tab}...`}
              className="input text-[13px]"
            />
          )}
          {loading ? (
            <p className="text-[13px] text-ink-500 dark:text-cream-100/55">
              Loading your {tab}…
            </p>
          ) : error ? (
            <div className="space-y-2">
              <p className="text-[13px] text-ink-700 dark:text-cream-100/80 leading-snug">
                We could not load your {tab === 'vault' ? 'vault' : 'contracts'} just
                now. Nothing has been lost, and everything already on this case is
                unaffected.
              </p>
              <button
                type="button"
                onClick={() => {
                  setError(false);
                  setLoaded(false);
                }}
                className="text-[12.5px] font-semibold underline text-forest-900 dark:text-cream-100"
              >
                Try again
              </button>
            </div>
          ) : current.length === 0 ? (
            <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 leading-snug">
              Nothing in your {tab === 'vault' ? 'vault' : 'contracts library'}
              {' '}yet. Upload from{' '}
              <a
                href={tab === 'vault' ? '/vault' : '/contracts'}
                className="underline"
              >
                {tab === 'vault' ? '/vault' : '/contracts'}
              </a>
              {' '}and they'll show up here.
            </p>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {filtered.map((it) => {
                const isSelected = selected.has(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => toggle(it.id)}
                      className={`w-full text-left rounded-lg ring-1 p-3 transition-colors ${
                        isSelected
                          ? 'ring-gold-metal dark:ring-amber-500/60 bg-amber-50/40 dark:bg-amber-950/15'
                          : 'ring-ink-200 dark:ring-forest-700/40 hover:ring-forest-700/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100 leading-snug truncate">
                          {it.title}
                        </p>
                        {isSelected && (
                          <span
                            aria-hidden
                            className="flex-none inline-flex h-4 w-4 rounded-full bg-emerald-500 text-white text-[10px] items-center justify-center"
                          >
                            ✓
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1 leading-snug">
                        {it.kind ? `${it.kind} · ` : ''}
                        {it.size_label ? `${it.size_label} · ` : ''}
                        {formatDateNumeric(it.created_at)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
