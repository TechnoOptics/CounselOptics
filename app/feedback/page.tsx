import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { FeedbackPanel } from './feedback-panel';

export const dynamic = 'force-dynamic';

// The root layout sets `template: '%s · Advottic'`, so a bare 'Feedback'
// here renders as "Feedback · Advottic". The previous value
// "Feedback - Advottic" was getting the suffix appended too, producing
// the visible "Feedback - Advottic · Advottic" double-brand.
export const metadata: Metadata = {
  title: 'Feedback',
  description:
    'Report a bug, suggest a feature, or just tell us how Advottic is working for you.',
  alternates: { canonical: '/feedback' },
  robots: { index: false, follow: false },
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

      <FeedbackPanel />
    </div>
  );
}
