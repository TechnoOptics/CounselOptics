'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Section navigator for the case-scoped Counsel GUEST shell. A guest is locked
 * to a single matter, so once they click into a section (e.g. the Timeline)
 * there was no visible way back to the matter landing. This gives them a small
 * always-present nav — Matter overview + Timeline — with the active section
 * highlighted, so they can return to the case landing from anywhere.
 *
 * `caseHref` is the guest's matter landing (/counsel/cases/<id>).
 */
export function CounselGuestNav({ caseHref }: { caseHref: string }) {
  const pathname = usePathname();
  const items: { href: string; label: string; exact: boolean }[] = [
    { href: caseHref, label: 'Matter overview', exact: true },
    { href: `${caseHref}/timeline`, label: 'Timeline', exact: false },
  ];
  return (
    <nav
      aria-label="Matter sections"
      className="mx-auto max-w-none px-4 sm:px-6 lg:px-10 -mt-0.5 flex items-center gap-1 overflow-x-auto pb-2"
    >
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
              active
                ? 'bg-cream-100/10 text-cream-100 ring-1 ring-gold-metal/40'
                : 'text-cream-100/70 hover:text-cream-100 hover:bg-cream-100/5'
            }`}
          >
            <T>{it.label}</T>
          </Link>
        );
      })}
    </nav>
  );
}
