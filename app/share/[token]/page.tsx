import type { Metadata } from 'next';
import { UnlockForm } from './unlock-form';

// A secure share is reachable only by its token URL; never index it.
export const metadata: Metadata = {
  title: 'Secure document',
  robots: { index: false, follow: false },
};

export default function SharePage({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-[100dvh] bg-[#fafaf8] dark:bg-forest-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-ink-200 dark:border-forest-700/60 bg-white dark:bg-forest-900 p-7 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-500/12 text-gold-600 ring-1 ring-gold-500/25">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <h1 className="text-[15px] font-semibold text-forest-900 dark:text-cream-50">Secure document</h1>
              <p className="text-[12.5px] text-forest-500 dark:text-cream-100/50">Enter the key from your email to open it.</p>
            </div>
          </div>
          <UnlockForm token={params.token} />
          {/* forest-500 for both of these: forest-400 is 3.89:1 on the white
              card and 3.72:1 on the page, and this is the same microcopy tier
              the header above already sets in forest-500. */}
          <p className="mt-5 text-[11.5px] leading-relaxed text-forest-500 dark:text-cream-100/40">
            This document is encrypted. The key was sent to you separately and is required to decrypt it. Please keep it confidential and do not forward this link.
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-forest-500 dark:text-cream-100/30">Secured by Advottic</p>
      </div>
    </main>
  );
}
