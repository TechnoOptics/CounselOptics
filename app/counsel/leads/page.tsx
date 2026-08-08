import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmLeadsForFirm } from '@/lib/marketplace-storage';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads · Counsel' };

/** One hex per urgency; StatusPill derives fill and border from it. */
const URGENCY_COLOR: Record<string, string> = {
  emergency: PILL_COLORS.flagged,
  high: PILL_COLORS.waiting,
  normal: PILL_COLORS.info,
  low: PILL_COLORS.neutral,
};

const RESPONSE_LABEL: Record<string, string> = {
  interested: 'You expressed interest',
  pass: 'You passed',
  accepted: 'Accepted by the consumer',
  declined_by_user: 'Consumer picked another firm',
};

export default async function FirmLeadsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const leads = await listFirmLeadsForFirm(ctx.firm.id);

  const open = leads.filter((l) => !l.firmResponse);
  const responded = leads.filter((l) => l.firmResponse);

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · marketplace</T>}
        title={<T>Inbound leads</T>}
        subtitle={
          <T>Consumers who described a matter on /find-counsel and matched
          your firm&rsquo;s jurisdictions and practice areas. Their
          contact details stay private until you signal interest and the
          consumer picks your firm.</T>
        }
        action={
          <p className="text-[12px] text-muted font-mono uppercase tracking-wider">
            {open.length} <T>open</T> · {responded.length} <T>responded</T>
          </p>
        }
      />

      {leads.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-2xl text-foreground">
            <T>No leads yet.</T>
          </p>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
            <T>Make sure your firm&rsquo;s jurisdictions and practice areas are
            up to date in</T> <Link href="/counsel/settings" className="underline"><T>settings</T></Link> <T>so
            we can match you with the right consumers.</T>
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <Section title="New">
              <ul className="space-y-2">
                {open.map((l) => (
                  <LeadCard key={l.id} lead={l} />
                ))}
              </ul>
            </Section>
          )}
          {responded.length > 0 && (
            <Section title="Responded">
              <ul className="space-y-2 opacity-90">
                {responded.map((l) => (
                  <LeadCard key={l.id} lead={l} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium tracking-[-0.01em] text-foreground">
        <T>{title}</T>
      </h2>
      {children}
    </section>
  );
}

function LeadCard({
  lead,
}: {
  lead: Awaited<ReturnType<typeof listFirmLeadsForFirm>>[number];
}) {
  return (
    <li className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
      <Link href={`/counsel/leads/${lead.id}`} className="block space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-foreground truncate flex-1 min-w-0">
            {lead.practiceAreas.slice(0, 3).join(', ') || <T>Legal matter</T>} ·{' '}
            {lead.jurisdictionState ?? <T>State not set</T>}
          </p>
          <StatusPill
            size="sm"
            color={
              URGENCY_COLOR[lead.urgency ?? 'normal'] ?? URGENCY_COLOR.normal
            }
          >
            {lead.urgency ?? 'normal'}
          </StatusPill>
        </div>
        <p className="text-[12.5px] text-muted line-clamp-2 leading-snug">
          {lead.summary}
        </p>
        <div className="flex items-center justify-between text-[11px] text-muted font-mono tabular-nums pt-1 border-t border-edge">
          <span>{new Date(lead.createdAt).toLocaleString()}</span>
          {lead.firmResponse && (
            <span className="text-emerald-700 dark:text-emerald-300 font-semibold uppercase tracking-wider text-[10px]">
              {RESPONSE_LABEL[lead.firmResponse.responseType] ??
                lead.firmResponse.responseType}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
