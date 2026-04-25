import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';
import { Disclaimer } from '@/components/Disclaimer';
import { UserMenu } from '@/components/UserMenu';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Advottic',
  description:
    'Organize evidence, build exhibit packets, and surface jurisdiction-aware legal issues for your attorney.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen flex flex-col font-sans">
        <Disclaimer variant="banner" />
        <header className="sticky top-0 z-20 border-b border-forest-100 bg-white/85 backdrop-blur-md">
          <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <span className="brand-mark inline-flex h-9 w-9 items-center justify-center rounded-lg text-cream-200 shadow-brand-glow">
                <ScalesIcon />
              </span>
              <span className="flex items-baseline gap-2">
                <span className="font-semibold tracking-tight text-[15px] text-forest-900">
                  Advottic
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-forest-700">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  v1
                </span>
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/cases" className="btn-ghost">
                Cases
              </Link>
              <Link href="/cases/new" className="btn-primary">
                New case
              </Link>
              <div className="hidden sm:block h-5 w-px bg-ink-200 mx-2" />
              <UserMenu />
            </nav>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
        </main>
        <Bella />
        <CookieBanner />
        <footer className="border-t border-ink-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-ink-500 flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono tracking-tight">
              Advottic · Legal information & case organization
            </span>
            <nav className="flex items-center gap-4">
              <Link href="/privacy" className="hover:text-forest-900">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-forest-900">
                Terms
              </Link>
              <span>Not legal advice.</span>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}

function ScalesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* Center pillar */}
      <path d="M12 4v16M9 20h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* Crossbar */}
      <path d="M5 7h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {/* Left scale */}
      <path d="M5 7l-2.5 5.2c.4 1.4 1.6 2.3 2.5 2.3s2.1-.9 2.5-2.3L5 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {/* Right scale */}
      <path d="M19 7l-2.5 5.2c.4 1.4 1.6 2.3 2.5 2.3s2.1-.9 2.5-2.3L19 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {/* Top knob */}
      <circle cx="12" cy="4" r="1.2" fill="currentColor" />
    </svg>
  );
}
