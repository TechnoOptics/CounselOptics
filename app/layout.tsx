import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { Inter, Saira_Condensed, Fraunces } from 'next/font/google';
import './globals.css';
import { UserMenu } from '@/components/UserMenu';
import { NotificationBell } from '@/components/NotificationBell';
import { TokenBalanceGauge } from '@/components/TokenBalanceGauge';
import { listNotifications, unreadNotificationCount } from '@/lib/notifications';
import { Bella } from '@/components/Bella';
import { CookieBanner } from '@/components/CookieBanner';
import { SearchPalette, SearchTrigger } from '@/components/SearchPalette';
import { ConsentModal } from '@/components/ConsentModal';
import { Sidebar, MobileNav } from '@/components/Sidebar';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ThemeBoot } from '@/components/ThemeBoot';
import { CrashReporter } from '@/components/CrashReporter';
import { SiteJsonLd } from '@/components/seo/JsonLd';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';
import { BiometricSessionSync } from '@/components/BiometricSessionSync';
import { DeviceFingerprintRecorder } from '@/components/DeviceFingerprintRecorder';
import { FreshnessGuard } from '@/components/FreshnessGuard';
import { TrialBanner } from '@/components/TrialBanner';
import { NoCapture } from '@/components/NoCapture';
import { TraceWatermark } from '@/components/TraceWatermark';
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
    default: 'Advottic - Build your case',
    template: '%s · Advottic',
  },
  description:
    "Keep the receipts. We'll turn them into a case file for the day you need it.",
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
    title: 'Advottic - Build your case',
    description:
      "Keep the receipts. We'll turn them into a case file for the day you need it.",
    url: SITE_URL,
    locale: 'en_US',
    // og:image is auto-injected by app/opengraph-image.tsx (Next.js
    // convention) - it generates a 1200x630 forest-gradient brand
    // card at /opengraph-image dynamically via @vercel/og. No need
    // to set `images` here; doing so would emit duplicate meta tags.
  },
  twitter: {
    card: 'summary_large_image',
    site: '@advottic',
    creator: '@advottic',
    title: 'Advottic - Build your case',
    description:
      "Keep the receipts. We'll turn them into a case file for the day you need it.",
    // twitter:image also auto-injected by the opengraph-image
    // convention (Next.js mirrors og:image into twitter:image when
    // twitter.images is omitted).
  },
  authors: [{ name: 'Advottic', url: SITE_URL }],
  creator: 'Advottic',
  publisher: 'Techno Optics LLC',
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

  // App-mode = the user is doing actual case work, where the in-app
  // sidebar (New case / Cases / Shared with me / Find counsel /
  // File exhibits / Public defender / Billing) belongs. Everywhere
  // else - the marketing landing, the enterprise sales page, sign-in,
  // the welcome / about / legal trio - is sales / informational and
  // must NOT render the sidebar even when the visitor is signed in.
  // Without this gate a signed-in user lands on / and sees both the
  // top header AND the in-app left rail at the same time, which
  // reads as "two headers" and bleeds the workspace into the
  // marketing surface.
  const APP_ROUTE_PREFIXES = [
    '/cases',
    '/profile',
    '/billing',
    '/feedback',
    '/find-counsel',
    '/file-exhibits',
    '/public-defender',
    '/contracts',
    '/vault',
    '/inbox',
  ];
  const isAppRoute =
    pathname !== '' &&
    APP_ROUTE_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    );

  // Decide whether to mount the consent popup AND whether the user is signed
  // in (so we can gate the search trigger + sidebar/mobile-nav on auth).
  // Server-side so the navigation HTML literally isn't shipped to logged-out
  // visitors, and stays gone after refresh.
  let consent: { needed: false } | { needed: true; fallbackName: string } = { needed: false };
  let signedIn = false;
  let userEmail: string | null = null;
  let serverTheme: 'light' | 'dark' | 'system' = 'light';
  let serverLanguage: string | null = null;
  // Consumer-portal sidebar customization. Loaded server-side here
  // so the Sidebar + MobileNav components render with the user's
  // saved order + visibility on first paint (no flicker, no extra
  // round trip). Shape lives in lib/menu-prefs.ts.
  let consumerMenuPrefs: import('@/lib/menu-prefs').MenuPreferences | undefined;
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
        userEmail = user.email ?? null;
        // Audit V7 CR-57: previously `await getProfile().catch(() => null)`
        // collapsed BOTH "no record" and "database hiccup" into the same
        // null result, then `!profile?.consentedAt` triggered the consent
        // modal in either case. A transient read failure was therefore
        // showing the arbitration dialog to users who had already
        // signed it - which weakens the legal enforceability of the
        // original acceptance. We now distinguish read-failure from
        // missing-record: read failures pass through with `consent`
        // staying `needed: false` so a flaky DB read doesn't fabricate
        // a re-consent event. The legitimate "this user has never
        // consented" case (profile loaded successfully, consentedAt is
        // null) still triggers the modal.
        let profile: Awaited<ReturnType<typeof getProfile>> | null = null;
        let profileReadOk = false;
        try {
          profile = await getProfile();
          profileReadOk = true;
        } catch {
          // Read failed - treat as "consent state unknown, defer".
          profileReadOk = false;
        }
        if (profile?.theme) serverTheme = profile.theme;
        if (profile?.language) serverLanguage = profile.language;
        consumerMenuPrefs = profile?.menuPreferences?.consumer;
        // Audit V7 CR-56: the consent gate is a CONSUMER legal-terms
        // dialog (binding arbitration, class-action waiver). HQ staff
        // and firm-side users sign different agreements via different
        // surfaces and should not be intercepted by it on every
        // session - it created a UX dead-end where the auditor could
        // not reach /admin/* routes after clearing local storage. Only
        // mount when we know the user has no server-side consent
        // record AND they're not on the staff/firm shell.
        if (profileReadOk && !profile?.consentedAt && !isShellMode) {
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

  // Initial notification feed for the bell. Falls back to empty on
  // any failure so a Supabase hiccup never blocks the header from
  // rendering. Bell hides itself when signed out.
  const [initialNotifications, initialUnread] = signedIn
    ? await Promise.all([
        listNotifications({ limit: 30 }).catch(() => []),
        unreadNotificationCount().catch(() => 0),
      ])
    : [[], 0];

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
        {/* Site-wide structured data: Organization + WebSite (with
            sitelinks search box). Surfaces on every page so the
            knowledge panel + brand SERP carry consistent metadata. */}
        <SiteJsonLd />
        {/* Impersonation warning. Sticky top banner, rendered on
            every page (consumer + counsel + admin chrome) so an HQ
            operator who's used "Sign in as user" cannot forget they
            are acting as someone else. The component is a no-op
            until the impersonating=1 query string is seen on first
            load; after that it persists per-tab via sessionStorage. */}
        {signedIn && <ImpersonationBanner targetEmail={userEmail} />}
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
                    href={signedIn ? '/cases' : '/'}
                    aria-label={signedIn ? 'Cases dashboard' : 'Advottic home'}
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
                    {signedIn && (
                      <span className="hidden sm:inline-flex">
                        <TokenBalanceGauge
                          initial={{
                            combined: 0,
                            firmPool: null,
                            personal: 0,
                            monthlyGrant: 0,
                          }}
                        />
                      </span>
                    )}
                    {signedIn && (
                      <NotificationBell
                        initial={initialNotifications}
                        initialUnread={initialUnread}
                      />
                    )}
                    {signedIn && <div className="hidden sm:block h-5 w-px bg-cream-100/15 mx-2" />}
                    <UserMenu />
                  </div>
                </div>
                <div className="header-glow-line" aria-hidden />
              </div>
              {signedIn && isAppRoute && (
                <Suspense fallback={null}>
                  <MobileNav initialPrefs={consumerMenuPrefs} />
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
              {signedIn && isAppRoute && (
                <Suspense fallback={null}>
                  <Sidebar initialPrefs={consumerMenuPrefs} />
                </Suspense>
              )}
              {/* Defensive Suspense around route content. Audit 2026-05-12
                  flagged 45 React #419 crashes spanning every public +
                  authenticated path. #419 means hydration recovered by
                  client-rendering the entire root - a Suspense boundary
                  here means any suspending hook (useSearchParams in a
                  page-level client component, etc.) only re-renders the
                  page slot, not the whole tree, and the user sees no
                  flash. Layout chrome stays SSR. */}
              <div className="flex-1 min-w-0">
                <Suspense fallback={null}>{children}</Suspense>
              </div>
            </div>
          </main>
        )}
        {/*
          Bella is hidden on auth-funnel pages (audit CR-43). Showing
          a floating chat widget on /sign-in adds visual noise on a
          screen whose only job is to capture credentials, and the
          chat itself has nothing useful to say there - signed-out
          guidance lives in the marketing pages. The gate also covers
          the magic-link follow-up paths (/auth/callback,
          /sign-in?error=..., /sign-in?next=...) so an error state
          doesn't bring the widget back.
        */}
        {!isShellMode &&
          !pathname.startsWith('/sign-in') &&
          !pathname.startsWith('/auth/') && <Bella signedIn={signedIn} />}
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
        <NoCapture />
        {signedIn && <TraceWatermark email={userEmail} />}
        <ServiceWorkerRegister />
        <CrashReporter />
        {/* Native shells: keep the biometric-stored refresh token in
            sync as Supabase rotates tokens. No-op on web. */}
        <BiometricSessionSync />
        {/* Device fingerprint recorder - once per session, anchors
            the user's trial clock to the device they signed up on
            so a fresh email on the same phone can't reset the trial.
            Renders nothing; signed-out users skip via the action. */}
        {signedIn && <DeviceFingerprintRecorder />}
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
                <Link href="/pricing" className="hover:text-forest-900 dark:hover:text-cream-100 block">Pricing</Link>
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
                <a
                  href="https://technooptics.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-forest-900 dark:text-cream-100 underline-offset-2 hover:underline hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
                >
                  Techno Optics LLC
                </a>
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
 * Footer column. ONE render path: a <details> that collapses on
 * mobile and is forced-open on md+. Previously we rendered two
 * separate trees (mobile accordion + desktop static column) inside
 * one cell, which under some viewports left both visible at once
 * (audit 2026-05-11 flagged duplicated menus). The single tree
 * eliminates that possibility while preserving the collapsible
 * mobile UX.
 *
 * CSS notes:
 *   - `md:open` is implemented via the `open` attribute being
 *     forcibly set on the element through CSS-injected ::details-
 *     content unavailability is irrelevant here because we just
 *     hide the summary at md+ and let the <details> content be
 *     visible whether the element is open or not by adding an
 *     `md:[&_div]:block` rule.
 *   - The chevron and summary click-state are mobile-only.
 */
function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="col-span-2 md:col-span-1">
      <details
        // open on md+ so the content renders regardless of click state.
        // (HTML treats this as a default-open <details>; on mobile the
        // user can still close it.)
        open
        className="group border-b border-ink-100 dark:border-forest-700/40 pb-3 md:border-b-0 md:pb-0"
      >
        <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden py-1 md:cursor-default md:pointer-events-none">
          <span className="font-semibold text-forest-900 dark:text-cream-100 tracking-[0.05em] uppercase text-[10px]">
            {title}
          </span>
          <span
            aria-hidden
            className="text-ink-400 dark:text-cream-100/55 text-[14px] font-mono leading-none transition-transform group-open:rotate-45 md:hidden"
          >
            +
          </span>
        </summary>
        <div className="space-y-1 mt-2 md:mt-1.5">{children}</div>
      </details>
    </div>
  );
}

