import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listMyFeedback } from '@/lib/storage';
import { FeedbackForm } from './feedback-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feedback - Advottic',
  description:
    'Report a bug, suggest a feature, or just tell us how Advottic is working for you.',
};

export default async function FeedbackPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Feedback requires Supabase. See <code className="font-mono">SETUP.md</code>.
        </p>
      </div>
    );
  }
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/feedback');

  const mine = await listMyFeedback().catch(() => []);

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-2">Feedback</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Tell us what's working and what is not.
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-2xl leading-relaxed">
          Bug reports, feature requests, suggestions, or just kind words. Anything you submit
          here goes to the Advottic team. For urgent legal questions please consult a licensed
          attorney instead.
        </p>
      </header>

      <FeedbackForm />

      {mine.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700 dark:text-gold-300">
            Your previous feedback
          </h2>
          <ul className="space-y-2">
            {mine.map((f) => (
              <li
                key={f.id}
                className="card p-4 flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="badge bg-forest-900 text-cream-200 dark:bg-gold-metal dark:text-forest-950 capitalize">
                      {f.category}
                    </span>
                    <span
                      className={`badge ${statusBadge(f.status)}`}
                      aria-label={`Status: ${f.status}`}
                    >
                      {humanStatus(f.status)}
                    </span>
                    <span className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono">
                      {new Date(f.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <p className="font-semibold text-ink-950 dark:text-cream-100 truncate">
                    {f.subject}
                  </p>
                  <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                    {f.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="text-xs text-ink-500 dark:text-cream-100/55">
        For urgent contact:{' '}
        <a
          href="mailto:contact@advottic.com"
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          contact@advottic.com
        </a>{' '}
        ·{' '}
        <Link href="/security" className="underline hover:text-forest-900 dark:hover:text-cream-100">
          Trust &amp; Security
        </Link>
      </div>
    </div>
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case 'new':
      return 'bg-cream-100 text-forest-900 border border-gold-300 dark:bg-forest-800 dark:text-cream-100 dark:border-gold-500/40';
    case 'triaged':
      return 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-700/40';
    case 'resolved':
      return 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/40';
    case 'wontfix':
      return 'bg-ink-100 text-ink-700 border border-ink-200 dark:bg-forest-800 dark:text-cream-100/70';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}
function humanStatus(s: string): string {
  if (s === 'wontfix') return "Won't fix";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
