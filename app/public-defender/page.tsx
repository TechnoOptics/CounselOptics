import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from '@/components/ExternalLink';
import { PUBLIC_DEFENDERS } from '@/lib/public-defenders';
import { PublicDefenderPicker } from './picker';

export const metadata: Metadata = {
  title: 'Find a public defender',
  description:
    'A starting point for getting a public defender if you are facing criminal charges, plus civil legal-aid resources for non-criminal matters. State-by-state directory.',
  alternates: { canonical: '/public-defender' },
  openGraph: {
    title: 'Find a public defender',
    description:
      'State-by-state directory of public defender offices and civil legal-aid organizations. If you cannot afford a lawyer, you have options.',
    url: '/public-defender',
    type: 'website',
  },
  keywords: [
    'find a public defender',
    'free criminal defense',
    'civil legal aid near me',
    'public defender contact',
    'cant afford a lawyer',
    'free legal help',
  ],
};

export default function PublicDefenderPage() {
  // Free for everyone, no sign-in. The constitutional right to a
  // public defender is not a paid Advottic feature - the homepage
  // and /about both promise this resource will be in front of users
  // "at every decision point", so the directory must always be
  // accessible to logged-out visitors and trial users. (Previously
  // gated behind Pro; removed per audit 2026-05-11.)
  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-up">
      <header className="text-center">
        <p className="eyebrow mb-3 justify-center">Free legal counsel</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Asking for a{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            public defender
          </span>
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 mt-4 leading-relaxed max-w-2xl mx-auto">
          If you are facing criminal charges and cannot afford a lawyer, the Constitution gives
          you the right to one at no cost. Here is how the right works, who to ask, and where
          to start in your state.
        </p>
      </header>

      <section className="card p-5 sm:p-6 space-y-3">
        <p className="eyebrow">When the right attaches</p>
        <ul className="text-sm text-ink-700 dark:text-cream-100/80 space-y-2 leading-relaxed">
          <li>
            <strong className="text-forest-900 dark:text-cream-100">Criminal cases.</strong>{' '}
            Under{' '}
            <em>Gideon v. Wainwright</em>{' '}
            (1963) and{' '}
            <em>Argersinger v. Hamlin</em>{' '}
            (1972), if you are charged with a crime that could result in jail time and you
            cannot afford a lawyer, the court must appoint one for free.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">Most civil cases.</strong>{' '}
            Eviction, custody, consumer debt, immigration: there is generally{' '}
            <em>no</em>{' '}
            constitutional right to appointed counsel. Civil legal-aid organizations exist for
            exactly this gap. Each state below also lists civil legal aid you can call.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">Ask early.</strong>{' '}
            At your first court appearance (arraignment, presentment, or initial hearing), tell
            the judge in plain words: &ldquo;I cannot afford an attorney and I am asking for
            court-appointed counsel.&rdquo; That is the magic sentence. The court will hand you
            a financial affidavit.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              Tell the truth on the affidavit.
            </strong>{' '}
            Income, assets, dependents, expenses. Most states allow appointment if your income
            is at or near the federal poverty line. Some states are stricter, some more
            generous; the form will say.
          </li>
          <li>
            <strong className="text-forest-900 dark:text-cream-100">
              Do not skip your court date.
            </strong>{' '}
            Even if you do not have a lawyer yet, show up. Tell the court you are still trying
            to get appointed counsel. A bench warrant is the worst outcome.
          </li>
        </ul>
      </section>

      <section className="card p-5 sm:p-6 space-y-3 ring-1 ring-rose-200 dark:ring-rose-900/40">
        <p className="eyebrow text-rose-700 dark:text-rose-300">If you are in custody right now</p>
        <ul className="text-sm text-ink-700 dark:text-cream-100/80 space-y-2 leading-relaxed">
          <li>
            You can ask the police or jail staff to call your local public defender. In many
            cities the PD has a 24/7 hotline.
          </li>
          <li>
            You have the right to remain silent and the right to a lawyer before answering
            questions. You can say: &ldquo;I want a lawyer. I will not answer questions until I
            have one.&rdquo; Then stop talking.
          </li>
          <li>
            If you are a U.S. citizen, you do not have to discuss immigration. If you are not,
            ask for a lawyer before answering immigration questions.
          </li>
        </ul>
      </section>

      <PublicDefenderPicker records={PUBLIC_DEFENDERS} />

      {/* Server-rendered state-by-state public-defender + civil legal-aid
          directory. Audit W20 P0 (bug B3) flagged that crawlers and no-JS
          visitors saw an effectively-empty body because the picker above
          is `'use client'`. This SSR block lists every state's primary
          PD office, civil-legal-aid orgs, and the apply-for-counsel
          steps so the page earns the high-intent search traffic
          ("public defender [state]", "free legal aid near me") it
          already targets in the meta keywords. */}
      <section
        id="state-directory"
        className="space-y-6 scroll-mt-24"
        aria-label="Public defender state directory"
      >
        <header className="space-y-2">
          <p className="eyebrow">Every state · alphabetical</p>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Public defender offices, state by state.
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed max-w-3xl">
            Each state below lists the primary public-defender office (for
            criminal cases) and the main civil legal-aid organizations (for
            eviction, custody, debt, and similar non-criminal matters where
            no right to appointed counsel attaches). Phone numbers and URLs
            are the current public contact points; please verify on the
            office&rsquo;s site before relying.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          {PUBLIC_DEFENDERS.slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((r) => (
              <article
                key={r.code}
                className="rounded-lg border border-ink-200/70 dark:border-forest-700/40 bg-cream-50/50 dark:bg-forest-900/40 p-4 space-y-2"
              >
                <header>
                  <h3 className="font-display text-base font-medium text-forest-900 dark:text-cream-100">
                    {r.name}
                  </h3>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/60 mt-0.5">
                    {r.pdOffice.name}
                  </p>
                </header>
                <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-snug">
                  {r.summary}
                </p>
                <div className="pt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                  <ExternalLink
                    href={r.pdOffice.url}
                    className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
                  >
                    Public defender office →
                  </ExternalLink>
                  {r.pdOffice.phone && (
                    <a
                      href={`tel:${r.pdOffice.phone.replace(/[^+\d]/g, '')}`}
                      className="underline text-ink-700 dark:text-cream-100/80 hover:text-forest-700"
                    >
                      {r.pdOffice.phone}
                    </a>
                  )}
                </div>
                {r.civilLegalAid.length > 0 && (
                  <div className="pt-1 text-[12px] leading-snug">
                    <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700 dark:text-gold-300 mb-1">
                      Civil legal aid
                    </p>
                    <ul className="space-y-0.5">
                      {r.civilLegalAid.map((org) => (
                        <li key={org.url}>
                          <ExternalLink
                            href={org.url}
                            className="underline text-ink-700 dark:text-cream-100/75 hover:text-forest-700"
                          >
                            {org.name}
                          </ExternalLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
        </div>
      </section>

      <section className="card p-6 text-center">
        <p className="eyebrow mb-2 justify-center">After you have a lawyer</p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          A clean case file makes their first ten minutes count.
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-xl mx-auto">
          Public defenders are stretched thin. Show up with a one-page timeline, your exhibits
          numbered, and the questions you want answered. We will help you put it together.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/cases/new"
            className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-5 py-2.5"
          >
            Start a case file
          </Link>
          <Link href="/file-exhibits" className="btn-secondary px-5 py-2.5">
            Where to file exhibits
          </Link>
        </div>
      </section>
    </div>
  );
}
