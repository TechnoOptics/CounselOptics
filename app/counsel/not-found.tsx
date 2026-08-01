import Link from 'next/link';
import type { Metadata } from 'next';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Not-found boundary for /counsel/**.
 *
 * Without this file, notFound() from any counsel route bubbled to the
 * global app/not-found.tsx, which renders OUTSIDE app/counsel/layout.tsx.
 * A firm user who mistyped a matter id was thrown onto a full-bleed cream
 * page with no rail, no firm logo and none of the dark shell - counsel
 * wording inside consumer chrome, which reads as being ejected from the
 * product rather than as a dead link. Living here, the same 404 keeps the
 * header, the rail and the firm's brand, so the workspace never blinks.
 *
 * It deliberately offers only the dashboard as a way back. A firm can hide
 * structural rows (Cases, Documents, Templates...) from its own rail, and
 * the old page recommended "Cases →" to firms that had done exactly that.
 */
export const metadata: Metadata = {
  title: 'Not found · Counsel',
  robots: { index: false, follow: false },
};

export default function CounselNotFound() {
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
          The link may be stale, or the matter may have been archived or moved
          to another firm. Nothing in your firm&rsquo;s records has changed.
        </T>
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/counsel"
          className="rounded-md bg-gold-metal px-4 py-2 text-[13px] font-semibold text-forest-950 transition-[filter] hover:brightness-110"
        >
          <T>Back to your dashboard</T>
        </Link>
        <Link
          href="/counsel/help"
          className="rounded-md px-4 py-2 text-[13px] text-cream-100/85 ring-1 ring-forest-700/50 transition-colors hover:bg-forest-800/50 hover:text-cream-100"
        >
          <T>Report a broken link</T>
        </Link>
      </div>
    </section>
  );
}
