import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { recordConsentAction } from '@/lib/actions';
import { BrandMark } from '@/components/BrandMark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome - Advottic' };

export default async function WelcomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 text-sm text-ink-700">
        Auth is not configured. Follow <code>SETUP.md</code>.
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/welcome');

  const profile = await getProfile().catch(() => null);
  if (profile?.consentedAt) {
    redirect('/cases');
  }

  const fallbackName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    '';

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      {/* Hero */}
      <section className="brand-mark text-cream-100 rounded-3xl px-8 py-10 md:px-10 md:py-12 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none gold-pan opacity-50"
          style={{
            background:
              'radial-gradient(700px 320px at 85% 15%, rgba(213, 187, 126, 0.22), transparent 65%), radial-gradient(500px 240px at 5% 95%, rgba(213, 187, 126, 0.12), transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -right-12 -top-6 text-gold-500/12 pointer-events-none animate-float"
        >
          <BrandMark size={320} />
        </div>
        <div className="relative">
          <p className="text-gold-400 text-[11px] tracking-[0.3em] uppercase font-semibold mb-3 inline-flex items-center gap-2">
            <span className="inline-block h-px w-6 bg-gold-400" />
            Welcome
          </p>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1] mb-3">
            Hi{fallbackName ? `, ${firstName(fallbackName)}` : ''} -
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent gold-pan">
              let&apos;s set you up.
            </span>
          </h1>
          <p className="text-cream-100/85 text-[15px] leading-relaxed max-w-xl">
            Two quick things first: a tour of how Advottic works, and the consent that lets you
            start using it.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="grid gap-4 md:grid-cols-3 stagger">
        <Step
          n="01"
          title="Build a case"
          body="One case file per matter. Capture the parties, jurisdiction, posture (claimant or defendant), and a description of what happened."
        />
        <Step
          n="02"
          title="Attach evidence"
          body="Upload photos, PDFs, audio, video, screenshots. Each becomes an auto-numbered exhibit with category, date, and source captured."
        />
        <Step
          n="03"
          title="Get clarity"
          body="Run an AI review to see possible legal issues, evidence gaps, and subpoena targets - grounded in your jurisdiction. Export a PDF for your attorney."
        />
      </section>

      {/* Consent form */}
      <section className="card p-7">
        <p className="eyebrow mb-2">Consent &amp; representation</p>
        <h2 className="text-2xl font-semibold tracking-tight text-forest-900 mb-2">
          Before you continue
        </h2>
        <p className="text-sm text-ink-600 leading-relaxed mb-6">
          Tell us how you&apos;re showing up, then read and accept the terms below. Both are
          required to use Advottic.
        </p>

        <form action={recordConsentAction} className="space-y-6">
          <input type="hidden" name="displayName" value={fallbackName} />

          <fieldset>
            <legend className="label mb-3">How are you representing yourself?</legend>
            <div className="grid gap-2 md:grid-cols-3">
              {[
                {
                  v: 'self_represented',
                  title: 'Self-represented',
                  desc: 'Representing myself - no attorney yet.',
                },
                {
                  v: 'represented',
                  title: 'Represented',
                  desc: 'I have an attorney and want to organize for them.',
                },
                {
                  v: 'counsel',
                  title: "I'm counsel",
                  desc: 'I am an attorney working on a client matter.',
                },
              ].map((o) => (
                <label
                  key={o.v}
                  className="flex flex-col rounded-lg border border-ink-200 bg-white p-4 cursor-pointer hover:border-gold-500 has-[:checked]:border-forest-900 has-[:checked]:ring-2 has-[:checked]:ring-forest-900/20"
                >
                  <input
                    type="radio"
                    name="representation"
                    value={o.v}
                    required
                    className="sr-only peer"
                  />
                  <span className="font-semibold text-ink-950 text-sm peer-checked:text-forest-900">
                    {o.title}
                  </span>
                  <span className="text-xs text-ink-600 mt-1 leading-relaxed">{o.desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-5 text-sm text-ink-800 leading-relaxed space-y-3 max-h-72 overflow-y-auto">
            <p className="font-semibold text-ink-950">
              You acknowledge and agree to the following:
            </p>
            <ol className="list-decimal list-outside pl-5 space-y-2 text-[13.5px]">
              <li>
                <strong>Not legal advice.</strong> Advottic provides legal information, case
                organization, and AI-assisted issue spotting. It is{' '}
                <em>not a law firm</em>, does not provide legal advice, and does not create an
                attorney-client relationship. AI outputs may be incomplete, outdated, or wrong.
                Consult a licensed attorney before acting. If you face possible incarceration,
                request a public defender at your first court appearance - that is a free
                constitutional right.
              </li>
              <li>
                <strong>Security &amp; privacy.</strong> Your data is encrypted in transit (TLS)
                and at rest (AES-256 via our database and storage providers). Access is restricted
                to authorized personnel and logged. Advottic personnel may access account data
                only for support, abuse prevention, security investigations, and as required by
                law. AI features send your case content to our model provider for processing
                under that provider&apos;s commercial terms (no training on your data). You can
                export or delete your data at any time from the Profile page.
              </li>
              <li>
                <strong>Limitation of liability.</strong> To the fullest extent permitted by
                applicable law, Advottic, its operator (Techno Optics LLC), and its officers,
                affiliates, and contractors are not liable for indirect, incidental, special,
                consequential, exemplary, or punitive damages, and our total cumulative liability
                for any claim arising from your use of the service is limited to the greater of
                $100 USD or the amount you paid us in the prior 12 months.
              </li>
              <li>
                <strong>Binding individual arbitration; class-action and jury waivers.</strong>{' '}
                You and Advottic agree that any dispute, claim, or controversy arising out of or
                relating to this service or these terms will be resolved by{' '}
                <em>final, binding, individual arbitration</em> administered by a recognized
                arbitration body (e.g., AAA) under its consumer rules, seated in Minnesota,
                applying Minnesota law. <strong>You waive your right to a jury trial</strong> and
                <strong> waive your right to participate in a class action, mass action, or
                  representative proceeding.</strong> Either party may seek public injunctive
                relief in court only as required by law. Either party may bring a small-claims
                action in the small-claims court of Scott County, Minnesota for individual
                disputes within that court&apos;s jurisdiction.
              </li>
              <li>
                <strong>Acceptable use.</strong> You will not use Advottic to commit or facilitate
                illegal acts, fabricate or destroy evidence, harass others, or upload content you
                don&apos;t have the right to share.
              </li>
            </ol>
            <p className="text-xs text-ink-500 mt-2">
              Full text: <Link className="underline" href="/terms">Terms</Link> ·{' '}
              <Link className="underline" href="/privacy">Privacy</Link>
            </p>
          </div>

          <label className="flex items-start gap-3 text-sm text-ink-800 cursor-pointer">
            <input
              type="checkbox"
              name="consent"
              required
              className="mt-1 h-4 w-4 rounded border-ink-300 text-forest-900 focus:ring-forest-900"
            />
            <span className="leading-relaxed">
              I have read and agree to the items above, the{' '}
              <Link className="underline" href="/terms">
                Terms of Use
              </Link>{' '}
              and{' '}
              <Link className="underline" href="/privacy">
                Privacy Policy
              </Link>
              , including the{' '}
              <strong>binding arbitration, class-action waiver, and jury-trial waiver</strong>{' '}
              in section 4.
            </span>
          </label>

          <div className="flex justify-end">
            <button type="submit" className="btn-primary">
              Continue to Advottic
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="card p-6 hover:border-gold-500/50 transition-colors">
      <p className="font-mono text-xs text-gold-700 mb-3">{n}</p>
      <h3 className="font-semibold tracking-tight text-forest-900 mb-1.5 text-[15px]">{title}</h3>
      <p className="text-sm text-ink-600 leading-relaxed">{body}</p>
    </div>
  );
}

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed || trimmed.includes('@')) return trimmed.split('@')[0];
  return trimmed.split(/\s+/)[0];
}
