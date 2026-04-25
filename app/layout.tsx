import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';
import { Disclaimer } from '@/components/Disclaimer';
import { UserMenu } from '@/components/UserMenu';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'CounselOptics',
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
              <span className="brand-mark inline-flex h-8 w-8 items-center justify-center rounded-lg text-cream-200 text-[13px] font-semibold tracking-tight shadow-brand-glow">
                CO
              </span>
              <span className="font-semibold tracking-tight text-[15px] text-forest-900">
                CounselOptics
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
        <footer className="border-t border-ink-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-ink-500 flex flex-wrap items-center justify-between gap-2">
            <span>CounselOptics · Legal information and case organization.</span>
            <span>Not legal advice.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
