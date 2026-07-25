import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { AidChat } from './aid-chat';
import { T } from '@/components/i18n/LocaleProvider';

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
    // Fill the available viewport so the chat sits on one screen: the
    // header takes its natural height and the chat flexes to fill the
    // rest (only the message list inside scrolls). The calc offsets the
    // counsel header, footer, and layout padding. min-h keeps it usable
    // on very short screens (where the page may scroll, which is fine).
    <div className="flex flex-col gap-4 animate-fade-up h-[calc(100dvh-9.5rem)] min-h-[28rem]">
      <header className="flex-none">
        <p className="eyebrow mb-1"><T>Counsel · Advottic Aid</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Advottic Aid</T>
        </h1>
        <p className="hidden sm:block text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>Ask questions about your matters and get answers grounded in
          real case law for</T> <strong>{where}</strong>,{' '}
          <T>plus instant
          retrieval of your firm&rsquo;s past items. Powered by Bella
          with live CourtListener case-law search.</T>
        </p>
      </header>
      <div className="flex-1 min-h-0">
        <AidChat />
      </div>
    </div>
  );
}
