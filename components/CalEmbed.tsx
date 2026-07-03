'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from '@/components/ExternalLink';

/**
 * Lightweight Cal.com inline scheduler. Renders the booking iframe at the
 * configured event link. Reads NEXT_PUBLIC_CAL_LINK at build time (form:
 * "owner/event-slug", e.g. "advottic/intro-call"). When the env var is
 * unset, renders a graceful fallback card pointing the user at the
 * external counsel directory above.
 *
 * We intentionally use a plain iframe rather than the Cal.com embed
 * script: it avoids pulling third-party JS into the page bundle and
 * keeps the layout deterministic on first paint. Trade-off: no
 * ResizeObserver-driven height auto-fit; the iframe sits at a fixed
 * 700px which works for the standard event-type page.
 */
export function CalEmbed({ link }: { link?: string }) {
  const calLink = link ?? process.env.NEXT_PUBLIC_CAL_LINK;
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    setTheme(mql.matches ? 'dark' : 'light');
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  if (!calLink) {
    return (
      <div className="card p-6 sm:p-8">
        <p className="eyebrow mb-2">Free intro consultation</p>
        <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Book a 15-minute call before retaining anyone.
        </h3>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed max-w-xl">
          Once you've narrowed down a few firms above, schedule a no-pressure intro call.
          Bring your packet, we will not pitch you, and you walk out with a clearer next
          step. Configure your Cal.com event link via{' '}
          <code className="font-mono text-[11px] bg-ink-100 dark:bg-forest-800 px-1.5 py-0.5 rounded">
            NEXT_PUBLIC_CAL_LINK
          </code>{' '}
          to enable inline scheduling here.
        </p>
      </div>
    );
  }

  const src = `https://cal.com/${calLink}?embed=true&theme=${theme}&layout=month_view`;

  return (
    <div className="card overflow-hidden">
      <div className="bg-gradient-to-br from-forest-900 via-forest-900 to-forest-950 px-5 py-4 text-cream-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
            Schedule
          </p>
          <p className="font-display text-lg font-medium mt-0.5">Book a 15-minute intro</p>
        </div>
        <ExternalLink
          href={`https://cal.com/${calLink}`}
          className="text-[11px] text-cream-100/70 hover:text-cream-100 underline-offset-2 hover:underline"
        >
          Open in new tab
        </ExternalLink>
      </div>
      <iframe
        src={src}
        title="Schedule a consultation"
        loading="lazy"
        className="w-full h-[700px] border-0 bg-white dark:bg-forest-950"
      />
    </div>
  );
}
