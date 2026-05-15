import type { Metadata } from 'next';
import Link from 'next/link';
import { ReviewDocumentClient } from './review-client';

export const metadata: Metadata = {
  title: 'Free document review · Plain-English explanation',
  description:
    'Paste a contract, lease, demand letter, or court order. Bella, our AI assistant, will explain it in plain English and flag what to watch for. No account, no card, no training on your data.',
  alternates: { canonical: '/review-my-document' },
  openGraph: {
    title: 'Free document review',
    description:
      'Paste a contract, lease, or court order and get a plain-English explanation. No account, no card, no training on your data.',
    url: '/review-my-document',
    type: 'website',
  },
  keywords: [
    'review my contract',
    'plain english contract',
    'understand my lease',
    'demand letter explained',
    'court summons explained',
    'free legal document review',
  ],
};

export default function ReviewMyDocumentPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      <header className="text-center">
        <p className="eyebrow mb-3 justify-center">Free, no account</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Paste the document.<br />
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            Get it in plain English.
          </span>
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 mt-4 leading-relaxed max-w-xl mx-auto">
          Drop in a contract, lease, demand letter, retainer, or court order. Bella will explain
          what it actually says, flag what's worth a second look, and suggest the right
          questions to ask before you sign or respond.
        </p>
      </header>

      <ReviewDocumentClient />

      <section className="grid gap-3 sm:grid-cols-3 text-center">
        <Trust label="No account" body="Free to try without signing in." />
        <Trust
          label="Yours alone"
          body="Your text is never used to improve any outside service."
        />
        <Trust
          label="Not legal advice"
          body="Plain-English explanation, not a lawyer's opinion."
        />
      </section>

      <section className="card p-6 sm:p-8 text-center">
        <p className="eyebrow mb-2 justify-center">Want to organize a real case?</p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Build a case file an attorney can read in five minutes.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-xl mx-auto">
          A real Advottic case file holds your exhibits, runs a thorough review, tracks your
          hearing, and exports a clean PDF packet for counsel.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/sign-in"
            className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-5 py-2.5"
          >
            Start a case file
          </Link>
          <Link href="/example" className="btn-secondary px-5 py-2.5">
            See an example
          </Link>
        </div>
      </section>
    </div>
  );
}

function Trust({ label, body }: { label: string; body: string }) {
  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {label}
      </p>
      <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-1.5 leading-relaxed">
        {body}
      </p>
    </div>
  );
}
