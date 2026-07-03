import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listMyFeedback } from '@/lib/storage';
import { SupportTicketForm } from '@/components/SupportTicketForm';
import { TicketHistory } from '@/components/TicketHistory';

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
      <header>
        <p className="eyebrow mb-1">Help &amp; support</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Talk to the Advottic team
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
          Something not working, or an idea for how Advottic could work
          better for {ctx.firm.name}? Open a ticket and we&rsquo;ll follow
          up by email. For anything about a matter or a client, use your
          firm&rsquo;s own channels — this goes to Advottic, not your firm.
        </p>
      </header>

      <SupportTicketForm />

      <TicketHistory tickets={tickets} />
    </div>
  );
}
