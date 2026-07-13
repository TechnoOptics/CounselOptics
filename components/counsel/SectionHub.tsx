'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Section-tile hub for a matter landing. Instead of stacking every dashboard
 * section into one long scroll, the landing shows a grid of tiles — one per
 * section — and the reader clicks a tile to reveal just that section's content
 * (in-place), or to navigate to a sub-route. Only one in-place section is open
 * at a time, so the reader chooses what to look at rather than being handed
 * everything at once. Styled to the firm's black + gold surface.
 */
export type HubSection = {
  key: string;
  title: string;
  blurb: string;
  icon: ReactNode;
  /** A small count/label, e.g. "415 items". */
  meta?: string;
  /** In-place content revealed when the tile is opened. */
  content?: ReactNode;
  /** Navigate here instead of revealing content in place. */
  href?: string;
};

export function SectionHub({
  sections,
  defaultOpen = null,
}: {
  sections: HubSection[];
  defaultOpen?: string | null;
}) {
  const [active, setActive] = useState<string | null>(defaultOpen);
  const open = sections.find((s) => s.key === active && s.content);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => {
          const isActive = s.key === active && !s.href;
          const inner = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-metal/12 text-gold-metal ring-1 ring-gold-metal/25">
                  {s.icon}
                </span>
                {s.href ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-cream-100/40 transition-transform group-hover:translate-x-0.5">
                    <path d="M7 17L17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className={`text-gold-metal/70 transition-transform ${isActive ? 'rotate-180' : ''}`}>
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <p className="mt-3 text-[15px] font-semibold text-cream-50">
                <T>{s.title}</T>
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-cream-100/55">
                <T>{s.blurb}</T>
              </p>
              {s.meta && (
                <p className="mt-2 font-mono text-[11px] tracking-wide text-gold-metal/70" data-no-translate>
                  {s.meta}
                </p>
              )}
            </>
          );
          const base = `group w-full text-left rounded-xl border p-4 transition-all duration-200 ${
            isActive
              ? 'border-gold-metal/50 bg-forest-900/60 shadow-[0_0_22px_-8px_rgba(198,161,91,0.55)]'
              : 'border-cream-50/10 bg-forest-900/30 hover:border-gold-metal/30 hover:bg-forest-900/55'
          }`;
          return s.href ? (
            <Link key={s.key} href={s.href} className={`${base} block`}>
              {inner}
            </Link>
          ) : (
            <button
              key={s.key}
              type="button"
              aria-expanded={isActive}
              onClick={() => setActive((a) => (a === s.key ? null : s.key))}
              className={base}
            >
              {inner}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="animate-fade-up border-t border-cream-50/10 pt-6">{open.content}</div>
      )}
    </div>
  );
}
