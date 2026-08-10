import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmLeadForFirm } from '@/lib/marketplace-storage';
import { LeadResponseForm } from './lead-response-form';
import { OpenMatterButton } from './open-matter-button';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  Chip,
  MonoRef,
  PanelCard,
  relativeTime,
  shortRef,
} from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead · Counsel' };

/** Same map as the list, so an urgency is one colour across the surface. */
const URGENCY_COLOR: Record<string, string> = {
  emergency: PILL_COLORS.flagged,
  high: PILL_COLORS.waiting,
  normal: PILL_COLORS.info,
  low: PILL_COLORS.neutral,
};

/**
 * One inbound lead, on the detail pattern: breadcrumb with a mono
 * reference, a meta chip row, then the record on the left and the
 * decision on the right.
 *
 * There is no action bar card. The detail pattern puts one above the
 * columns for a record with inline status, priority and assignee
 * selects; a lead has none of those. The one thing a firm can do to a
 * lead is answer it once, and that is a form with two buttons, so it
 * stays the aside rather than being flattened into a bar of controls
 * that do not exist.
 */
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
  const urgency = lead.urgency ?? 'normal';
  const received = relativeTime(lead.createdAt);
  const areas = lead.practiceAreas.slice(0, 2).join(', ');

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        align="start"
        backLink={
          <p className="flex items-center gap-2 text-[12.5px]">
            <Link href="/counsel/leads" className="text-muted hover:text-foreground">
              <T>Leads</T>
            </Link>
            <span className="text-muted" aria-hidden>
              /
            </span>
            <MonoRef title={lead.id}>{shortRef(lead.id)}</MonoRef>
          </p>
        }
        title={
          areas ? (
            <span data-no-translate>
              {areas}
              {lead.jurisdictionState ? ` · ${lead.jurisdictionState}` : ''}
            </span>
          ) : (
            <T>Legal matter</T>
          )
        }
      >
        {/* The meta chip row: live state first, then the facts about it,
            then plain muted provenance. */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <StatusPill dot color={URGENCY_COLOR[urgency] ?? URGENCY_COLOR.normal}>
            {urgency}
          </StatusPill>
          {lead.jurisdictionState && (
            <Chip tone="accent">
              <span data-no-translate>{lead.jurisdictionState}</span>
            </Chip>
          )}
          {lead.budget && (
            <Chip>
              <T>Budget</T>
              {': '}
              <span data-no-translate>{lead.budget}</span>
            </Chip>
          )}
          <span title={new Date(lead.createdAt).toLocaleString()}>
            <T>received</T> {received ?? new Date(lead.createdAt).toLocaleDateString()}
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <PanelCard title={<T>The brief</T>}>
            <p
              className="max-w-[70ch] whitespace-pre-wrap text-[14px] leading-relaxed text-foreground"
              data-no-translate
            >
              {lead.summary}
            </p>
          </PanelCard>

          {lead.practiceAreas.length > 0 && (
            <PanelCard title={<T>Practice areas</T>}>
              <div className="flex flex-wrap gap-1.5">
                {lead.practiceAreas.map((p) => (
                  <Chip key={p}>
                    <span data-no-translate>{p}</span>
                  </Chip>
                ))}
              </div>
            </PanelCard>
          )}
        </div>

        <aside className="space-y-4">
          {accepted ? (
            <PanelCard
              title={<T>Contact details unlocked</T>}
              className="ring-1 ring-emerald-300/50 dark:ring-emerald-700/40"
            >
              <dl className="space-y-3 text-[13px]">
                <div>
                  <dt className="mb-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted">
                    <T>Name</T>
                  </dt>
                  <dd className="text-foreground" data-no-translate>
                    {lead.contactName}
                  </dd>
                </div>
                <div>
                  <dt className="mb-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted">
                    <T>Email</T>
                  </dt>
                  <dd className="break-words text-foreground">
                    <a href={`mailto:${lead.contactEmail}`} className="underline">
                      {lead.contactEmail}
                    </a>
                  </dd>
                </div>
                {lead.contactPhone && (
                  <div>
                    <dt className="mb-0.5 font-mono text-[10.5px] uppercase tracking-wider text-muted">
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
              <p className="mt-3 border-t border-edge pt-3 text-[12px] leading-relaxed text-muted">
                <T>
                  Reach out within 24 hours. The consumer is expecting you.
                </T>
              </p>
              {/* The exit. Only drawn when the lead-to-matter link can be
                  read, because without it a second press would open a second
                  matter under the same person's name. */}
              {lead.caseLink.supported && (
                <OpenMatterButton
                  firmId={ctx.firm.id}
                  leadId={lead.id}
                  caseId={lead.caseLink.caseId}
                />
              )}
            </PanelCard>
          ) : lead.firmResponse ? (
            <PanelCard title={<T>Your response</T>}>
              <p className="text-[13px] leading-relaxed text-foreground">
                <T>You marked this lead as</T>{' '}
                <strong data-no-translate>{lead.firmResponse.responseType}</strong>{' '}
                <T>on</T>{' '}
                <span data-no-translate>
                  {new Date(lead.firmResponse.createdAt).toLocaleString()}
                </span>
                .
                {/* Only a lead with an account behind it has an inbox to
                    notify and a person who can accept. `user_id` on
                    firm_leads is nullable and anonymous submissions are a
                    supported path, so this used to promise both to every
                    firm, including on leads where neither could happen. */}
                {lead.firmResponse.responseType === 'interested' &&
                  (lead.hasConsumerAccount ? (
                    <>
                      {' '}
                      <T>
                        The consumer was notified. We will let you know if they
                        accept.
                      </T>
                    </>
                  ) : (
                    <>
                      {' '}
                      <T>
                        This one came in without an account behind it, so there
                        was nobody to notify and it cannot be accepted here.
                      </T>
                    </>
                  ))}
              </p>
            </PanelCard>
          ) : (
            <LeadResponseForm
              firmId={ctx.firm.id}
              leadId={lead.id}
              hasConsumerAccount={lead.hasConsumerAccount}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
