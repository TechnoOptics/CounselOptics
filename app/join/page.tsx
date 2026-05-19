import { headers } from 'next/headers';
import Link from 'next/link';
import { getFirmBySlug } from '@/lib/firm-storage';
import { JoinForm } from './join-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Join your workspace · Advottic',
  description:
    'Create your account to reach your organization’s legal team, file requests, and track everything in one place.',
};

/**
 * Public, classy account-request landing for the Enterprise edition.
 *
 * Resolves the organization from ?firm=<slug> or the tenant
 * subdomain so the page can greet "Join Zinpro" with the firm's own
 * brand. Internal (work-domain) emails are provisioned immediately;
 * everyone else is queued for the legal team to approve. The form
 * never creates an auth account itself - the person signs themselves
 * in with the normal magic link afterwards.
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
  searchParams?: { firm?: string };
}) {
  const h = headers();
  const qpFirm = (searchParams?.firm ?? '').trim().toLowerCase();
  const hostSlug = slugFromHost(h.get('host'));
  const slug = qpFirm || hostSlug || '';

  const firm = slug ? await getFirmBySlug(slug) : null;
  const firmName = firm?.name ?? null;
  const logoUrl = firm?.logoUrl ?? null;
  const accent = firm?.accentColor ?? '#d5bb7e';

  return (
    <div className="dark counsel-shell min-h-screen flex flex-col text-cream-100">
      <div className="flex-1 flex items-center justify-center px-4 py-14">
        <div className="w-full max-w-5xl grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          {/* Left: brand + value */}
          <div className="space-y-7 max-w-xl">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={firmName ?? 'Logo'}
                  className="h-11 w-11 rounded-xl object-cover ring-1 ring-cream-100/15"
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

            <p className="text-[12px] text-cream-100/45">
              Already have access?{' '}
              <Link
                href="/sign-in?next=/portal"
                className="underline text-gold-300 hover:text-gold-200"
              >
                Sign in
              </Link>
            </p>
          </div>

          {/* Right: the request card */}
          <div className="popup-panel p-7 sm:p-8 space-y-5">
            <div>
              <p className="eyebrow text-cream-100/55">Create your account</p>
              <h2 className="font-display text-2xl text-cream-100 mt-1">
                {firmName ? `Join ${firmName}` : 'Request access'}
              </h2>
              <p className="text-[12.5px] text-cream-100/60 mt-1.5 leading-relaxed">
                Use your work email. Team members are set up instantly;
                outside collaborators are approved by the legal team
                first.
              </p>
            </div>
            <JoinForm
              defaultSlug={slug}
              firmName={firmName}
              lockedSlug={Boolean(firm)}
            />
            <p className="text-[11px] text-cream-100/40 leading-relaxed">
              By continuing you agree to Advottic&rsquo;s{' '}
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
                · Powered by Advottic
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
