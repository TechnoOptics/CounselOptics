'use client';

import { useEffect, useMemo, useState } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { EvidencePreview } from '@/components/EvidencePreview';
import { exhibitLabel, formatOccurred, type TimelineEvent } from '@/lib/timeline-types';

/**
 * A group of items that look like copies of one another: either byte-identical
 * (same content hash) or a likely match (same filename, ignoring " (copy)", and
 * the same size). The first item is the one to keep; the rest are the extras.
 */
export type DuplicateGroup = {
  key: string;
  reason: 'identical' | 'similar' | 'visual';
  items: TimelineEvent[];
};

/**
 * Hamming distance between two 16-hex-char (64-bit) perceptual hashes: how many
 * bits differ. 0 = pixel-for-pixel the same look; a handful of bits = the same
 * image re-saved / resized / re-screenshotted. Returns 64 (max) for malformed
 * input so it never falsely groups.
 */
function phashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

// Two images within this many bits (of 64) are treated as the same picture.
// Small enough to avoid grouping merely-similar photos, large enough to catch
// re-saves, resizes, and screenshot-of-a-screenshot.
const PHASH_THRESHOLD = 6;

/** Filename with a trailing " (copy)" stripped, lowercased, for loose matching. */
function baseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(copy\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeper first: the earliest exhibit number, then the earliest created. */
function keeperFirst(items: TimelineEvent[]): TimelineEvent[] {
  return [...items].sort((a, b) => {
    const ax = a.aiExtracted?.exhibit_no ?? Number.POSITIVE_INFINITY;
    const bx = b.aiExtracted?.exhibit_no ?? Number.POSITIVE_INFINITY;
    if (ax !== bx) return ax - bx;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/**
 * Scan the case's evidence for probable duplicates. Exact matches come first
 * (same sha256 recorded at import); then similar matches by filename + size that
 * were not already caught as exact. Only groups of 2+ are returned.
 */
export function findDuplicateGroups(events: TimelineEvent[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const covered = new Set<string>();

  // Exact: byte-identical content.
  const byHash = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const h = e.aiExtracted?.sha256;
    if (!h) continue;
    const bucket = byHash.get(h);
    if (bucket) bucket.push(e);
    else byHash.set(h, [e]);
  }
  for (const [h, items] of byHash) {
    if (items.length > 1) {
      const sorted = keeperFirst(items);
      groups.push({ key: `sha:${h}`, reason: 'identical', items: sorted });
      sorted.forEach((i) => covered.add(i.id));
    }
  }

  // Similar: same filename (ignoring " (copy)") and byte size.
  const byNameSize = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const m = e.media[0];
    if (!m?.name || !m.size) continue;
    const key = `${baseName(m.name)}::${m.size}`;
    const bucket = byNameSize.get(key);
    if (bucket) bucket.push(e);
    else byNameSize.set(key, [e]);
  }
  for (const [key, items] of byNameSize) {
    const fresh = items.filter((i) => !covered.has(i.id));
    if (fresh.length > 1) {
      const sorted = keeperFirst(fresh);
      groups.push({ key: `ns:${key}`, reason: 'similar', items: sorted });
      sorted.forEach((i) => covered.add(i.id));
    }
  }

  // Visual: images that LOOK the same (perceptual hash within a small Hamming
  // distance) even though their bytes and names differ - the common firm case
  // of the same picture re-saved, resized, or re-screenshotted. Greedy
  // clustering over the not-yet-covered images that carry a phash.
  const phashPool = events.filter(
    (e) => !covered.has(e.id) && typeof e.aiExtracted?.phash === 'string' && e.aiExtracted.phash.length === 16,
  );
  for (let i = 0; i < phashPool.length; i++) {
    const seed = phashPool[i];
    if (covered.has(seed.id)) continue;
    const cluster = [seed];
    for (let j = i + 1; j < phashPool.length; j++) {
      const cand = phashPool[j];
      if (covered.has(cand.id)) continue;
      if (phashDistance(seed.aiExtracted!.phash!, cand.aiExtracted!.phash!) <= PHASH_THRESHOLD) {
        cluster.push(cand);
      }
    }
    if (cluster.length > 1) {
      const sorted = keeperFirst(cluster);
      groups.push({ key: `ph:${seed.aiExtracted!.phash}`, reason: 'visual', items: sorted });
      sorted.forEach((it) => covered.add(it.id));
    }
  }

  return groups;
}

/**
 * A dismissible review panel surfaced when the case holds probable duplicates.
 * Each group keeps its first item and pre-checks the extras for removal; the
 * user can uncheck any to keep, then delete the rest in one pass.
 */
export function DuplicatePanel({
  firmId,
  caseId,
  groups,
  extras,
  busy,
  onDelete,
  onDismiss,
  onOpen,
}: {
  firmId: string;
  caseId: string;
  groups: DuplicateGroup[];
  extras: number;
  busy: boolean;
  onDelete: (ids: string[]) => Promise<void> | void;
  onDismiss: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Default: every extra (all but the keeper in each group) is checked.
  const groupsKey = groups.map((g) => g.key).join('|');
  const defaultChecked = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) g.items.slice(1).forEach((i) => s.add(i.id));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupsKey]);
  const [checked, setChecked] = useState<Set<string>>(defaultChecked);
  // Re-seed when the set of duplicate groups changes (items landed / removed).
  useEffect(() => {
    setChecked(defaultChecked);
  }, [defaultChecked]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedCount = checked.size;

  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span aria-hidden className="text-[15px]">♊︎</span>
        <p className="text-[13px] font-medium text-amber-900 dark:text-amber-100" data-no-translate>
          {t('{n} possible duplicate(s) - review').replace('{n}', String(extras))}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] text-amber-800 hover:underline dark:text-amber-200"
          >
            {open ? <T>Hide</T> : <T>Review</T>}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('Dismiss')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40"
          >
            ✕
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-t border-amber-200/70 px-3 py-3 dark:border-amber-800/40">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg bg-white/60 p-2 ring-1 ring-amber-200/60 dark:bg-forest-900/30 dark:ring-amber-800/30">
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-amber-700 dark:text-amber-200/80">
                {g.reason === 'identical' ? (
                  <T>Identical file</T>
                ) : g.reason === 'visual' ? (
                  <T>Looks like the same image</T>
                ) : (
                  <T>Same name and size</T>
                )}
              </p>
              <ul className="space-y-1.5">
                {g.items.map((e, i) => {
                  const isKeeper = i === 0;
                  const exhibit = exhibitLabel(e.aiExtracted?.exhibit_no);
                  return (
                    <li key={e.id} className="flex items-center gap-2">
                      {isKeeper ? (
                        <span className="inline-flex h-5 w-14 shrink-0 items-center justify-center rounded bg-emerald-100 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                          <T>Keep</T>
                        </span>
                      ) : (
                        <label className="inline-flex h-5 w-14 shrink-0 cursor-pointer items-center justify-center gap-1 rounded bg-rose-50 dark:bg-rose-950/30">
                          <input
                            type="checkbox"
                            checked={checked.has(e.id)}
                            onChange={() => toggle(e.id)}
                            className="h-3.5 w-3.5 accent-rose-600"
                          />
                          <span className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-rose-600 dark:text-rose-300">
                            <T>Del</T>
                          </span>
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpen(e.id)}
                        className="h-10 w-10 shrink-0 overflow-hidden rounded ring-1 ring-black/5"
                        aria-label={t('Open item')}
                      >
                        <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-full w-full" />
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-forest-900 dark:text-cream-100" data-no-translate>
                          {exhibit ? `${exhibit} · ` : ''}
                          {e.title || e.media[0]?.name || t('(untitled)')}
                        </span>
                        <span className="block text-[10.5px] text-ink-400 dark:text-cream-100/45" data-no-translate>
                          {formatOccurred(e.occurredAt, e.occurredPrecision)}
                          {e.media[0]?.name ? ` · ${e.media[0].name}` : ''}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              onClick={() => onDelete([...checked])}
              className="inline-flex items-center rounded-md bg-rose-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {t('Delete {n} duplicate(s)').replace('{n}', String(selectedCount))}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
