import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmLeadForFirm } from '@/lib/marketplace-storage';
import { LeadResponseForm } from './lead-response-form';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead · Counsel' };

export default async function FirmLeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const lead = await getFirmLeadForFirm(ctx.firm.id, params.id);
  if (!lead) notFound();

  const accepted = lead.acceptedByConsumer;

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/leads"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Leads</T>
        </Link>
      </p>

      <header>
        <p className="eyebrow mb-1"><T>Lead</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {lead.practiceAreas.slice(0, 2).join(', ') || <T>Legal matter</T>}
          {lead.jurisdictionState ? ` · ${lead.jurisdictionState}` : ''}
        </h1>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
          <T>Received</T> {new Date(lead.createdAt).toLocaleString()} · <T>urgency</T>{' '}
          {lead.urgency ?? 'normal'}
        </p>
      </header>

      <section className="card p-5 sm:p-6 space-y-4">
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Brief</T></p>
          <p className="text-[14px] text-ink-800 dark:text-cream-100/90 leading-relaxed whitespace-pre-wrap">
            {lead.summary}
          </p>
        </div>
        {lead.budget && (
          <div>
            <p className="eyebrow text-[10px] mb-1"><T>Budget signaled</T></p>
            <p className="text-[13px] text-ink-700 dark:text-cream-100/80">
              {lead.budget}
            </p>
          </div>
        )}
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Practice areas</T></p>
          <div className="flex flex-wrap gap-1">
            {lead.practiceAreas.map((p) => (
              <span
                key={p}
                className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[11px]"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {accepted ? (
        <section className="card p-5 sm:p-6 ring-1 ring-emerald-300/50 dark:ring-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
          <p className="eyebrow text-emerald-700 dark:text-emerald-300">
            <T>Accepted by consumer</T>
          </p>
          <h2 className="font-display text-xl text-forest-900 dark:text-cream-100">
            <T>Contact details unlocked</T>
          </h2>
          <dl className="grid sm:grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55 mb-0.5">
                <T>Name</T>
              </dt>
              <dd className="text-forest-900 dark:text-cream-100">
                {lead.contactName}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55 mb-0.5">
                <T>Email</T>
              </dt>
              <dd className="text-forest-900 dark:text-cream-100">
                <a href={`mailto:${lead.contactEmail}`} className="underline">
                  {lead.contactEmail}
                </a>
              </dd>
            </div>
            {lead.contactPhone && (
              <div>
                <dt className="font-mono text-[10.5px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55 mb-0.5">
                  <T>Phone</T>
                </dt>
                <dd className="text-forest-900 dark:text-cream-100">
                  <a href={`tel:${lead.contactPhone}`} className="underline">
                    {lead.contactPhone}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-[12px] text-ink-600 dark:text-cream-100/70 leading-relaxed pt-2 border-t border-emerald-200 dark:border-emerald-800/40">
            <T>Reach out within 24 hours - the consumer is expecting you.</T>
          </p>
        </section>
      ) : lead.firmResponse ? (
        <section className="card p-5 ring-1 ring-amber-300/50 dark:ring-amber-700/40 bg-amber-50/30 dark:bg-amber-950/15">
          <p className="eyebrow text-amber-800 dark:text-amber-200 mb-1">
            <T>Your response sent</T>
          </p>
          <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed">
            <T>You marked this lead as</T> <strong>{lead.firmResponse.responseType}</strong>{' '}
            <T>on</T> {new Date(lead.firmResponse.createdAt).toLocaleString()}.
            {lead.firmResponse.responseType === 'interested' && (
              <> <T>The consumer was notified - we'll let you know if they accept.</T></>
            )}
          </p>
        </section>
      ) : (
        <LeadResponseForm firmId={ctx.firm.id} leadId={lead.id} />
      )}
    </div>
  );
}
