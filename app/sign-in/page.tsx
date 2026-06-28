import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { SignInButtons } from './sign-in-buttons';
import { BrandMark } from '@/components/BrandMark';
import { BiometricUnlockGate } from '@/components/BiometricUnlockGate';
import { SsoSignIn } from '@/components/SsoSignIn';

export const dynamic = 'force-dynamic';

/**
 * Auth screens have no business in Google's index. Per Week-1 audit
 * (May 13, 2026, item #2 + #10): noindex /sign-in so the brand query
 * never serves the login page above richer pages, and so the entry is
 * effectively dropped from the sitemap's signal. `follow` is kept so
 * crawlers still walk the post-login navigation footprint via the
 * standard footer / nav links rendered around the form.
 *
 * Canonical points to /sign-in (self) per audit W20 SEO finding: the
 * earlier configuration left canonical undefined, which inherited the
 * root-layout default of "/" - search engines then treated /sign-in as
 * a duplicate of the homepage. Self-canonical + noindex is the
 * "remove from index without confusing crawler" pattern that Google's
 * own docs recommend.
 *
 * Page title is computed per-request via generateMetadata below so
 * the browser tab reads "Sign in to Advottic HQ" / "Sign in to
 * Advottic Counsel" / "Sign in to Advottic" depending on next=. Per
 * V3 CR-13: the staff sign-in tab used to read the consumer marketing
 * pitch, which was disorienting when staff had a HQ tab open next to
 * a customer tab.
 */
export function generateMetadata({
  searchParams,
}: {
  searchParams?: { next?: string };
}): Metadata {
  const next = sanitizeNext(searchParams?.next);
  let pathForTitle = next;
  try {
    if (next.startsWith('http')) pathForTitle = new URL(next).pathname || '/';
  } catch {
    /* keep raw */
  }
  const title = pathForTitle.startsWith('/admin')
    ? 'Sign in to Advottic HQ'
    : pathForTitle.startsWith('/counsel')
      ? 'Sign in to Advottic Counsel'
      : 'Sign in to Advottic';
  return {
    // Audit V7 CR-59: the previous setup returned a plain string,
    // which the root layout's "%s · Advottic" template suffixed
    // again - producing "Sign in to Advottic · Advottic". Use
    // { absolute: ... } so the brand appears exactly once. The
    // staff-mode and counsel-mode variants already include the
    // suffix the audience needs.
    title: { absolute: title },
    alternates: { canonical: '/sign-in' },
    robots: {
      index: false,
      follow: true,
      googleBot: { index: false, follow: true },
    },
  };
}

/**
 * Resolve a subdomain-specific banner from the `next` parameter. The
 * /sign-in page always renders on the apex (advottic.com) - even when
 * the user lands here from hq.advottic.com or enterprise.advottic.com
 * the middleware rewrites the host so PKCE cookies stick to one origin.
 * That means the only signal of "where the user came from" is the
 * post-login destination encoded in `next`.
 *
 * Per Week-1 audit item #7 (subdomain branding): admins arriving from
 * HQ should see "HQ admin console", firms arriving from Enterprise
 * should see "firm workspace", and standalone /sign-in stays generic.
 */
function bannerForNext(next: string): { eyebrow: string; helper: string } | null {
  // `next` is sanitized upstream - it's either a same-origin path
  // ("/admin", "/counsel/clients") or a same-org cross-subdomain URL
  // (https://zinpro.advottic.com/...). Both forms surface the
  // destination prefix the same way once we extract the pathname.
  let path = next;
  try {
    if (next.startsWith('http')) {
      path = new URL(next).pathname || '/';
    }
  } catch {
    path = next;
  }
  if (path.startsWith('/admin')) {
    return {
      eyebrow: 'HQ admin console',
      helper: "You're signing into the Advottic HQ admin console. Use the same account you registered with for staff access.",
    };
  }
  if (path.startsWith('/counsel')) {
    return {
      eyebrow: 'Firm workspace',
      helper: "You're signing into your firm's Advottic Counsel workspace. Use your firm-issued email for SSO.",
    };
  }
  return null;
}

/**
 * Validate `next` for both same-origin path redirects (`/cases`,
 * `/counsel/clients`) and cross-origin advottic.com subdomain
 * redirects (`https://zinpro.advottic.com/clients`). The cross-origin
 * case is required by Phase 2 white-label: an unauthed visit to
 * `zinpro.advottic.com` bounces through `advottic.com/sign-in?next=https://zinpro.advottic.com/...`,
 * and after auth we have to send the user back to the tenant
 * subdomain.
 *
 * Any other absolute URL is rejected to avoid an open-redirect
 * vulnerability - we never want `next` to land a freshly-authenticated
 * session on an attacker-controlled host.
 */
function sanitizeNext(raw: string | undefined): string {
  if (!raw) return '/cases';
  // Audit 2026-05-12 P0-1: some upstream callers pass an
  // already-URL-encoded `next` value into encodeURIComponent, producing
  // a `%2520` (double-encoded space) or `%252F` (double-encoded slash).
  // Peel encoding layers off until the string starts with `/` or stops
  // looking URL-encoded - capped at 3 passes to avoid pathological loops.
  let depth = 0;
  while (depth < 3 && /^(%25)+(2F|3A)/i.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded === raw) break;
      raw = decoded;
      depth++;
    } catch {
      break;
    }
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    // Collapse sign-in alias paths to their bare workspace prefix so
    // a stale link with next=/admin/sign-in (which 404s because no
    // such route exists) lands the user on /admin after auth - the
    // page they actually wanted. Mirror logic of SIGN_IN_ALIASES in
    // lib/supabase/middleware.ts.
    if (/^\/admin\/(sign-in|signin|login)\/?$/.test(raw)) return '/admin';
    if (/^\/counsel\/(sign-in|signin|login)\/?$/.test(raw)) return '/counsel';
    return raw;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return '/cases';
    const h = u.host.toLowerCase();
    if (h === 'advottic.com' || h.endsWith('.advottic.com')) {
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return '/cases';
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: {
    next?: string;
    error?: string;
    switch?: string;
    reason?: string;
  };
}) {
  const next = sanitizeNext(searchParams?.next);
  const subdomainBanner = bannerForNext(next);
  // `reason=pkce` lights up the "use the 6-digit code instead"
  // banner. The /auth/callback route sets this when it can't find
  // the PKCE verifier cookie - usually because the user clicked
  // the magic link in an email client that opened a different
  // browser than the one that started the flow. The fix is
  // ALWAYS to use the OTP code that came in the same email.
  const pkceFailure = searchParams?.reason === 'pkce';
  // Watch-linking flow: the user scanned a QR on their Wear OS
  // watch, landed on /link-watch?code=..., wasn't signed in, and
  // got bounced here with the link-watch path stored as next.
  // OAuth on mobile is unreliable for this scenario (the OAuth
  // round-trip strips PKCE cookies on Opera mobile, Safari ITP,
  // and most in-app browsers), so steer them to the email + 6-
  // digit code path which works across every browser context.
  const isWatchLink = next.startsWith('/link-watch');
  // `?switch=1` (or `?switch=true`) means: the user landed here on
  // purpose to change accounts. Don't auto-bounce them onto whatever
  // session this browser already has - instead, show the "you're
  // signed in as X, sign out to switch" panel so they have a
  // deliberate path to a different identity. Without this, an admin
  // who shares a browser with a family member literally cannot
  // escape the family member's session because /sign-in always
  // detects the existing cookie and forwards them past the picker.
  const switching =
    searchParams?.switch === '1' || searchParams?.switch === 'true';

  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-lg mx-auto card p-8 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Supabase not configured</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          Sign-in requires a Supabase project. Follow{' '}
          <Link href="/setup" className="underline">
            the setup guide
          </Link>{' '}
          or see <code className="font-mono">SETUP.md</code> in the repo.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  // Auto-redirect ONLY when the user did NOT explicitly ask to
  // switch. The switching branch falls through to the picker below
  // with an extra "currently signed in as X" panel on top.
  if (user && !switching) redirect(next);

  return (
    <div className="max-w-md mx-auto animate-fade-up">
      <div className="card-luminous p-8 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -right-10 -top-10 text-gold-500 pointer-events-none animate-float opacity-[0.07] z-0"
        >
          <BrandMark size={180} />
        </div>
        <div className="relative z-10">
        <p className="eyebrow mb-3">{subdomainBanner ? subdomainBanner.eyebrow : 'Welcome'}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-ink-950 leading-[1.05] mb-2">
          Sign in or create an account
        </h1>
        <p className="text-sm text-ink-600 leading-relaxed mb-6">
          {subdomainBanner
            ? subdomainBanner.helper
            : (
              <>
                {/*
                  Audit W20 V3 CR-11: when NEXT_PUBLIC_APPLE_ENABLED=1
                  the SignInButtons render an Apple button on the
                  consumer surface too, but the marketing description
                  here listed only Google + Microsoft. Now: Apple is
                  named whenever the env flag is on (which is the
                  current production posture), keeping the copy and
                  the actual button list in sync.
                */}
                Continue with Google, Microsoft
                {process.env.NEXT_PUBLIC_APPLE_ENABLED === '1' ? ', or Apple' : ''}
                , or use a magic link. We&apos;ll create your Advottic account on first sign-in -
                no separate signup form. Your case files, exhibits, and reviews stay tied to
                your account.
              </>
            )}
        </p>

        {searchParams?.error && !pkceFailure && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 mb-4">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}
        {isWatchLink && !pkceFailure && (
          // The user is here from /link-watch?code=.... Reinforce
          // that sign-in is a SEPARATE step and that the email +
          // 6-digit code path is the reliable one for mobile.
          <div className="rounded-xl border border-gold-200 bg-gold-50/70 px-4 py-3.5 text-sm text-forest-900 mb-4">
            <p className="font-semibold mb-1.5 flex items-center gap-2">
              <span aria-hidden className="text-base">⌚</span>
              Linking your watch
            </p>
            <p className="leading-relaxed">
              Sign in below first - after that, you&rsquo;ll see a page
              with a gold &ldquo;Link this watch&rdquo; button. On a
              phone, use{' '}
              <strong>Email me a sign-in code</strong> and type the
              6-digit code from the email - OAuth often fails on
              mobile because the OAuth round-trip strips the temp
              cookie that pairing depends on.
            </p>
          </div>
        )}
        {pkceFailure && (
          // The magic link opened in a different browser context
          // than the one that started the flow - the cookie holding
          // the PKCE verifier is in a different cookie jar than the
          // callback ran in. Same email already contains a 6-digit
          // code that works in ANY browser - guide the user there.
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-4 text-sm text-amber-900 mb-4">
            <p className="font-semibold mb-1.5 flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-[12px] font-bold"
              >
                !
              </span>
              Magic link opened in a different browser
            </p>
            <p className="leading-relaxed mb-2">
              The email magic link only works if you click it in the
              same browser you requested sign-in from. Email apps
              often launch links in a new browser they prefer (Gmail
              -&gt; Chrome, Outlook -&gt; Edge), which is why the
              cookie didn&rsquo;t carry over.
            </p>
            <p className="leading-relaxed">
              <strong>The fix:</strong> request a fresh sign-in below.
              When the email arrives, look for the{' '}
              <strong>6-digit code</strong> in the SAME email and type
              it into the field that appears - that works no matter
              which browser you started in.
            </p>
          </div>
        )}

        {switching && user && (
          // "Sign out & pick a different account" panel. Shown only
          // when the user reached /sign-in with ?switch=1 while
          // already signed in - they explicitly asked for the
          // chooser, so we surface the existing identity AND the
          // escape hatch. The hidden `next` field is carried through
          // sign-out so the post-sign-out chooser still knows where
          // to land them after the new sign-in lands.
          <div className="rounded-lg border border-ink-200 bg-cream-50/40 dark:bg-forest-900/40 dark:border-forest-700/40 px-4 py-3 mb-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
              Currently signed in
            </p>
            <p className="text-sm font-medium text-ink-950 dark:text-cream-100 mt-1 truncate">
              {user.email ?? 'Unknown user'}
            </p>
            <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-1 leading-snug">
              Continue with this account, or sign out and pick a
              different one below.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={next}
                className="btn-secondary text-[12px] px-3 py-1.5"
              >
                Continue as {user.email?.split('@')[0] ?? 'this user'}
              </Link>
              <form action="/auth/sign-out" method="post">
                {/* After sign-out, land back here in switch mode so
                    the chooser stays open and the previous next= is
                    preserved through one more hop. */}
                <input
                  type="hidden"
                  name="next"
                  value={`/sign-in?switch=1&next=${encodeURIComponent(next)}`}
                />
                <button
                  type="submit"
                  className="rounded-md bg-rose-50 dark:bg-rose-950/30 ring-1 ring-rose-200 dark:ring-rose-700/40 text-rose-800 dark:text-rose-200 text-[12px] px-3 py-1.5 font-semibold hover:bg-rose-100 dark:hover:bg-rose-950/50"
                >
                  Sign out & use a different account
                </button>
              </form>
            </div>
          </div>
        )}

        {/* On native shells with biometric enrolled, the gate renders
            its own "Welcome back, unlock with Face/Touch ID" surface
            and SignInButtons stays hidden. On web (or first install,
            or after the user picks "Use a different account") the
            gate falls through to children and the regular form
            renders. */}
        <BiometricUnlockGate next={next}>
          <SignInButtons next={next} />
        </BiometricUnlockGate>

        <SsoSignIn />

        {/*
          Audit W20 V3 CR-12: the disclaimer below used to render the
          consumer "we are not a law firm and Advottic is not legal
          advice" copy regardless of audience. That copy was wrong for
          staff signing into HQ (staff aren't organizing a case) and
          for firms signing into Counsel (they ARE the law firm).
          Now: pick the right line per audience based on the
          sanitized `next` destination.
        */}
        <p className="text-xs text-ink-500 mt-6 leading-relaxed">
          {subdomainBanner?.eyebrow === 'HQ admin console' ? (
            <>
              Staff access is logged and audited. By continuing you
              acknowledge the Advottic{' '}
              <Link
                href="/terms"
                className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
              >
                Terms
              </Link>{' '}
              and{' '}
              <Link
                href="/privacy"
                className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
              >
                Privacy
              </Link>
              .
            </>
          ) : subdomainBanner?.eyebrow === 'Firm workspace' ? (
            <>
              Your firm&apos;s Counsel workspace operates under your bar&apos;s
              ethics rules and the Advottic{' '}
              <Link
                href="/terms"
                className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
              >
                Terms
              </Link>
              . The audit log captures every sign, share, and export.
            </>
          ) : (
            <>
              By continuing you acknowledge that Advottic helps you organize your case -
              we are not a law firm and Advottic is not legal advice.{' '}
              <Link
                href="/about"
                className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
              >
                Learn more
              </Link>
              .
            </>
          )}
        </p>
        </div>
      </div>
    </div>
  );
}
