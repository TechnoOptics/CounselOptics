import Link from 'next/link';
import type { Metadata } from 'next';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Not-found boundary for /portal/**, the Hub twin of
 * app/counsel/not-found.tsx.
 *
 * Without this file, notFound() from app/portal/[id] (an unknown request
 * id), from app/portal/forms/[id], or from the catch-all next to them
 * bubbled to the global app/not-found.tsx, which renders OUTSIDE
 * app/portal/layout.tsx. An employee following a stale link from an email
 * was dropped onto a full-bleed cream consumer page with no rail, no
 * company mark and none of the dark Hub shell, which reads as being thrown
 * out of the workspace rather than as a dead link.
 *
 * The two recovery links are the only rail rows every Hub variant keeps:
 * an external collaborator's minimal Hub hides requests, calendar and
 * trainings, but always has Home and Help.
 */
export const metadata: Metadata = {
  title: 'Not found · Portal',
  robots: { index: false, follow: false },
};

export default function PortalNotFound() {
  return (
    <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300">
        404
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium tracking-[-0.01em] text-cream-100 sm:text-4xl">
        <T>We could not find that page.</T>
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-cream-100/70">
        <T>
          The link may be stale, or the request may have been closed or moved.
          Nothing you have filed has changed.
        </T>
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/portal"
          className="rounded-md bg-gold-metal px-4 py-2 text-[13px] font-semibold text-forest-950 transition-[filter] hover:brightness-110"
        >
          <T>Back to your hub</T>
        </Link>
        <Link
          href="/portal/help"
          className="rounded-md px-4 py-2 text-[13px] text-cream-100/85 ring-1 ring-forest-700/50 transition-colors hover:bg-forest-800/50 hover:text-cream-100"
        >
          <T>Report a broken link</T>
        </Link>
      </div>
    </section>
  );
}
