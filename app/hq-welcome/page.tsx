import Link from 'next/link';
import type { Metadata } from 'next';
import { BrandMark } from '@/components/BrandMark';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

/**
 * Pre-login briefing for hq.advottic.com root.
 *
 * Per Week-1 audit (item #4): an admin who pastes hq.advottic.com into
 * their browser should land on a thin "you're signing into the admin
 * console" surface before the shared /sign-in form, so they immediately
 * recognize which product / scope they're entering. Without this, the
 * subdomain bounced straight to a generic sign-in that looked identical
 * to the consumer product, which is bad for trust and bad for product
 * disambiguation.
 *
 * This page is reached via a middleware rewrite from hq.advottic.com,
 * so the URL bar still shows hq.advottic.com/ (clean) while the
 * served HTML is /hq-welcome. The Sign-In CTA preserves the post-auth
 * destination via ?next=/admin so the user lands in the HQ console
 * after auth completes.
 *
 * noindex: this is a host-specific landing that has no SEO upside, and
 * we explicitly don't want Google to index hq.advottic.com/ separately
 * from the canonical product surfaces.
 */
export const metadata: Metadata = {
  title: 'Advottic HQ - Admin console',
  description:
    'Sign in to the Advottic HQ admin console. Manage your team, audit logs, billing, and product configuration.',
  alternates: { canonical: '/hq-welcome' },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

export default function HqWelcomePage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full">
        <div className="card-luminous p-8 sm:p-10 relative overflow-hidden">
          <div
            aria-hidden
            className="absolute -right-12 -top-12 text-gold-500 pointer-events-none opacity-[0.08] z-0"
          >
            <BrandMark size={200} />
          </div>
          <div className="relative z-10 space-y-6">
            <div>
              <p className="eyebrow mb-3">HQ admin console</p>
              <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.015em] text-ink-950 leading-[1.05]">
                Sign into Advottic HQ.
              </h1>
              <p className="text-sm text-ink-600 leading-relaxed mt-3">
                HQ is the internal admin console for Advottic staff. From here you
                manage team accounts, audit logs, feature flags, support escalations,
                billing health, and Stripe / Supabase / vendor integrations.
              </p>
            </div>

            <ul className="text-[13px] text-ink-700 dark:text-cream-100/80 space-y-2 leading-snug">
              <li>- Staff sign-in only. Use your Advottic-issued email.</li>
              <li>- SSO via Google or Microsoft, or a one-time email link.</li>
              <li>- Multi-factor authentication is enforced for sensitive actions.</li>
            </ul>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Link
                href="/sign-in?next=%2Fadmin"
                className="btn-primary text-center"
              >
                Continue to HQ sign-in
              </Link>
              <Link
                href={`${SITE_URL}/`}
                className="btn-secondary text-center"
              >
                I&apos;m a client - take me home
              </Link>
            </div>

            <p className="text-xs text-ink-500 leading-relaxed pt-3 border-t border-ink-100 dark:border-forest-700/40">
              Looking for your firm&apos;s workspace? That lives at{' '}
              <Link
                href="https://enterprise.advottic.com"
                className="underline underline-offset-2"
              >
                enterprise.advottic.com
              </Link>
              . Looking for case prep as an individual?{' '}
              <Link href={SITE_URL} className="underline underline-offset-2">
                Start at advottic.com
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
