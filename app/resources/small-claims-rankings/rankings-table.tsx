'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { StateSmallClaims } from '@/lib/state-small-claims';
import { filingFeeFloor } from '@/lib/state-small-claims';

type SortKey = 'name' | 'monetaryLimit' | 'filingFee' | 'appealWindowDays';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Jurisdiction' },
  { key: 'monetaryLimit', label: 'Limit' },
  { key: 'filingFee', label: 'Filing fee' },
  { key: 'appealWindowDays', label: 'Appeal window' },
];

/**
 * Full 52-jurisdiction table, client-sortable by clicking a header.
 * Defaults to limit descending (the "rankings" framing). Kept as a
 * client island inside an otherwise static page - the surrounding
 * page content stays crawlable without JS.
 */
export function RankingsTable({ states }: { states: StateSmallClaims[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('monetaryLimit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const copy = [...states];
    copy.sort((a, b) => {
      let diff: number;
      switch (sortKey) {
        case 'name':
          diff = a.name.localeCompare(b.name);
          break;
        case 'filingFee':
          diff = filingFeeFloor(a.filingFee) - filingFeeFloor(b.filingFee);
          break;
        case 'appealWindowDays':
          diff = a.appealWindowDays - b.appealWindowDays;
          break;
        default:
          diff = a.monetaryLimit - b.monetaryLimit;
      }
      return sortDir === 'asc' ? diff : -diff;
    });
    return copy;
  }, [states, sortKey, sortDir]);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40">
      <table className="w-full min-w-[640px] text-[13.5px] tabular-nums">
        <thead>
          <tr className="bg-cream-50/50 dark:bg-forest-900/40 text-left">
            {COLUMNS.map((c) => {
              const active = c.key === sortKey;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className="p-0"
                  aria-sort={
                    active
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    className="w-full flex items-center gap-1 px-4 py-2.5 text-[11px] font-mono uppercase tracking-[0.15em] text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
                  >
                    {c.label}
                    <span aria-hidden="true" className="text-[9px]">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-4 py-2.5 text-[11px] font-mono uppercase tracking-[0.15em] text-ink-500 dark:text-cream-100/55">
              Attorneys
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => (
            <tr
              key={s.slug}
              className={
                i % 2 === 0
                  ? 'bg-transparent'
                  : 'bg-cream-50/20 dark:bg-forest-900/20'
              }
            >
              <td className="px-4 py-2 text-forest-900 dark:text-cream-100 font-medium">
                <Link
                  href={`/resources/states/${s.slug}/small-claims`}
                  className="hover:underline"
                >
                  {s.name}
                </Link>
              </td>
              <td className="px-4 py-2">${s.monetaryLimit.toLocaleString()}</td>
              <td className="px-4 py-2">{s.filingFee}</td>
              <td className="px-4 py-2">
                {s.appealWindowDays === 0 ? 'No appeal' : `${s.appealWindowDays}d`}
              </td>
              <td className="px-4 py-2 text-ink-600 dark:text-cream-100/70">
                {s.attorneysAllowed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
