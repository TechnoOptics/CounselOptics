import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from '@/components/ExternalLink';
import { JURISDICTIONS, type Jurisdiction } from '@/lib/jurisdictions';
import { FileExhibitsPicker } from './picker';

// Short labels for the SSR directory's pro-se badge column. Mirrors
// the labels in picker.tsx but tighter for the inline list use.
const PRO_SE_SHORT: Record<Jurisdiction['proSeAllowed'], string> = {
  yes: 'Pro se OK',
  limited: 'Pro se limited',
  no: 'Attorneys only',
  'paper-fallback': 'Paper filing',
};

export const metadata: Metadata = {
  title: 'File exhibits with the court',
  description:
    'A starting point for filing exhibits in U.S. federal court and every state court. Pick your jurisdiction to see the e-filing portal, accepted formats, fee waivers, and service-of-process basics.',
  alternates: { canonical: '/file-exhibits' },
  openGraph: {
    title: 'File exhibits with the court',
    description:
      'State-by-state e-filing portal directory: federal PACER, every state e-filing system, accepted formats, and fee-waiver information.',
    url: '/file-exhibits',
    type: 'website',
  },
  keywords: [
    'how to file exhibits',
    'court e-filing',
    'efile court documents',
    'state court filing portal',
    'PACER',
    'fee waiver',
    'self represented filing',
  ],
};

export default function FileExhibitsPage() {
  // Free for everyone, no sign-in. The directory of court e-filing
  // portals is public-good information (right alongside the
  // public-defender directory). Previously gated behind Pro; removed
  // per audit 2026-05-11 because the gate meant crawlers and JS-
  // disabled users saw empty SSR, and the content itself is just a
  // curated set of links to government websites - nothing
  // proprietary to gate.
  const federal = JURISDICTIONS.find((j) => j.code === 'FED')!;
  const states = JURISDICTIONS.filter((j) => j.code !== 'FED');

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-up">
      <header className="text-center">
        <p className="eyebrow mb-3 justify-center">Court e-filing directory</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Filing exhibits to{' '}
          <span className="bg-gold-shine-ink dark:bg-gold-shine bg-clip-text text-transparent gold-pan italic">
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

      {/* Server-rendered state directory. Audit W20 P0 (bug B2) flagged
          that crawlers and no-JS users saw an effectively-empty body
          because the FileExhibitsPicker above is `'use client'` -
          excellent UX (geo-sort + search), but invisible to Google and
          Bing without JS execution. This SSR block is the canonical
          state-by-state list: every state, court system, portal link
          (rel=nofollow noreferrer to government sites), accepted formats,
          and a fee-waiver flag. SEO crawlers index it; screen readers
          read it; the interactive picker enhances on hydration. */}
      <section
        id="state-directory"
        className="space-y-6 scroll-mt-24"
        aria-label="State court e-filing directory"
      >
        <header className="space-y-2">
          <p className="eyebrow">Every state · alphabetical</p>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Court e-filing portals, state by state.
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-3xl">
            Each link goes to the court&rsquo;s official e-filing landing page.
            Court rules change; the entry-point URL stays stable. Re-verify
            filing fees and waiver eligibility on the court&rsquo;s own site
            before relying on the figures here.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          {states
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((j) => (
              <article
                key={j.code}
                className="rounded-lg border border-ink-200/70 dark:border-forest-700/40 bg-cream-50/50 dark:bg-forest-900/40 p-4 space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base font-medium text-forest-900 dark:text-cream-100">
                    {j.name}
                  </h3>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 font-semibold">
                    {PRO_SE_SHORT[j.proSeAllowed]}
                  </span>
                </div>
                <p className="text-[12.5px] text-ink-600 dark:text-cream-100/65 leading-snug">
                  {j.courtName}
                </p>
                <p className="text-[12.5px] text-ink-700 dark:text-cream-100/75 leading-snug">
                  <span className="font-semibold text-forest-800 dark:text-cream-100">
                    Accepted formats:
                  </span>{' '}
                  {j.formats}
                </p>
                <div className="pt-1.5 flex flex-wrap gap-3 text-[12.5px]">
                  <ExternalLink
                    href={j.portalUrl}
                    className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
                  >
                    Open e-filing portal →
                  </ExternalLink>
                  {j.feeWaiver?.url && (
                    <ExternalLink
                      href={j.feeWaiver.url}
                      className="underline text-ink-600 dark:text-cream-100/70 hover:text-forest-700"
                    >
                      Fee waiver
                    </ExternalLink>
                  )}
                  {j.selfHelpUrl && (
                    <ExternalLink
                      href={j.selfHelpUrl}
                      className="underline text-ink-600 dark:text-cream-100/70 hover:text-forest-700"
                    >
                      Self-help
                    </ExternalLink>
                  )}
                </div>
              </article>
            ))}
        </div>
      </section>

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
        <ExternalLink
          href={j.portalUrl}
          className="btn-secondary text-[13px]"
        >
          Open PACER / CM/ECF
        </ExternalLink>
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
                <ExternalLink
                  href={j.feeWaiver.url}
                  className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
                >
                  {j.feeWaiver.label}
                </ExternalLink>
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
              <ExternalLink
                href={j.selfHelpUrl}
                className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
              >
                Federal courts pro se resources
              </ExternalLink>
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
