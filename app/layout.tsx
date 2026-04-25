import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';
import { Disclaimer } from '@/components/Disclaimer';
import { UserMenu } from '@/components/UserMenu';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';
import { BrandMark } from '@/components/BrandMark';
import { SearchPalette, SearchTrigger } from '@/components/SearchPalette';

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
        <header className="sticky top-0 z-20">
          {/* Top row: logo + search + avatar. Lifted on z so the avatar menu
              can drop down OVER the secondary subheader. */}
          <div className="relative z-30 border-b border-forest-700/40 bg-forest-950/95 backdrop-blur-md">
            <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2.5 group">
                <span className="text-gold-500 group-hover:text-gold-400 transition-colors">
                  <BrandMark size={28} />
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="font-semibold tracking-[0.08em] text-[15px] text-cream-100 uppercase">
                    Advottic
                  </span>
                  <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-gold-400">
                    <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    AI · LEGAL · CASE-READY
                  </span>
                </span>
              </Link>
              <div className="flex items-center gap-1">
                <SearchTrigger />
                <div className="hidden sm:block h-5 w-px bg-cream-100/15 mx-2" />
                <UserMenu />
              </div>
            </div>
          </div>
          {/* Secondary row: lighter forest, nav links. Sits below z so it
              doesn't trap dropdowns from the top row. */}
          <div className="relative z-10 border-b border-forest-700/30 bg-forest-900/65 backdrop-blur">
            <div className="mx-auto max-w-6xl px-6 py-1.5 flex items-center gap-1 text-sm overflow-x-auto">
              <Link href="/cases/new" className="nav-link">
                New case
              </Link>
              <Link href="/cases" className="nav-link">
                Cases
              </Link>
              <Link href="/cases?filter=shared" className="nav-link">
                Shared with me
              </Link>
              <Link href="/find-counsel" className="nav-link">
                Find counsel near me
              </Link>
            </div>
          </div>
        </header>
        <SearchPalette />
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

