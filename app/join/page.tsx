import { headers } from 'next/headers';
import Link from 'next/link';
import { getFirmBySlug } from '@/lib/firm-storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { SignInButtons } from '@/app/sign-in/sign-in-buttons';
import { JoinForm } from './join-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in to your workspace · Advottic',
  description:
    'Sign in or request access to your organization’s secure legal hub.',
  robots: { index: false, follow: true },
};

/**
 * The Enterprise client/employee gateway - a standalone, firm-branded
 * sign-in + request-access screen, deliberately separate from the
 * consumer advottic.com/sign-in. Resolves the org from ?firm=<slug>
 * or the tenant subdomain so the person always sees their own brand
 * (logo + name + accent) and knows they're in the right place. The
 * consumer header/footer is suppressed for /join in app/layout.tsx,
 * so this is the whole screen - no white box, no other-app chrome.
 */
function slugFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0];
  const m = h.match(/^([a-z0-9-]+)\.advottic\.com$/);
  if (!m) return null;
  const sub = m[1];
  if (sub === 'www' || sub === 'hq' || sub === 'enterprise' || sub === 'app') {
    return null;
  }
  return sub;
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams?: { firm?: string; mode?: string };
}) {
  const h = headers();
  const qpFirm = (searchParams?.firm ?? '').trim().toLowerCase();
  const hostSlug = slugFromHost(h.get('host'));
  const slug = qpFirm || hostSlug || '';
  const mode = searchParams?.mode === 'join' ? 'join' : 'signin';

  const firm = slug ? await getFirmBySlug(slug) : null;
  const firmName = firm?.name ?? null;
  const logoUrl = firm?.logoUrl ?? null;
  const accent = firm?.accentColor ?? '#d5bb7e';

  const user = await getCurrentUser();
  const nextParam = `/portal`;
  const signinHref = `/join${slug ? `?firm=${slug}` : ''}`;
  const joinHref = `/join?${slug ? `firm=${slug}&` : ''}mode=join`;
  const switchHref = signinHref;

  return (
    <div className="dark counsel-shell min-h-screen flex flex-col text-cream-100">
      <div className="flex-1 flex items-center justify-center px-4 py-14">
        <div className="w-full max-w-5xl grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          {/* Left: brand + value */}
          <div className="space-y-7 max-w-xl">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // Preserve the logo's true shape - many enterprise
                // marks are rectangular. Scale to a fixed height, let
                // width follow naturally, never crop or round it.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={firmName ?? 'Logo'}
                  className="h-12 w-auto max-w-[200px] object-contain"
                />
              ) : (
                <span
                  className="h-11 w-11 rounded-xl inline-flex items-center justify-center text-black text-base font-bold"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                >
                  {(firmName ?? 'A').slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <p className="eyebrow text-cream-100/55">
                  {firmName ? `${firmName} · Legal` : 'Advottic Enterprise'}
                </p>
                <p className="font-display text-lg text-cream-100">
                  {firmName ? `${firmName} workspace` : 'Your legal workspace'}
                </p>
              </div>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl leading-[1.05] tracking-[-0.02em] text-cream-100">
              One place for{' '}
              <span className="text-gold-flow">everything legal</span>.
            </h1>
            <p className="text-[15px] leading-relaxed text-cream-100/70">
              Reach {firmName ? `${firmName}'s` : 'your'} legal team
              directly, submit requests and documents, get an AI read on
              any contract, and keep every deadline and meeting in one
              calm, secure hub.
            </p>

            <ul className="space-y-3 text-[13.5px] text-cream-100/75">
              {[
                'Submit a request or intake in minutes',
                'Message legal and track every reply',
                'Run a document through Advottic Review for instant insight',
                'Reminders before anything is due - your way',
              ].map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black"
                    style={{ backgroundColor: accent }}
                  >
                    ✓
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right: the auth card */}
          <div className="popup-panel p-7 sm:p-8 space-y-5">
            <div>
              <p className="eyebrow text-cream-100/55">
                {firmName ? `${firmName} · Secure access` : 'Secure access'}
              </p>
              <h2 className="font-display text-2xl text-cream-100 mt-1">
                {mode === 'join'
                  ? firmName
                    ? `Join ${firmName}`
                    : 'Request access'
                  : firmName
                    ? `Sign in to ${firmName}`
                    : 'Sign in'}
              </h2>
              <p className="text-[12.5px] text-cream-100/60 mt-1.5 leading-relaxed">
                {mode === 'join'
                  ? 'Use your work email. Team members are set up instantly; outside collaborators are approved by the legal team first.'
                  : `Use the email ${
                      firmName ? `${firmName} ` : ''
                    }set you up with. We'll send a one-time code - no password to remember.`}
              </p>
            </div>

            {user ? (
              <div className="space-y-3">
                <div className="rounded-xl p-4 ring-1 ring-forest-700/40 bg-forest-900/40">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-cream-100/45">
                    Signed in as
                  </p>
                  <p className="text-sm font-medium text-cream-100 mt-0.5 truncate">
                    {user.email}
                  </p>
                </div>
                <Link
                  href="/portal"
                  className="btn w-full bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
                >
                  Continue to your workspace
                </Link>
                <form action="/auth/sign-out" method="post">
                  <input
                    type="hidden"
                    name="next"
                    value={switchHref}
                  />
                  <button
                    type="submit"
                    className="btn w-full text-cream-100/60 hover:text-cream-100 hover:bg-cream-100/5 justify-center text-[13px]"
                  >
                    Use a different account
                  </button>
                </form>
              </div>
            ) : mode === 'join' ? (
              <>
                <JoinForm
                  defaultSlug={slug}
                  firmName={firmName}
                  lockedSlug={Boolean(firm)}
                />
                <p className="text-[12px] text-cream-100/55 text-center">
                  Already have access?{' '}
                  <Link
                    href={signinHref}
                    className="underline text-gold-300 hover:text-gold-200"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            ) : (
              <>
                <SignInButtons next={nextParam} />
                <p className="text-[12px] text-cream-100/55 text-center pt-1">
                  New here?{' '}
                  <Link
                    href={joinHref}
                    className="underline text-gold-300 hover:text-gold-200"
                  >
                    Request access
                  </Link>
                </p>
              </>
            )}

            <p className="text-[11px] text-cream-100/40 leading-relaxed">
              Protected by Advottic. By continuing you agree to the{' '}
              <Link href="/terms" className="underline hover:text-cream-100/70">
                Terms
              </Link>{' '}
              and{' '}
              <Link
                href="/privacy"
                className="underline hover:text-cream-100/70"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-forest-700/40 bg-forest-950/70 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-4 text-[11px] text-cream-100/45 flex flex-wrap items-center justify-between gap-2">
          <p>
            {firmName ? (
              <>
                <span className="font-semibold text-cream-100">
                  {firmName}
                </span>{' '}
                · Powered by Techno Optics
              </>
            ) : (
              <span className="font-semibold text-cream-100">Advottic</span>
            )}
          </p>
          <p>Enterprise legal workspace</p>
        </div>
      </footer>
    </div>
  );
}
