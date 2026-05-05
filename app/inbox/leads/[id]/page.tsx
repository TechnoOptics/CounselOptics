import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { AcceptFirmButton } from './accept-firm-button';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Lead responses · Inbox · Advottic',
  robots: { index: false, follow: false },
};

/**
 * Consumer view of a marketplace lead they submitted. Lists every
 * firm that has marked "interested" with their proposed fee + any
 * message, and lets the consumer pick one. Picking reveals contact
 * details to the chosen firm and politely declines the rest.
 */
export default async function ConsumerLeadResponsesPage({
  params,
}: {
  params: { id: string };
}) {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/inbox/leads/${params.id}`);

  const admin = createAdminSupabase();
  if (!admin) notFound();

  // Pull the lead + verify ownership.
  const { data: leadRow } = await admin
    .from('firm_leads')
    .select(
      'id, user_id, jurisdiction_state, practice_areas, summary, urgency, status, created_at',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (!leadRow) notFound();
  const lead = leadRow as {
    id: string;
    user_id: string;
    jurisdiction_state: string | null;
    practice_areas: string[];
    summary: string;
    urgency: string | null;
    status: string;
    created_at: string;
  };
  if (lead.user_id !== user.id) notFound();

  // Pull all responses for this lead.
  const { data: respRaw } = await admin
    .from('firm_lead_responses')
    .select('id, firm_id, response_type, proposed_fee, message, created_at')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: true });
  const responses = (respRaw ?? []) as Array<{
    id: string;
    firm_id: string;
    response_type:
      | 'interested'
      | 'pass'
      | 'accepted'
      | 'declined_by_user';
    proposed_fee: string | null;
    message: string | null;
    created_at: string;
  }>;

  // Hydrate firm names.
  const firmIds = Array.from(new Set(responses.map((r) => r.firm_id)));
  const { data: firmsRaw } = await admin
    .from('firms')
    .select('id, name, accent_color, logo_url, jurisdictions, practice_areas')
    .in('id', firmIds);
  const firmMap = new Map(
    ((firmsRaw ?? []) as Array<{
      id: string;
      name: string;
      accent_color: string;
      logo_url: string | null;
      jurisdictions: string[] | null;
      practice_areas: string[] | null;
    }>).map((f) => [f.id, f]),
  );

  const interested = responses.filter((r) => r.response_type === 'interested');
  const accepted = responses.find((r) => r.response_type === 'accepted');

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/inbox"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Inbox
        </Link>
      </p>

      <header>
        <p className="eyebrow mb-1">Inbox · lead responses</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {lead.practice_areas?.slice(0, 2).join(', ') ?? 'Your matter'}
          {lead.jurisdiction_state ? ` · ${lead.jurisdiction_state}` : ''}
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
          {accepted
            ? 'You accepted a firm. They have your contact details and will reach out within 24 hours.'
            : interested.length > 0
              ? `${interested.length} firm${interested.length === 1 ? '' : 's'} expressed interest. Pick one to share your contact details and start the engagement.`
              : 'No firm responses yet. We notified matching firms in your state - typical response time is 24-48 hours.'}
        </p>
      </header>

      <section className="card p-5 sm:p-6 space-y-2">
        <p className="eyebrow text-[10px]">Your brief</p>
        <p className="text-[13.5px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap">
          {lead.summary}
        </p>
        <p className="text-[11px] text-ink-400 dark:text-cream-100/45 font-mono pt-1">
          Submitted {new Date(lead.created_at).toLocaleString()}
        </p>
      </section>

      {interested.length > 0 && !accepted && (
        <section className="space-y-3">
          <h2 className="font-display text-lg text-forest-900 dark:text-cream-100">
            Interested firms
          </h2>
          <ul className="space-y-3">
            {interested.map((r) => {
              const firm = firmMap.get(r.firm_id);
              if (!firm) return null;
              return (
                <li key={r.id} className="card p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-10 w-10 shrink-0 rounded-md inline-flex items-center justify-center text-white font-semibold shadow-sm"
                      style={{ backgroundColor: firm.accent_color }}
                      aria-hidden
                    >
                      {firm.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg text-forest-900 dark:text-cream-100 truncate">
                        {firm.name}
                      </p>
                      {firm.practice_areas && firm.practice_areas.length > 0 && (
                        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 truncate">
                          {firm.practice_areas.slice(0, 4).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                  {r.message && (
                    <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap italic">
                      &ldquo;{r.message}&rdquo;
                    </p>
                  )}
                  {r.proposed_fee && (
                    <p className="text-[12.5px]">
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55 mr-2">
                        Proposed
                      </span>
                      <span className="text-forest-900 dark:text-cream-100 font-semibold">
                        {r.proposed_fee}
                      </span>
                    </p>
                  )}
                  <div className="flex justify-end">
                    <AcceptFirmButton leadId={lead.id} firmId={firm.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {accepted && (
        <section className="card p-5 ring-1 ring-emerald-300/50 dark:ring-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-950/20">
          <p className="eyebrow text-emerald-700 dark:text-emerald-300 mb-1">
            Accepted
          </p>
          <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed">
            You picked{' '}
            <strong>{firmMap.get(accepted.firm_id)?.name ?? 'a firm'}</strong>.
            They have your contact details and will reach out shortly. Other
            firms have been politely declined.
          </p>
        </section>
      )}
    </div>
  );
}
