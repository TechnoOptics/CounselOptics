import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';
import { Disclaimer } from '@/components/Disclaimer';
import { UserMenu } from '@/components/UserMenu';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';
import { SearchPalette, SearchTrigger } from '@/components/SearchPalette';
import { ConsentModal } from '@/components/ConsentModal';
import { Sidebar, MobileNav } from '@/components/Sidebar';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Advottic',
  description:
    'Organize evidence, surface jurisdiction-aware issues with Legal Eye, prepare for hearings, and ship a packet your attorney can read in five minutes.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Decide whether to mount the consent popup. Server-side so the modal HTML
  // is gone for users who've already consented and stays gone after refresh.
  let consent: { needed: false } | { needed: true; fallbackName: string } = { needed: false };
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        const profile = await getProfile().catch(() => null);
        if (!profile?.consentedAt) {
          consent = {
            needed: true,
            fallbackName:
              (user.user_metadata?.full_name as string | undefined) ??
              (user.user_metadata?.name as string | undefined) ??
              user.email ??
              '',
          };
        }
      }
    } catch {
      // never block render on a profile-lookup failure
    }
  }

  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-screen flex flex-col font-sans">
        <Disclaimer variant="banner" />
        <header className="sticky top-0 z-20">
          {/* Top row: logo + search + avatar. Lifted on z so the avatar menu
              can drop down OVER the secondary subheader. */}
          <div className="relative z-30 border-b border-forest-700/40 bg-forest-950/95 backdrop-blur-md">
            <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
              <Link href="/" aria-label="Advottic home" className="inline-flex items-center gap-3 group">
                <span className="inline-flex items-center bg-white rounded-md px-2.5 py-1 shadow-sm ring-1 ring-cream-100/30 transition-shadow group-hover:shadow-card-hover">
                  <Image
                    src="/advottic-logo.png"
                    alt="Advottic"
                    width={457}
                    height={265}
                    priority
                    className="h-9 w-auto block"
                  />
                </span>
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-gold-400">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  LEGAL EYE · LEGAL · CASE-READY
                </span>
              </Link>
              <div className="flex items-center gap-1">
                <SearchTrigger />
                <div className="hidden sm:block h-5 w-px bg-cream-100/15 mx-2" />
                <UserMenu />
              </div>
            </div>
          </div>
          {/* Mobile-only: horizontal nav row that mirrors the desktop sidebar.
              Hidden on md+ where the sidebar takes over. */}
          <Suspense fallback={null}>
            <MobileNav />
          </Suspense>
        </header>
        <SearchPalette />
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10 flex gap-6 lg:gap-8 items-start">
            <Suspense fallback={null}>
              <Sidebar />
            </Suspense>
            <div className="flex-1 min-w-0">{children}</div>
          </div>
        </main>
        <Bella />
        {consent.needed && <ConsentModal fallbackName={consent.fallbackName} />}
        <CookieBanner />
        <footer className="border-t border-ink-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-8 text-xs text-ink-500">
            <div className="grid gap-8 md:grid-cols-4">
              <div className="space-y-2">
                <p className="font-semibold text-forest-900 tracking-[0.05em] uppercase text-[11px]">
                  Advottic
                </p>
                <p className="leading-relaxed">
                  Legal information &amp; case organization. Not a law firm. Not legal advice.
                </p>
                <p className="leading-relaxed">
                  Need a human?{' '}
                  <a
                    className="underline hover:text-forest-900"
                    href="https://wa.me/19253001600"
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp +1 (925) 300-1600
                  </a>
                </p>
              </div>
              <FooterCol title="Product">
                <Link href="/cases" className="hover:text-forest-900 block">Cases</Link>
                <Link href="/cases/new" className="hover:text-forest-900 block">New case</Link>
                <Link href="/find-counsel" className="hover:text-forest-900 block">Find counsel</Link>
                <Link href="/billing" className="hover:text-forest-900 block">Billing</Link>
              </FooterCol>
              <FooterCol title="Legal">
                <Link href="/terms" className="hover:text-forest-900 block">Terms of use</Link>
                <Link href="/privacy" className="hover:text-forest-900 block">Privacy policy</Link>
                <Link href="/cookies" className="hover:text-forest-900 block">Cookie policy</Link>
                <Link href="/dmca" className="hover:text-forest-900 block">DMCA / IP policy</Link>
                <Link href="/security" className="hover:text-forest-900 block">Security</Link>
                <Link href="/accessibility" className="hover:text-forest-900 block">Accessibility</Link>
              </FooterCol>
              <FooterCol title="Contact">
                <a
                  className="hover:text-forest-900 block"
                  href="mailto:contact@technooptics.com"
                >
                  contact@technooptics.com
                </a>
                <span className="block">Operated from Minnesota, USA.</span>
                <span className="block">Disputes resolved by binding individual arbitration; class-action and jury waivers in Section 4 of the Terms.</span>
              </FooterCol>
            </div>
            <div className="mt-8 pt-5 border-t border-ink-100 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono tracking-tight">
                © {new Date().getFullYear()} Techno Optics LLC. All rights reserved.
              </p>
              <p className="text-ink-400">
                Powered by{' '}
                <span className="font-semibold text-forest-900">Techno Optics LLC</span>
              </p>
            </div>
            <p className="mt-4 text-[10.5px] leading-relaxed text-ink-400 max-w-3xl">
              Advottic is a service of Techno Optics LLC. Legal Eye and Bella generate
              informational content using AI; outputs may be incomplete, outdated, or wrong and
              are not legal advice. Always consult a licensed attorney in your jurisdiction
              before acting. If you face possible incarceration, request a public defender at
              your first court appearance.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-forest-900 tracking-[0.05em] uppercase text-[11px]">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

