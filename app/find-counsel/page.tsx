import type { Metadata } from 'next';
import { FindCounselClient } from './find-counsel-client';
import { ConnectAdvotticForm } from './connect-advottic';

export const metadata: Metadata = {
  title: 'Find counsel near you',
  description:
    'Get matched with a law firm on Advottic Counsel, or browse nearby firms via Google Maps. Free directory, no account required.',
  alternates: { canonical: '/find-counsel' },
  openGraph: {
    title: 'Find counsel near you · Advottic',
    description:
      'Get matched with a vetted Advottic firm in your state, or browse nearby attorneys and civil legal-aid offices on Google Maps.',
    url: '/find-counsel',
    type: 'website',
  },
  keywords: [
    'find a lawyer near me',
    'find counsel',
    'attorneys near me',
    'lawyer referral',
    'civil legal aid',
    'law firm directory',
  ],
};

export default function FindCounselPage() {
  return (
    <div className="space-y-10 animate-fade-up">
      <header>
        <p className="eyebrow mb-2">Counsel finder</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Find counsel near you
        </h1>
        <p className="text-sm text-ink-600 mt-2 max-w-2xl leading-relaxed">
          Two ways to find a lawyer: get matched directly with an Advottic
          firm in your state, or browse nearby firms on Google Maps. Free,
          no account required for either.
        </p>
      </header>

      {/* Marketplace lead form. Notifies matching Advottic Counsel firms
          when the consumer submits a brief about their matter. */}
      <ConnectAdvotticForm />

      <section className="space-y-3">
        <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
          Or browse the public directory
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 max-w-2xl leading-relaxed">
          The map below pulls from Google&rsquo;s public business listings.
          Firms shown here are not vetted by Advottic and may or may not be
          on our platform.
        </p>
      </section>
      <FindCounselClient />
    </div>
  );
}
