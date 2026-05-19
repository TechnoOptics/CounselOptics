'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type HubNavItem = {
  href: string;
  label: string;
  hint: string;
  soon?: boolean;
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
          {item.label}
        </span>
        {variant === 'rail' && (
          <span className="text-[9px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded bg-cream-100/5 ring-1 ring-cream-100/10">
            Soon
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
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`block px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-cream-100/[0.08] text-cream-100 ring-1 ring-cream-100/10'
          : 'text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5'
      }`}
    >
      <span className="text-[13.5px] font-medium">{item.label}</span>
      <span className="block text-[11px] text-cream-100/40">
        {item.hint}
      </span>
    </Link>
  );
}
