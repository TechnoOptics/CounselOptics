import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { SignInButtons } from './sign-in-buttons';
import { BrandMark } from '@/components/BrandMark';
import { BiometricUnlockGate } from '@/components/BiometricUnlockGate';

export const dynamic = 'force-dynamic';

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
  searchParams?: { next?: string; error?: string };
}) {
  const next = sanitizeNext(searchParams?.next);

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
  if (user) redirect(next);

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
        <p className="eyebrow mb-3">Welcome</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.015em] text-ink-950 leading-[1.05] mb-2">
          Sign in or create an account
        </h1>
        <p className="text-sm text-ink-600 leading-relaxed mb-6">
          Continue with Google or Microsoft, or use a magic link. We&apos;ll create your
          Advottic account on first sign-in - no separate signup form. Your case files,
          exhibits, and reviews stay tied to your account.
        </p>

        {searchParams?.error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 mb-4">
            {decodeURIComponent(searchParams.error)}
          </p>
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

        <p className="text-xs text-ink-500 mt-6 leading-relaxed">
          By continuing you acknowledge that Advottic helps you organize your case -
          we are not a law firm and Advottic is not legal advice.{' '}
          <Link
            href="/about"
            className="underline underline-offset-2 hover:text-forest-900 dark:hover:text-cream-100"
          >
            Learn more
          </Link>
          .
        </p>
        </div>
      </div>
    </div>
  );
}
