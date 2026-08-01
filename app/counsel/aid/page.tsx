import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { AidChat } from './aid-chat';
import { PageHeader } from '@/components/counsel/ui';
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
      <PageHeader
        className="flex-none"
        eyebrow={<T>Counsel · Advottic Aid</T>}
        title={<T>Advottic Aid</T>}
        // Hidden under sm on purpose: this page is sized to one screen
        // and the chat needs the room a phone would give the blurb.
        subtitleClassName="mt-1 max-w-2xl hidden sm:block"
        subtitle={
          <>
            <T>Ask questions about your matters and get answers grounded in
            real case law for</T> <strong>{where}</strong>,{' '}
            <T>plus instant
            retrieval of your firm&rsquo;s past items. Powered by Bella
            with live CourtListener case-law search.</T>
          </>
        }
      />
      <div className="flex-1 min-h-0">
        <AidChat />
      </div>
    </div>
  );
}
