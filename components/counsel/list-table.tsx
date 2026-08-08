'use client';

/**
 * The three controls a counsel list table needs that the page itself
 * cannot draw: a sortable column header, a filter select that
 * navigates when it changes, and a search box that navigates once
 * typing pauses.
 *
 * components/counsel/patterns.tsx already owns the pieces above the
 * table (the view strip, the toolbar, the chips, the mono reference).
 * These are the pieces inside it, and they are here rather than there
 * because they are the only counsel primitives that have to be client
 * components: a select that navigates on change and an input that
 * debounces both need a router.
 *
 * Every prop is serializable, so a server page can hand its parsed
 * query state straight down. That is the reason the href is not a
 * callback: `pathname` plus the current params plus the one key this
 * control owns is enough for the control to build its own links, and a
 * function prop would have forced every list page to be a client
 * component.
 *
 * app/counsel/cases/matters-table.tsx still carries its own copies of
 * all three. It is already a client component driving a typed
 * MatterListParams, so nothing about it was broken; when someone next
 * has reason to open it, these are what it should be using.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { listHref, nextSort, type SortDir } from '@/lib/counsel-list';
import { T, useT } from '@/components/i18n/LocaleProvider';

const HEAD_CELL =
  'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em]';

/**
 * A column header that is also the control that sorts by it.
 *
 * A link rather than a button, for the same reason the view strip's
 * segments are links: a sorted list is a place, and it should survive
 * being sent to someone.
 */
export function SortHeader({
  pathname,
  params,
  sortKey,
  defaultDir = 'desc',
  children,
}: {
  pathname: string;
  /** The list's whole query state, including `sort` and `dir`. */
  params: Record<string, string>;
  sortKey: string;
  /** Which way a first click on this column reads. */
  defaultDir?: SortDir;
  children: ReactNode;
}) {
  const dir: SortDir = params.dir === 'asc' ? 'asc' : 'desc';
  const on = params.sort === sortKey;
  const patch = nextSort({ sort: params.sort ?? '', dir }, sortKey, defaultDir);
  return (
    <th
      scope="col"
      aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={HEAD_CELL}
    >
      <Link
        href={listHref(pathname, params, { sort: patch.sort, dir: patch.dir })}
        scroll={false}
        className={`inline-flex items-center gap-1 transition-colors ${
          on ? 'text-foreground' : 'text-muted hover:text-foreground'
        }`}
      >
        {children}
        <span aria-hidden className="text-[9px] leading-none">
          {on ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  );
}

/** A column header for something there is no way to sort by. */
export function PlainHeader({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className={`${HEAD_CELL} text-muted`}>
      {children}
    </th>
  );
}

/**
 * A select that narrows the list, in the column it narrows.
 *
 * Navigates on change rather than waiting for an Apply button, so the
 * filter row behaves the way the matter list's does.
 */
export function FilterSelect({
  pathname,
  params,
  name,
  label,
  options,
  className = '',
}: {
  pathname: string;
  params: Record<string, string>;
  /** The query key this select owns. */
  name: string;
  /** Names the control for a screen reader. */
  label: string;
  /** The empty-valued option is the "any" one and comes first. */
  options: { value: string; label: string }[];
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <select
      value={params[name] ?? ''}
      onChange={(e) =>
        router.push(listHref(pathname, params, { [name]: e.target.value }), {
          scroll: false,
        })
      }
      aria-label={t(label)}
      className={`input h-7 w-full px-2 py-0 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value || 'any'} value={o.value}>
          {t(o.label)}
        </option>
      ))}
    </select>
  );
}

/**
 * The toolbar's search box.
 *
 * Lands in the URL, but only once typing pauses: a navigation per
 * keystroke is a history entry and a server render per keystroke. The
 * input keeps its own value meanwhile so it never lags the person
 * typing, and `replace` rather than `push` so the back button leaves
 * the list instead of walking back through half-typed queries.
 */
export function SearchFilter({
  pathname,
  params,
  name = 'q',
  label,
  placeholder,
  className = 'h-9 w-full max-w-xs py-1',
}: {
  pathname: string;
  params: Record<string, string>;
  name?: string;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <input
      type="search"
      defaultValue={params[name] ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          router.replace(listHref(pathname, params, { [name]: value }), {
            scroll: false,
          });
        }, 350);
      }}
      placeholder={t(placeholder)}
      aria-label={t(label)}
      className={`input ${className}`}
    />
  );
}

/** The link that puts every filter back to nothing. */
export function ClearFilters({
  pathname,
  params,
  keys,
}: {
  pathname: string;
  params: Record<string, string>;
  /** Every query key this list treats as a filter. */
  keys: string[];
}) {
  const cleared: Record<string, string> = {};
  for (const key of keys) cleared[key] = '';
  return (
    <Link
      href={listHref(pathname, params, cleared)}
      scroll={false}
      className="btn-ghost h-9 px-3 text-[12.5px]"
    >
      <T>Clear filters</T>
    </Link>
  );
}
