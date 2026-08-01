import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { getWorkspacePersona } from '@/lib/persona';
import { listMyFeedback } from '@/lib/storage';
import { SupportTicketForm } from '@/components/SupportTicketForm';
import { TicketHistory } from '@/components/TicketHistory';
import { PageHeader } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help · Hub' };

/**
 * Help & support for employees. Opens a ticket to the Advottic team
 * (not the firm's legal team - for a legal request they use "New
 * request"). Tickets appear below with their status.
 */
export default async function HubHelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/help');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');
  const tickets = await listMyFeedback();

  return (
    <div className="space-y-6 animate-fade-up max-w-3xl">
      <PageHeader
        eyebrow={<>Help &amp; support</>}
        title="Talk to the Advottic team"
        subtitle={
          <>
            Something in the app not working, or a suggestion? Open a ticket and
            we&rsquo;ll follow up by email. Need something from your legal team
            instead? Use{' '}
            <a href="/portal/new" className="underline">
              New request
            </a>{' '}
            (this form goes to Advottic, not {persona.firm.name}).
          </>
        }
      />

      <SupportTicketForm tone="dark" />

      <TicketHistory tickets={tickets} />
    </div>
  );
}
