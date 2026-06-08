import type { Metadata } from 'next';
import { StatuteOfLimitationsChecker } from '../../tools/statute-of-limitations/StatuteOfLimitationsChecker';

export const dynamic = 'force-static';

/**
 * Embeddable SOL checker. Loaded inside an iframe on other
 * sites (legal aid orgs, tenant unions, freelancer blogs).
 *
 * Why this matters: every embed = a perpetual backlink with
 * a brand mention. Nobody in legal-tech ships embeddable
 * widgets; we own the surface by being first.
 *
 * Render rules:
 *   - No header, no footer, no nav. The host site provides
 *     chrome.
 *   - Compact padding so it fits 600x800-ish iframes.
 *   - Subtle "powered by Advottic" attribution at the
 *     bottom that links back, giving us the backlink.
 *   - X-Frame-Options is overridden by next.config to allow
 *     framing on this path (and only this path).
 */
export const metadata: Metadata = {
  title: { absolute: 'SOL checker (embed)' },
  description:
    'Embeddable statute of limitations checker. Free for any site to use.',
  alternates: { canonical: '/embed/statute-of-limitations' },
  robots: { index: false, follow: true },
  other: {
    'X-Embeddable': 'true',
  },
};

export default function EmbedSolPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-forest-950 text-ink-800 dark:text-cream-100 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <header className="space-y-1">
          <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Statute of limitations checker
          </p>
          <h1 className="font-display text-[24px] sm:text-[28px] font-medium leading-tight text-forest-900 dark:text-cream-100">
            How long do I have to sue?
          </h1>
        </header>

        <StatuteOfLimitationsChecker />

        <footer className="pt-3 border-t border-ink-200 dark:border-forest-700/40 text-[11px] text-ink-500 dark:text-cream-100/55 flex justify-between items-center">
          <span>50 states + DC. Updated 2026.</span>
          <a
            href="https://advottic.com/tools/statute-of-limitations?ref=embed"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-forest-900 dark:hover:text-cream-100"
          >
            Powered by Advottic
          </a>
        </footer>
      </div>
    </main>
  );
}
