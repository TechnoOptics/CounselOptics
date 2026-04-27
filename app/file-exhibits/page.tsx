import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { JURISDICTIONS } from '@/lib/jurisdictions';
import { FileExhibitsPicker } from './picker';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'File exhibits with the court - Advottic',
  description:
    "A starting point for filing exhibits in U.S. federal court and every state court. Pick your jurisdiction to see the e-filing portal, accepted formats, fee waivers, and what to expect from service of process.",
};

export default async function FileExhibitsPage() {
  // Pro-only resource. Signed-out visitors get sent to sign-in;
  // non-Pro subscribers get sent to /billing to upgrade.
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect('/sign-in?next=/file-exhibits');
    const sub = await getCurrentSubscription();
    const tier = sub?.tier ?? null;
    const status = sub?.status ?? 'inactive';
    const isProActive = tier === 'pro' && (status === 'active' || status === 'trialing');
    if (!isProActive) redirect('/billing?gate=file-exhibits');
  }

  const federal = JURISDICTIONS.find((j) => j.code === 'FED')!;
  const states = JURISDICTIONS.filter((j) => j.code !== 'FED');

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-up">
      <header className="text-center">
        <p className="eyebrow mb-3 justify-center">Court e-filing directory</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Filing exhibits to{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            the right portal
          </span>
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 mt-4 leading-relaxed max-w-2xl mx-auto">
          Every court has its own portal, format rules, and service requirements. Pick your
          jurisdiction below for the entry point, the file types they accept, and how to apply
          for a fee waiver if you cannot afford the filing fee.
        </p>
      </header>

      <section className="card p-5 sm:p-6 space-y-3">
        <p className="eyebrow">Read this first</p>
        <ul className="text-sm text-ink-700 dark:text-cream-100/80 space-y-2 leading-relaxed">
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              The court tells you the rules, not us.
            </strong>{' '}
            Each judge can add chambers rules on top of the local rules. Always read the rules
            for your specific case before filing.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              Redact personal information.
            </strong>{' '}
            Most courts require you to remove or partially mask Social Security numbers, account
            numbers, dates of birth, and minor names before filing. The court rarely fixes this
            for you.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              Service is your job.
            </strong>{' '}
            Filing with the court is not the same as serving the other side. If they are not
            registered with the e-filing system, you usually have to mail them a copy and file
            a certificate of service.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              Cannot afford the filing fee?
            </strong>{' '}
            Almost every court accepts an in forma pauperis (IFP) or fee-waiver application.
            See the fee-waiver link under your jurisdiction.
          </li>
        </ul>
      </section>

      <FederalCard jurisdiction={federal} />

      <FileExhibitsPicker states={states} />

      <section className="card p-6 text-center">
        <p className="eyebrow mb-2 justify-center">If filing is the next problem</p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Your exhibits should be ready before you file them.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-xl mx-auto">
          Build your case file in Advottic so each exhibit has a number, a date, a description,
          and a clean PDF that any court will accept.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/cases/new"
            className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-5 py-2.5"
          >
            Start a case file
          </Link>
          <Link href="/public-defender" className="btn-secondary px-5 py-2.5">
            I need a public defender
          </Link>
        </div>
      </section>
    </div>
  );
}

function FederalCard({ jurisdiction: j }: { jurisdiction: typeof JURISDICTIONS[number] }) {
  return (
    <section className="card p-6 sm:p-7 space-y-4 ring-1 ring-gold-300/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="eyebrow">Federal</p>
          <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
            {j.courtName}
          </h2>
        </div>
        <a
          href={j.portalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-secondary text-[13px]"
        >
          Open PACER / CM/ECF
        </a>
      </div>
      <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">{j.summary}</p>
      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <Field label="Accepted formats" value={j.formats} />
        <Field label="Service" value={j.service} />
        {j.feeWaiver && (
          <Field
            label="Fee waiver"
            value={
              j.feeWaiver.url ? (
                <a
                  href={j.feeWaiver.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
                >
                  {j.feeWaiver.label}
                </a>
              ) : (
                j.feeWaiver.label
              )
            }
          />
        )}
        {j.selfHelpUrl && (
          <Field
            label="Self help"
            value={
              <a
                href={j.selfHelpUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
              >
                Federal courts pro se resources
              </a>
            }
          />
        )}
      </dl>
      <ul className="list-disc list-outside pl-5 text-[13px] text-ink-600 dark:text-cream-100/70 space-y-1.5 leading-relaxed">
        {j.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {label}
      </dt>
      <dd className="text-[13.5px] text-ink-700 dark:text-cream-100/80 mt-1 leading-relaxed">
        {value}
      </dd>
    </div>
  );
}
