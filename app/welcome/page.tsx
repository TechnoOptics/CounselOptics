import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { InstallAppButton } from '@/components/InstallAppButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Welcome to Advottic',
  description:
    'A friend shared Advottic with you. Sign in or install the app on your home screen to get your case file in order before meeting an attorney.',
};

export default async function WelcomePage() {
  // Authed users skip the welcome screen and land on /cases (where the
  // consent modal appears if needed). New / unauthed visitors get the
  // marketing-ish landing with install + sign-in.
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (user) redirect('/cases');
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10 animate-fade-up">
      {/* Hero */}
      <section className="text-center space-y-5">
        <span className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 ring-1 ring-gold-400/30 shadow-brand-glow mx-auto">
          <Image
            src="/advottic-mark.png"
            alt=""
            width={48}
            height={48}
            className="select-none"
            priority
          />
        </span>
        <p className="eyebrow justify-center">A friend sent you here</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.02] text-forest-900 dark:text-cream-100">
          Welcome to{' '}
          <span className="bg-gold-shine bg-clip-text text-transparent gold-pan italic">
            Advottic
          </span>
          .
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-cream-100/70 max-w-xl mx-auto leading-relaxed">
          Advottic helps you organize evidence, surface the issues that matter, and walk into a
          meeting with an attorney holding a packet they can read in five minutes.
        </p>
      </section>

      {/* Two paths: install or sign in */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card p-6 space-y-3">
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
            Step 1 (optional)
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Add Advottic to your home screen.
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            One tap to install. The Advottic icon will sit next to your other apps and launches
            full-screen, no browser bars. Works on iPhone, Android, and desktop Chrome.
          </p>
          <InstallAppButton />
        </div>

        <div className="card p-6 space-y-3">
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
            Step 2
          </p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Create your account.
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
            Sign in with Google, Microsoft, or a one-time email link. We will create your
            Advottic account on first sign-in - no separate signup form, no card needed.
          </p>
          <Link href="/sign-in?next=/cases" className="btn-primary">
            Sign in or create account →
          </Link>
        </div>
      </section>

      {/* What you get */}
      <section className="card-ai p-6 sm:p-8 space-y-4">
        <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-300">
          What you get
        </p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-cream-100">
          A clean case file an attorney can read in five minutes.
        </h2>
        <ul className="space-y-2 text-sm text-cream-100/85 leading-relaxed">
          <Bullet>
            <strong>Capture</strong> every piece of evidence - photos, PDFs, audio, video,
            screenshots - auto-numbered as exhibits with category, source, and incident date.
          </Bullet>
          <Bullet>
            <strong>Legal Eye review</strong> - jurisdiction-aware issue spotting, evidence
            gaps, and possible subpoena targets. Hedged language, never legal advice.
          </Bullet>
          <Bullet>
            <strong>Hearing countdown + checklist</strong> for the days leading up to court.
          </Bullet>
          <Bullet>
            <strong>One-page packet export</strong> as a clean PDF you can email to counsel.
          </Bullet>
          <Bullet>
            <strong>Bella, your assistant</strong> - a powerful and informed helper who can
            answer questions in plain English, find what you have already saved, and never
            shares your case with anyone but you.
          </Bullet>
        </ul>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link href="/example" className="btn-secondary text-sm">
            Tour an example case
          </Link>
          <Link
            href="/sign-in?next=/cases/new"
            className="btn bg-gold-metal text-forest-950 hover:brightness-110 font-semibold text-sm px-4 py-2"
          >
            Start your own
          </Link>
        </div>
      </section>

      {/* Trust */}
      <section className="text-center text-xs text-ink-500 dark:text-cream-100/55 max-w-xl mx-auto">
        Advottic provides legal information and case organization, not legal advice. Always
        consult a licensed attorney in your jurisdiction before acting. Your case content is
        encrypted in transit and at rest, and stays yours.{' '}
        <Link
          href="/security"
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          Trust &amp; Security
        </Link>
        .
      </section>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="flex-none mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-400"
      />
      <span>{children}</span>
    </li>
  );
}
