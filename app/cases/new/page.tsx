import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SmartAssistForm } from './smart-assist';
import { getCurrentSubscription } from '@/lib/storage';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function NewCasePage() {
  // Post-trial paywall: lapsed subscribers get bounced to /billing
  // before they can fill out the wizard. Active and trialing users
  // see the form normally.
  if (isSupabaseConfigured()) {
    const sub = await getCurrentSubscription().catch(() => null);
    if (
      sub?.status === 'canceled' ||
      sub?.status === 'past_due' ||
      sub?.status === 'unpaid'
    ) {
      redirect('/billing?gate=trial-ended');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <div>
        <Link href="/cases" className="text-sm text-ink-500 hover:text-ink-700 dark:hover:text-cream-100">
          &larr; Back to cases
        </Link>
        <p className="eyebrow mt-3 mb-2">Smart assist</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Let&apos;s set up your case file.
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1.5 leading-relaxed">
          One question at a time. Skip anything optional. You can change everything later.
        </p>
      </div>

      <SmartAssistForm />
    </div>
  );
}
