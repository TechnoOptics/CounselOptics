import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listMyFeedback } from '@/lib/storage';
import { SupportTicketForm } from '@/components/SupportTicketForm';
import { TicketHistory } from '@/components/TicketHistory';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help & support · Counsel' };

/**
 * Help & support for the legal team: open a ticket to the Advottic
 * team (bug, design request, or question) and see the status of the
 * ones you've opened. Tickets flow into the same queue Advottic
 * triages, so nothing is a dead end.
 */
export default async function CounselHelpPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const tickets = await listMyFeedback();

  return (
    <div className="space-y-6 animate-fade-up max-w-3xl">
      <PageHeader
        eyebrow={<T>Help &amp; support</T>}
        title={<T>Talk to the Advottic team</T>}
        // No max-w: the page is already capped at max-w-3xl, and the
        // primitive's default max-w-2xl would rewrap this paragraph
        // narrower than everything under it.
        subtitleClassName="mt-1"
        subtitle={
          <>
            <T>Something not working, or an idea for how Advottic could work
            better for</T> {ctx.firm.name}?{' '}
            <T>Open a ticket and we&rsquo;ll follow
            up by email. For anything about a matter or a client, use your
            firm&rsquo;s own channels. This goes to Advottic, not your firm.</T>
          </>
        }
      />

      <SupportTicketForm />

      <TicketHistory tickets={tickets} />
    </div>
  );
}
