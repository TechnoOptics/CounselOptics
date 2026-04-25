import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Inter, Saira_Condensed } from 'next/font/google';
import './globals.css';
import { Disclaimer } from '@/components/Disclaimer';
import { UserMenu } from '@/components/UserMenu';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';
import { SearchPalette, SearchTrigger } from '@/components/SearchPalette';
import { ConsentModal } from '@/components/ConsentModal';
import { Sidebar, MobileNav } from '@/components/Sidebar';
import { BrandMark } from '@/components/BrandMark';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Wordmark fallback (Saira Condensed) loads via Google Fonts. The "real"
// Conquera font is registered via @font-face in globals.css and points at
// /fonts/conquera.woff2 — once that file is dropped into public/fonts the
// browser will pick it up automatically, otherwise it falls through to the
// CSS variable below. See globals.css for the @font-face declaration.
const wordmark = Saira_Condensed({
  subsets: ['latin'],
  weight: ['700', '800'],
  display: 'swap',
  variable: '--font-wordmark',
});

export const metadata: Metadata = {
  title: 'Advottic',
  description:
    'Organize evidence, surface jurisdiction-aware issues with Legal Eye, prepare for hearings, and ship a packet your attorney can read in five minutes.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Decide whether to mount the consent popup AND whether the user is signed
  // in (so we can gate the search trigger + sidebar/mobile-nav on auth).
  // Server-side so the navigation HTML literally isn't shipped to logged-out
  // visitors, and stays gone after refresh.
  let consent: { needed: false } | { needed: true; fallbackName: string } = { needed: false };
  let signedIn = false;
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
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
    <html lang="en" className={`${sans.variable} ${wordmark.variable}`}>
      <body className="min-h-screen flex flex-col font-sans">
        <Disclaimer variant="banner" />
        <header className="sticky top-0 z-20">
          {/* Top row: logo + search + avatar. Lifted on z so the avatar menu
              can drop down OVER the secondary subheader. */}
          <div className="relative z-30 border-b border-forest-700/40 bg-forest-950/95 backdrop-blur-md">
            <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
              <Link
                href="/"
                aria-label="Advottic home"
                className="inline-flex items-center gap-3 group"
              >
                {/* Gold pillar mark */}
                <span className="text-gold-400 group-hover:text-gold-300 transition-colors">
                  <BrandMark size={32} />
                </span>
                {/* ADVOTTIC wordmark in Conquera (or Saira Condensed fallback) */}
                <span
                  className="text-cream-100 text-[22px] sm:text-[24px] leading-none tracking-[0.06em] font-extrabold"
                  // Conquera (licensed) → Saira Condensed (Google fallback)
                  style={{ fontFamily: "'Conquera', var(--font-wordmark), sans-serif" }}
                >
                  ADVOTTIC
                </span>
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.18em] text-gold-400 ml-1">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  LEGAL EYE · LEGAL · CASE-READY
                </span>
              </Link>
              <div className="flex items-center gap-1">
                {signedIn && <SearchTrigger />}
                {signedIn && <div className="hidden sm:block h-5 w-px bg-cream-100/15 mx-2" />}
                <UserMenu />
              </div>
            </div>
          </div>
          {/* Mobile-only: hamburger-led nav. Only shown to signed-in users
              since marketing visitors don't have anywhere to navigate to yet. */}
          {signedIn && (
            <Suspense fallback={null}>
              <MobileNav />
            </Suspense>
          )}
        </header>
        {signedIn && <SearchPalette />}
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10 flex gap-6 lg:gap-8 items-start">
            {signedIn && (
              <Suspense fallback={null}>
                <Sidebar />
              </Suspense>
            )}
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
                  href="mailto:contact@advottic.com"
                >
                  contact@advottic.com
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

