import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { AidChat } from './aid-chat';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Advottic Aid · Counsel' };

export default async function CounselAidPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const where =
    ctx.firm.jurisdictions.length > 0
      ? ctx.firm.jurisdictions.slice(0, 3).join(', ')
      : 'your jurisdictions';

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · Advottic Aid</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Advottic Aid
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Ask questions about your matters and get answers grounded in
          real case law for <strong>{where}</strong>, plus instant
          retrieval of your firm&rsquo;s past items. Powered by Bella
          with live CourtListener case-law search.
        </p>
      </header>
      <AidChat />
    </div>
  );
}
