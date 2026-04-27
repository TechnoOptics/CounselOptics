import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PUBLIC_DEFENDERS } from '@/lib/public-defenders';
import { PublicDefenderPicker } from './picker';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Find a public defender - Advottic',
  description:
    'A starting point for getting a public defender if you are facing criminal charges, plus civil legal-aid resources for non-criminal matters. State-by-state directory.',
};

export default async function PublicDefenderPage() {
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect('/sign-in?next=/public-defender');
    const sub = await getCurrentSubscription();
    const tier = sub?.tier ?? null;
    const status = sub?.status ?? 'inactive';
    const isProActive = tier === 'pro' && (status === 'active' || status === 'trialing');
    if (!isProActive) redirect('/billing?gate=public-defender');
  }

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
