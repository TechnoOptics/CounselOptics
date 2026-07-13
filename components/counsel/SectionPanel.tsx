'use client';

import { useRef, useState, type ReactNode } from 'react';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * A single collapsible matter section, styled as a firm black + gold tile.
 * The tile header is the always-visible summary; clicking it reveals the
 * section's content, which is passed as CHILDREN (not a prop) so it always
 * renders across the server/client boundary. Independent open state per panel.
 */
export function SectionPanel({
  title,
  blurb,
  meta,
  icon,
  defaultOpen = false,
  reportCaseId,
  children,
}: {
  title: string;
  blurb: string;
  meta?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  /** When set, the FIRST time this panel is opened is reported to the case
   *  activity stream (so the firm sees a guest opened the section). */
  reportCaseId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const reported = useRef(false);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      if (next && reportCaseId && !reported.current) {
        reported.current = true;
        // Best-effort: never block the UI on the log write.
        void fetch('/api/counsel/activity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: reportCaseId, action: 'open_section', detail: { section: title } }),
          keepalive: true,
        }).catch(() => {});
      }
      return next;
    });
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-colors ${
        open ? 'border-gold-metal/50 bg-forest-900/50' : 'border-cream-50/10 bg-forest-900/30'
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-forest-900/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-metal/12 text-gold-metal ring-1 ring-gold-metal/25">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-cream-50">
            <T>{title}</T>
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-cream-100/55">
            <T>{blurb}</T>
          </span>
        </span>
        {meta && (
          <span className="hidden shrink-0 font-mono text-[11px] tracking-wide text-gold-metal/70 sm:block" data-no-translate>
            {meta}
          </span>
        )}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden
          className={`shrink-0 text-gold-metal/70 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="border-t border-cream-50/10 p-4 sm:p-5">{children}</div>}
    </div>
  );
}
