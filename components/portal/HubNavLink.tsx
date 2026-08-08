'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { T } from '@/components/i18n/LocaleProvider';

export type HubNavItem = {
  href: string;
  label: string;
  hint: string;
  soon?: boolean;
  /**
   * How many of this person's own open requests this row would show.
   *
   * Rendered only when it is above zero, so a quiet rail stays quiet
   * and a badge always means something is there. Never a total the row
   * does not lead to: the count and the destination come from the same
   * predicate in lib/portal-open-requests.ts.
   */
  count?: number;
};

/**
 * Hub sidebar / mobile nav link. Active state reads the live
 * pathname via usePathname() so the highlight follows soft
 * navigations (the App Router's layout doesn't re-render on segment
 * changes, which would otherwise freeze the active item on the page
 * the user first landed on).
 */
export function HubNavLink({
  item,
  variant = 'rail',
}: {
  item: HubNavItem;
  /** 'rail' = the desktop two-line item, 'pill' = compact mobile chip. */
  variant?: 'rail' | 'pill';
}) {
  const pathname = usePathname() ?? '';
  const active =
    !item.soon &&
    (pathname === item.href ||
      (item.href !== '/portal' &&
        item.href !== '#' &&
        pathname.startsWith(`${item.href}/`)));

  if (item.soon) {
    return (
      <div
        className={
          variant === 'pill'
            ? 'px-2 py-1 rounded text-cream-100/35 cursor-default select-none text-[12px]'
            : 'flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-cream-100/35 cursor-default select-none'
        }
        title="Coming soon"
      >
        <span className={variant === 'pill' ? '' : 'text-[13.5px]'}>
          <T>{item.label}</T>
        </span>
        {variant === 'rail' && (
          <span className="text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-cream-100/5 ring-1 ring-cream-100/10">
            <T>Soon</T>
          </span>
        )}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`px-2 py-1 rounded text-[12px] ${
          active
            ? 'text-cream-100 bg-cream-100/[0.08]'
            : 'text-cream-100/75 hover:text-cream-100 hover:bg-cream-100/5'
        }`}
      >
        <T>{item.label}</T>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
        active
          ? 'bg-surface-2 text-foreground ring-1 ring-edge'
          : 'text-muted hover:bg-surface-2 hover:text-foreground'
      }`}
    >
      <span className="flex-1 text-[13.5px] font-medium">
        <T>{item.label}</T>
      </span>
      {item.count != null && item.count > 0 && (
        <span
          className="rounded-full border border-edge px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-accent-text"
          aria-label={`${item.count} open`}
          data-no-translate
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}
