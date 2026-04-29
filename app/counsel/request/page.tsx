import Link from 'next/link';
import { RequestForm } from './request-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Request Advottic Counsel access',
  description:
    'Counsel is invitation-only. Tell us about your firm or legal team and we will personally reach out with a setup link if approved.',
};

/**
 * Public application form for organizations interested in Advottic
 * Counsel. NOT auth-gated. The Advottic team reviews each request
 * personally and emails a single-use setup link to approved
 * applicants. No self-service signup.
 */
export default function CounselRequestPage() {
  return (
    <div className="dark counsel-shell min-h-screen text-cream-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-6 animate-fade-up">
        <header className="text-center space-y-3">
          <p className="text-[10px] uppercase tracking-[0.32em] font-semibold text-gold-300">
            Advottic Counsel
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-medium tracking-[-0.02em] leading-[1.05]">
            Counsel is{' '}
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
              invitation only.
            </span>
          </h1>
          <p className="text-sm sm:text-base text-cream-100/80 max-w-xl mx-auto leading-relaxed">
            We onboard each organization personally so the workspace is configured
            correctly, your data is segregated, and your team gets a real handshake from
            the people who built this. Tell us about your team below and we will reach
            out within a business day.
          </p>
        </header>

        <RequestForm />

        <p className="text-center text-[12px] text-cream-100/55">
          Not sure if Counsel is the right fit?{' '}
          <a
            href="mailto:contact@advottic.com"
            className="underline hover:text-cream-100"
          >
            Email us
          </a>{' '}
          and we&rsquo;ll talk it through.
        </p>
        <p className="text-center text-[12px] text-cream-100/55">
          Looking for the personal app instead?{' '}
          <Link href="/" className="underline hover:text-cream-100">
            Advottic for individuals
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
