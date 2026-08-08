import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmLeadForFirm } from '@/lib/marketplace-storage';
import { LeadResponseForm } from './lead-response-form';
import { PageHeader } from '@/components/counsel/ui';
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
          className="text-muted hover:text-foreground"
        >
          <T>&larr; Leads</T>
        </Link>
      </p>

      <PageHeader
        eyebrow={<T>Lead</T>}
        title={
          <>
            {lead.practiceAreas.slice(0, 2).join(', ') || <T>Legal matter</T>}
            {lead.jurisdictionState ? ` · ${lead.jurisdictionState}` : ''}
          </>
        }
        meta={
          <>
            <T>Received</T> {new Date(lead.createdAt).toLocaleString()} ·{' '}
            <T>urgency</T> {lead.urgency ?? 'normal'}
          </>
        }
      />

      <section className="card p-5 sm:p-6 space-y-4">
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Brief</T></p>
          <p className="text-[14px] text-foreground leading-relaxed whitespace-pre-wrap">
            {lead.summary}
          </p>
        </div>
        {lead.budget && (
          <div>
            <p className="eyebrow text-[10px] mb-1"><T>Budget signaled</T></p>
            <p className="text-[13px] text-foreground">
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
                className="badge bg-surface-2 text-foreground text-[11px]"
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
          <h2 className="text-xl text-foreground">
            <T>Contact details unlocked</T>
          </h2>
          <dl className="grid sm:grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted mb-0.5">
                <T>Name</T>
              </dt>
              <dd className="text-foreground">
                {lead.contactName}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted mb-0.5">
                <T>Email</T>
              </dt>
              <dd className="text-foreground">
                <a href={`mailto:${lead.contactEmail}`} className="underline">
                  {lead.contactEmail}
                </a>
              </dd>
            </div>
            {lead.contactPhone && (
              <div>
                <dt className="font-mono text-[10.5px] uppercase tracking-wider text-muted mb-0.5">
                  <T>Phone</T>
                </dt>
                <dd className="text-foreground">
                  <a href={`tel:${lead.contactPhone}`} className="underline">
                    {lead.contactPhone}
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-[12px] text-muted leading-relaxed pt-2 border-t border-emerald-200 dark:border-emerald-800/40">
            <T>Reach out within 24 hours - the consumer is expecting you.</T>
          </p>
        </section>
      ) : lead.firmResponse ? (
        <section className="card p-5 ring-1 ring-amber-300/50 dark:ring-amber-700/40 bg-amber-50/30 dark:bg-amber-950/15">
          <p className="eyebrow text-amber-800 dark:text-amber-200 mb-1">
            <T>Your response sent</T>
          </p>
          <p className="text-[13px] text-foreground leading-relaxed">
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
