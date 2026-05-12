import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Branded 404. Replaces the default Next.js fallback the audit
 * flagged on 2026-05-12 ("404: This page could not be found.").
 *
 * Kept intentionally minimal: the chrome from app/layout.tsx
 * already supplies the header, sidebar (when signed-in + app
 * route), and footer. This page only paints the inside of the
 * <main> slot so we don't fight the layout.
 *
 * No noindex: a single 404 page is harmless for crawlers and
 * sometimes useful (people link to dead routes). The HTTP 404
 * status is what tells search engines to drop the URL.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  description:
    "We couldn't find that page on Advottic. Try the dashboard, the directory, or send us a quick note if you think this is a bug.",
  // Crawlers should not index the 404 itself, but should follow
  // the helpful links back into the product.
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl py-16 sm:py-24 text-center px-4">
      <p className="eyebrow text-gold-700 dark:text-amber-300">404</p>
      <h1 className="font-display text-3xl sm:text-5xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-2">
        That page slipped past us.
      </h1>
      <p className="mt-4 text-[14px] sm:text-[15px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        The link may be stale or the page may have moved. None of
        your case data is affected. Here&rsquo;s where most people
        are headed:
      </p>

      <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-left">
        <NotFoundLink
          href="/cases"
          title="Your cases"
          blurb="Open and recent matters."
        />
        <NotFoundLink
          href="/cases/new"
          title="Start a new case"
          blurb="Two minutes to a working file."
        />
        <NotFoundLink
          href="/find-counsel"
          title="Find counsel"
          blurb="Lawyers near you by practice area."
        />
        <NotFoundLink
          href="/pricing"
          title="Pricing"
          blurb="Consumer and firm tiers."
        />
        <NotFoundLink
          href="/about"
          title="About Advottic"
          blurb="What this is, and isn't."
        />
        <NotFoundLink
          href="/feedback"
          title="Report a broken link"
          blurb="If you got here from inside Advottic."
        />
      </ul>

      <p className="mt-10 text-[12px] text-ink-500 dark:text-cream-100/55">
        Or head back to the{' '}
        <Link
          href="/"
          className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
        >
          homepage
        </Link>
        .
      </p>
    </section>
  );
}

function NotFoundLink({
  href,
  title,
  blurb,
}: {
  href: string;
  title: string;
  blurb: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 p-4 hover:ring-gold-metal dark:hover:ring-amber-500/60 transition-colors"
      >
        <p className="font-medium text-forest-900 dark:text-cream-100 text-[14px]">
          {title} →
        </p>
        <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 mt-0.5 leading-snug">
          {blurb}
        </p>
      </Link>
    </li>
  );
}
