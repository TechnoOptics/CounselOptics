import Link from 'next/link';
import { headers } from 'next/headers';
import type { Metadata } from 'next';

/**
 * Branded 404. Replaces the default Next.js fallback the audit
 * flagged on 2026-05-12.
 *
 * Audit W20 V3 CR-34: the 404 page used to render consumer-only
 * CTAs (Your cases, Find counsel, Pricing, About) and strip the
 * counsel / staff chrome. A firm Owner or HQ staff member hitting
 * a 404 would see suggestions oriented at a self-represented
 * litigant - disorienting and unhelpful.
 *
 * Now: the page reads the effective pathname forwarded by
 * middleware via the `x-pathname` header and renders one of three
 * variants:
 *
 *   - STAFF (path starts with /admin)      -> HQ-relevant CTAs
 *   - FIRM  (path starts with /counsel)    -> Counsel-relevant CTAs
 *   - CONSUMER (everything else / default) -> Original consumer CTAs
 *
 * The variants share the same shell so the visual identity is
 * uniform; only the link set + a one-line subtitle differs.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  description:
    "We couldn't find that page on Advottic. Try the dashboard, the directory, or send us a quick note if you think this is a bug.",
  // Crawlers should not index the 404 itself, but should follow
  // the helpful links back into the product.
  robots: { index: false, follow: true },
};

type Audience = 'staff' | 'firm' | 'consumer';

function detectAudience(): Audience {
  // The middleware sets x-pathname to the EFFECTIVE prefixed path
  // (e.g. /admin/operations even on hq.advottic.com where the URL
  // bar shows /operations). Falls back to consumer if no header.
  const path = headers().get('x-pathname') ?? '';
  if (path === '/admin' || path.startsWith('/admin/')) return 'staff';
  if (path === '/counsel' || path.startsWith('/counsel/')) return 'firm';
  return 'consumer';
}

const NOT_FOUND_LINKS: Record<
  Audience,
  Array<{ href: string; title: string; blurb: string }>
> = {
  consumer: [
    { href: '/cases', title: 'Your cases', blurb: 'Open and recent matters.' },
    { href: '/cases/new', title: 'Start a new case', blurb: 'Two minutes to a working file.' },
    { href: '/find-counsel', title: 'Find counsel', blurb: 'Lawyers near you by practice area.' },
    { href: '/pricing', title: 'Pricing', blurb: 'Consumer and firm tiers.' },
    { href: '/about', title: 'About Advottic', blurb: "What this is, and isn't." },
    { href: '/feedback', title: 'Report a broken link', blurb: 'If you got here from inside Advottic.' },
  ],
  firm: [
    { href: '/counsel', title: 'Firm dashboard', blurb: 'Open matters, recent activity, team.' },
    { href: '/counsel/cases', title: 'Cases', blurb: 'Every matter linked to the firm.' },
    { href: '/counsel/intake', title: 'New intake', blurb: 'Open a new matter with conflict check.' },
    { href: '/counsel/settings', title: 'Firm settings', blurb: 'Name, brand, jurisdictions, webhooks.' },
    { href: '/counsel/chat', title: 'Team conversations', blurb: 'Channels, DMs, and matter rooms.' },
    { href: '/feedback', title: 'Report a broken link', blurb: 'Tell us how you got here.' },
  ],
  staff: [
    { href: '/admin', title: 'HQ overview', blurb: 'Business cockpit + lenses.' },
    { href: '/admin/operations', title: 'Operations', blurb: 'System health + Security pulse.' },
    { href: '/admin/crashes', title: 'Crash reports', blurb: 'Recent browser-side errors.' },
    { href: '/admin/consumer', title: 'Consumer', blurb: 'Personal users + signups.' },
    { href: '/admin/counsel', title: 'Counsel', blurb: 'Firm tenants + memberships.' },
    { href: '/feedback', title: 'Report a broken link', blurb: 'Internal staff feedback.' },
  ],
};

const NOT_FOUND_SUBTITLE: Record<Audience, string> = {
  consumer:
    'The link may be stale or the page may have moved. None of your case data is affected.',
  firm: 'The link may be stale or the matter may have been archived. Your firm data is untouched.',
  staff: 'The route may have been renamed. Recent renames are in /admin/operations.',
};

const NOT_FOUND_HOME_LINK: Record<Audience, { href: string; label: string }> = {
  consumer: { href: '/', label: 'homepage' },
  firm: { href: '/counsel', label: 'firm dashboard' },
  staff: { href: '/admin', label: 'HQ overview' },
};

export default function NotFound() {
  const audience = detectAudience();
  const links = NOT_FOUND_LINKS[audience];
  return (
    <section className="mx-auto max-w-2xl py-16 sm:py-24 text-center px-4">
      <p className="eyebrow text-gold-700 dark:text-amber-300">404</p>
      <h1 className="font-display text-3xl sm:text-5xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-2">
        That page slipped past us.
      </h1>
      <p className="mt-4 text-[14px] sm:text-[15px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
        {NOT_FOUND_SUBTITLE[audience]} Here&rsquo;s where most people are headed:
      </p>

      <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-left">
        {links.map((l) => (
          <NotFoundLink key={l.href} href={l.href} title={l.title} blurb={l.blurb} />
        ))}
      </ul>

      <p className="mt-10 text-[12px] text-ink-500 dark:text-cream-100/55">
        Or head back to the{' '}
        <Link
          href={NOT_FOUND_HOME_LINK[audience].href}
          className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
        >
          {NOT_FOUND_HOME_LINK[audience].label}
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
