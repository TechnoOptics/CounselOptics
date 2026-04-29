import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { Inter, Saira_Condensed, Fraunces } from 'next/font/google';
import './globals.css';
import { UserMenu } from '@/components/UserMenu';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';
import { SearchPalette, SearchTrigger } from '@/components/SearchPalette';
import { ConsentModal } from '@/components/ConsentModal';
import { Sidebar, MobileNav } from '@/components/Sidebar';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ThemeBoot } from '@/components/ThemeBoot';
import { CrashReporter } from '@/components/CrashReporter';
import { FreshnessGuard } from '@/components/FreshnessGuard';
import { TrialBanner } from '@/components/TrialBanner';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import {
  ensureSignupHistory,
  getEffectiveTrialState,
  getProfile,
} from '@/lib/storage';

const sans = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Wordmark fallback (Saira Condensed) loads via Google Fonts. The "real"
// Conquera font is registered via @font-face in globals.css and points at
// /fonts/conquera.woff2 - once that file is dropped into public/fonts the
// browser will pick it up automatically, otherwise it falls through to the
// CSS variable below. See globals.css for the @font-face declaration.
const wordmark = Saira_Condensed({
  subsets: ['latin'],
  weight: ['700', '800'],
  display: 'swap',
  variable: '--font-wordmark',
});

// Editorial display face for marquee headlines (landing hero, big section
// titles, case-detail title). Fraunces is a variable serif with strong
// optical sizing - it carries weight at large sizes the way magazine
// covers do, and pairs with Inter's neutral body without fighting it.
const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-display',
});

// Resolve the canonical site URL for metadataBase, OG images, and
// canonical link tags. NEXT_PUBLIC_SITE_URL is set in Vercel; falls
// back to the Vercel preview URL or localhost so dev still works.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Advottic - Walk into court prepared',
    template: '%s · Advottic',
  },
  description:
    'Organize evidence, surface jurisdiction-aware issues with Advottic Review, prepare for hearings, and ship a packet your attorney can read in five minutes.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Advottic',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Advottic',
  },
  formatDetection: { telephone: false },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'Advottic',
    title: 'Advottic - Walk into court prepared',
    description:
      'Organize evidence, surface jurisdiction-aware issues, prepare for hearings, and ship a clean packet your attorney can read in five minutes.',
    url: SITE_URL,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Advottic - Walk into court prepared',
    description:
      'Organize evidence, surface jurisdiction-aware issues, prepare for hearings, and ship a clean packet your attorney can read in five minutes.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  category: 'Productivity',
  // Site-verification tags - rendered ONLY when the corresponding
  // env var is set. Once the operator pastes the value from each
  // tool into Vercel, the next deploy auto-verifies the property
  // without any further code change. Paste the raw token (no
  // prefix), e.g. "ABCD1234...". See docs/MARKETING_LAUNCH.md.
  verification: buildVerification(),
};

function buildVerification() {
  const v: NonNullable<Metadata['verification']> = {};
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  if (google) v.google = google;
  const other: Record<string, string> = {};
  const bing = process.env.BING_SITE_VERIFICATION?.trim();
  if (bing) other['msvalidate.01'] = bing;
  const fb = process.env.FACEBOOK_DOMAIN_VERIFICATION?.trim();
  if (fb) other['facebook-domain-verification'] = fb;
  if (Object.keys(other).length > 0) v.other = other;
  return v;
}

export const viewport = {
  themeColor: '#0f2d24',
  // viewport-fit=cover lets the layout render under iOS notches / home
  // indicator; we use env(safe-area-inset-*) in CSS to add padding back.
  viewportFit: 'cover' as const,
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Detect /counsel/* and /admin/* so we can swap the consumer
  // chrome for the dedicated firm-side and HQ chrome. Counsel users
  // are professionals working on behalf of an organization, and the
  // HQ console is the founder cockpit - neither needs Find counsel,
  // Public defender, Billing, the trial banner, the consumer
  // sidebar, Bella, or the marketing footer that consumers see.
  // Pathname is forwarded by middleware via the x-pathname header.
  const pathname = headers().get('x-pathname') ?? '';
  const isCounselMode = pathname === '/counsel' || pathname.startsWith('/counsel/');
  const isHqMode = pathname === '/admin' || pathname.startsWith('/admin/');
  const isShellMode = isCounselMode || isHqMode;

  // Decide whether to mount the consent popup AND whether the user is signed
  // in (so we can gate the search trigger + sidebar/mobile-nav on auth).
  // Server-side so the navigation HTML literally isn't shipped to logged-out
  // visitors, and stays gone after refresh.
  let consent: { needed: false } | { needed: true; fallbackName: string } = { needed: false };
  let signedIn = false;
  let serverTheme: 'light' | 'dark' | 'system' = 'light';
  let serverLanguage: string | null = null;
  let trial: {
    mode: 'active_subscription' | 'stripe_trialing' | 'free_trial' | 'expired' | 'none';
    trialEndsAt: string | null;
    daysRemaining: number;
    tier: string | null;
  } | null = null;
  if (isSupabaseConfigured()) {
    try {
      const user = await getCurrentUser();
      if (user) {
        signedIn = true;
        const profile = await getProfile().catch(() => null);
        if (profile?.theme) serverTheme = profile.theme;
        if (profile?.language) serverLanguage = profile.language;
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
        // Best-effort: record this email in signup_history so the free
        // trial clock anchors on the FIRST time we ever saw the address,
        // not on this auth.users row's created_at. Fire-and-forget; a
        // failure here must never block layout render.
        ensureSignupHistory().catch(() => {});

        // Compute the effective trial / subscription state. The banner
        // appears for stripe_trialing, free_trial, and expired modes;
        // active subscribers skip it.
        const state = await getEffectiveTrialState().catch(() => null);
        if (state && state.mode !== 'active_subscription' && state.mode !== 'none') {
          trial = {
            mode: state.mode,
            trialEndsAt: state.trialEndsAt,
            daysRemaining: state.daysRemaining,
            tier: state.tier,
          };
        }
      }
    } catch {
      // never block render on a profile-lookup failure
    }
  }

  return (
    <html
      lang={serverLanguage ?? 'en'}
      className={`${sans.variable} ${wordmark.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeBoot serverTheme={serverTheme} />
      </head>
      <body className="min-h-screen flex flex-col font-sans">
        {/* Counsel mode renders its own header / sidebar / footer in
            app/counsel/layout.tsx and reuses none of the consumer
            chrome. Find counsel, Public defender, Billing, and the
            trial banner are intentionally hidden inside /counsel/*
            because firms have per-contract billing and the consumer
            directories are not relevant to organizational users. */}
        {!isShellMode && (
          <>
            <header className="sticky top-0 z-20">
              <div className="relative z-30 bg-forest-950/95 backdrop-blur-md pt-[env(safe-area-inset-top)]">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center justify-between">
                  <Link
                    href="/"
                    aria-label="Advottic home"
                    className="inline-flex items-center min-w-0 group"
                  >
                    <Image
                      src="/advottic-wordmark.png"
                      alt="Advottic"
                      width={14494}
                      height={1699}
                      priority
                      className="h-6 sm:h-8 lg:h-9 w-auto max-w-[55vw] block group-hover:opacity-90 transition-opacity"
                    />
                  </Link>
                  <div className="flex items-center gap-1">
                    {signedIn && <SearchTrigger className="hidden sm:inline-flex" />}
                    {signedIn && <div className="hidden sm:block h-5 w-px bg-cream-100/15 mx-2" />}
                    <UserMenu />
                  </div>
                </div>
                <div className="header-glow-line" aria-hidden />
              </div>
              {signedIn && (
                <Suspense fallback={null}>
                  <MobileNav />
                </Suspense>
              )}
            </header>
            {signedIn && <SearchPalette />}
          </>
        )}
        {isShellMode ? (
          // Counsel and HQ render their own full-bleed shells. Skip
          // the consumer sidebar/main grid so those layouts can do
          // whatever they need without being squeezed.
          children
        ) : (
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
        )}
        {!isShellMode && <Bella signedIn={signedIn} />}
        {consent.needed && <ConsentModal fallbackName={consent.fallbackName} />}
        <CookieBanner />
        {!isShellMode && trial && (trial.mode === 'stripe_trialing' || trial.mode === 'free_trial' || trial.mode === 'expired') && (
          <TrialBanner
            mode={trial.mode}
            trialEndsAt={trial.trialEndsAt}
            daysRemaining={trial.daysRemaining}
            tier={trial.tier}
          />
        )}
        <ServiceWorkerRegister />
        <CrashReporter />
        <FreshnessGuard
          initialSha={(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 12)}
        />
        {!isShellMode && (
        <footer className="border-t border-ink-200 bg-white dark:bg-forest-950 dark:border-forest-700/40">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 text-[11px] text-ink-500 dark:text-cream-100/55">
            <div className="grid gap-6 sm:gap-8 grid-cols-2 md:grid-cols-4">
              <div className="space-y-1.5 col-span-2 md:col-span-1">
                <p className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
                  Advottic
                </p>
                <p className="leading-relaxed">
                  Case organization &amp; preparation. Not a law firm.
                </p>
                <Link
                  href="/about"
                  className="inline-block mt-1 text-[11px] underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
                >
                  What Advottic is, and isn&rsquo;t &rarr;
                </Link>
              </div>
              <FooterCol title="Product">
                <Link href="/cases" className="hover:text-forest-900 dark:hover:text-cream-100 block">Cases</Link>
                <Link href="/cases/new" className="hover:text-forest-900 dark:hover:text-cream-100 block">New case</Link>
                <Link href="/find-counsel" className="hover:text-forest-900 dark:hover:text-cream-100 block">Find counsel</Link>
                <Link href="/public-defender" className="hover:text-forest-900 dark:hover:text-cream-100 block">Public defender</Link>
                <Link href="/file-exhibits" className="hover:text-forest-900 dark:hover:text-cream-100 block">File exhibits</Link>
                <Link href="/review-my-document" className="hover:text-forest-900 dark:hover:text-cream-100 block">Review my document</Link>
                <Link href="/about" className="hover:text-forest-900 dark:hover:text-cream-100 block">About Advottic</Link>
                <Link href="/feedback" className="hover:text-forest-900 dark:hover:text-cream-100 block">Send feedback</Link>
                <Link href="/welcome" className="hover:text-forest-900 dark:hover:text-cream-100 block">Share Advottic</Link>
                <Link href="/billing" className="hover:text-forest-900 dark:hover:text-cream-100 block">Billing</Link>
              </FooterCol>
              <FooterCol title="Legal">
                <Link href="/terms" className="hover:text-forest-900 dark:hover:text-cream-100 block">Terms</Link>
                <Link href="/privacy" className="hover:text-forest-900 dark:hover:text-cream-100 block">Privacy</Link>
                <Link href="/cookies" className="hover:text-forest-900 dark:hover:text-cream-100 block">Cookies</Link>
                <Link href="/dmca" className="hover:text-forest-900 dark:hover:text-cream-100 block">DMCA</Link>
                <Link href="/security" className="hover:text-forest-900 dark:hover:text-cream-100 block">Security</Link>
                <Link href="/accessibility" className="hover:text-forest-900 dark:hover:text-cream-100 block">Accessibility</Link>
              </FooterCol>
              <FooterCol title="Contact">
                <a
                  className="hover:text-forest-900 dark:hover:text-cream-100 block break-all"
                  href="mailto:contact@advottic.com"
                >
                  contact@advottic.com
                </a>
                <span className="block">Operated from Minnesota, USA.</span>
              </FooterCol>
            </div>
            <div className="mt-6 sm:mt-8 pt-4 sm:pt-5 border-t border-ink-100 dark:border-forest-700/40 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono tracking-tight">
                © {new Date().getFullYear()} Advottic LLC. All rights reserved.
              </p>
              <p className="text-ink-400 dark:text-cream-100/45">
                Powered by{' '}
                <span className="font-semibold text-forest-900 dark:text-cream-100">Techno Optics LLC</span>
              </p>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-ink-400 dark:text-cream-100/45 max-w-3xl">
              Advottic is a service of Techno Optics LLC. Advottic Review and Bella generate
              informational content automatically; outputs may be incomplete, outdated, or
              wrong and are not legal advice. Always consult a licensed attorney in your
              jurisdiction before acting. If you face possible incarceration, ask the court
              for a public defender at your first court appearance.
            </p>
          </div>
        </footer>
        )}
      </body>
    </html>
  );
}

/**
 * Footer column. On mobile each section collapses behind a + chevron so
 * the footer doesn't take a full screen on phones; on md+ the same content
 * renders as a static column. Two separate trees keep the markup honest
 * and avoid CSS gymnastics around <details> being closed-by-default.
 */
/**
 * Footer column. On mobile, each section collapses behind a + chevron
 * so the footer doesn't dominate phone screens; on md+ it renders as
 * a static column. Both layers live in the same grid cell so the
 * grid-cols-N count stays correct on every breakpoint.
 */
function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="col-span-2 md:col-span-1">
      {/* Mobile: collapsible accordion */}
      <details className="group md:hidden border-b border-ink-100 dark:border-forest-700/40 pb-3">
        <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden py-1">
          <span className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
            {title}
          </span>
          <span
            aria-hidden
            className="text-ink-400 dark:text-cream-100/55 text-[14px] font-mono leading-none transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="space-y-1 mt-2">{children}</div>
      </details>
      {/* Desktop: static column */}
      <div className="hidden md:block space-y-1.5">
        <p className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
          {title}
        </p>
        <div className="space-y-1">{children}</div>
      </div>
    </div>
  );
}

