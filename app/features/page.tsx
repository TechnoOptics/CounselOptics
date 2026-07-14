import Link from 'next/link';
import type { Metadata } from 'next';
import { FeatureSheet } from '@/components/marketing/FeatureSheet';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'See everything Advottic does before you make an account. Case rooms, auto-numbered exhibits, Advottic Review, Safe Witness for people; branded intake, evidence relevance, CourtListener-verified legal review, trust accounting, and in-portal signing for law firms.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Everything Advottic does, in plain sight',
    description:
      'A full feature sheet for both products: calm case preparation for people handling their own matter, and a practice-management workspace for law firms.',
    url: '/features',
    type: 'website',
  },
};

/**
 * Public feature sheet. Lets a visitor see the whole product, for both people
 * and law firms, before creating an account. The hero states the promise
 * plainly; FeatureSheet carries the segmented showcases (with faithful product
 * mockups) and the complete, scannable feature matrix.
 */
export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero */}
      <section className="relative animate-fade-up pt-2 text-center">
        <p className="inline-flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-700 dark:text-gold-300">
          <span className="inline-block h-px w-8 bg-gold-500 dark:bg-gold-400" />
          Features, no account needed
          <span className="inline-block h-px w-8 bg-gold-500 dark:bg-gold-400" />
        </p>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-[40px] font-medium leading-[1.02] tracking-[-0.02em] text-forest-900 dark:text-cream-100 sm:text-[58px] text-balance">
          Everything Advottic does,{' '}
          <span className="bg-gold-shine bg-clip-text italic text-transparent gold-pan">in plain sight.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-ink-600 dark:text-cream-100/80">
          Two products held to one calm standard: a place for people to prepare their own matter, and a
          practice-management workspace for law firms. Look through every capability, with real screens from
          the product.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/cases/new"
            className="btn bg-gold-metal px-5 py-2.5 font-semibold text-forest-950 shadow-gold-glow hover:brightness-110"
          >
            Start a case free
          </Link>
          <Link
            href="/pricing"
            className="btn-ghost px-3 py-2.5 font-semibold text-forest-900 underline-offset-4 hover:underline dark:text-cream-100"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-6 text-[12px] text-ink-500 dark:text-cream-100/55">
          Advottic prepares. An attorney advises. You decide.
        </p>
      </section>

      {/* The sheet */}
      <div className="mt-16 sm:mt-20">
        <FeatureSheet />
      </div>
    </div>
  );
}
