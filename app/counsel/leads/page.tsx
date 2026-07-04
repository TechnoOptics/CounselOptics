import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmLeadsForFirm } from '@/lib/marketplace-storage';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads · Counsel' };

const URGENCY_TONE: Record<string, string> = {
  emergency:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  high: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  normal:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  low: 'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40',
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1"><T>Counsel · marketplace</T></p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            <T>Inbound leads</T>
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Consumers who described a matter on /find-counsel and matched
            your firm&rsquo;s jurisdictions and practice areas. Their
            contact details stay private until you signal interest and the
            consumer picks your firm.</T>
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {open.length} <T>open</T> · {responded.length} <T>responded</T>
        </p>
      </header>

      {leads.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            <T>No leads yet.</T>
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
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
      <h2 className="font-display text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
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
          <p className="font-semibold text-forest-900 dark:text-cream-100 truncate flex-1 min-w-0">
            {lead.practiceAreas.slice(0, 3).join(', ') || <T>Legal matter</T>} ·{' '}
            {lead.jurisdictionState ?? '—'}
          </p>
          <span
            className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${
              URGENCY_TONE[lead.urgency ?? 'normal'] ?? URGENCY_TONE.normal
            }`}
          >
            {lead.urgency ?? 'normal'}
          </span>
        </div>
        <p className="text-[12.5px] text-ink-600 dark:text-cream-100/75 line-clamp-2 leading-snug">
          {lead.summary}
        </p>
        <div className="flex items-center justify-between text-[11px] text-ink-500 dark:text-cream-100/70 font-mono tabular-nums pt-1 border-t border-ink-100 dark:border-forest-800/40">
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
