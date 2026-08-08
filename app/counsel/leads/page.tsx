import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmLeadsForFirm } from '@/lib/marketplace-storage';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import {
  MonoRef,
  ViewStrip,
  relativeTime,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
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

/**
 * The three views a lead can genuinely be in, and the predicate behind
 * each. `firmResponse` is null until this firm answers the lead, which
 * is the whole of the state a lead carries on this surface, so these
 * are the only honest subsets.
 */
const VIEWS = {
  new: (l: Lead) => !l.firmResponse,
  responded: (l: Lead) => Boolean(l.firmResponse),
  all: () => true,
} as const;

type ViewKey = keyof typeof VIEWS;
type Lead = Awaited<ReturnType<typeof listFirmLeadsForFirm>>[number];

function parseView(raw: string | string[] | undefined): ViewKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'responded' || v === 'all' ? v : 'new';
}

/**
 * Inbound marketplace leads, on the list pattern.
 *
 * What it does NOT have, and why, because a control that does nothing
 * is the defect this surface set has shipped before:
 *
 *   - No search box and no per-column filters. Nothing here filters;
 *     the whole set is what the firm's own jurisdictions and practice
 *     areas already matched (see listFirmLeadsForFirm), and there is no
 *     server-side query to narrow it with.
 *   - No sortable headers. The list arrives newest first from
 *     firm_leads.created_at and there is no second order to offer.
 *   - No checkbox column. Responding to a lead is a per-lead decision
 *     with its own form; there is no bulk mutation to select rows for.
 *
 * The view is in the query string rather than in component state, so a
 * narrowed queue is a link somebody can be sent.
 */
export default async function FirmLeadsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const leads = await listFirmLeadsForFirm(ctx.firm.id);

  const view = parseView(searchParams?.view);
  const rows = leads.filter(VIEWS[view]);

  // Each count is the length of the array that view would render, from
  // the same predicate that renders it.
  const options: ViewOption[] = [
    { key: 'new', label: <T>New</T>, count: leads.filter(VIEWS.new).length },
    {
      key: 'responded',
      label: <T>Responded</T>,
      count: leads.filter(VIEWS.responded).length,
    },
    { key: 'all', label: <T>Everything</T>, count: leads.length },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · marketplace</T>}
        title={<T>Inbound leads</T>}
        subtitle={
          <>
            {leads.length}{' '}
            <T>
              consumers who described a matter on /find-counsel and matched your
              firm&rsquo;s jurisdictions and practice areas, newest first. Their
              contact details stay private until you signal interest and the
              consumer picks your firm. The view is in the address bar, so a
              narrowed queue can be sent to a colleague.
            </T>
          </>
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          title={<T>No leads yet.</T>}
          sub={
            <>
              <T>
                Make sure your firm&rsquo;s jurisdictions and practice areas are
                up to date in
              </T>{' '}
              <Link href="/counsel/settings" className="underline">
                <T>settings</T>
              </Link>{' '}
              <T>so we can match you with the right consumers.</T>
            </>
          }
        />
      ) : (
        <>
          <ViewStrip
            label="Lead views"
            options={options}
            active={view}
            href={(k) => (k === 'new' ? '/counsel/leads' : `/counsel/leads?view=${k}`)}
          />

          {rows.length === 0 ? (
            <EmptyState
              title={<T>Nothing in this view.</T>}
              sub={<T>Pick another view above.</T>}
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-edge text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      <Th className="w-[92px]">
                        <T>Urgency</T>
                      </Th>
                      <Th className="w-[88px]">
                        <T>Ref</T>
                      </Th>
                      <Th>
                        <T>Matter</T>
                      </Th>
                      <Th className="w-[200px]">
                        <T>Your response</T>
                      </Th>
                      <Th className="w-[110px]">
                        <T>Received</T>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <LeadRow key={l.id} lead={l} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={`px-3 py-2.5 font-semibold ${className}`}>
      {children}
    </th>
  );
}

function LeadRow({ lead }: { lead: Lead }) {
  const urgency = lead.urgency ?? 'normal';
  const areas = lead.practiceAreas.slice(0, 3).join(', ');
  const received = relativeTime(lead.createdAt);
  return (
    <tr className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2">
      <td className="px-3 py-3 align-top">
        <StatusPill size="sm" color={URGENCY_COLOR[urgency] ?? URGENCY_COLOR.normal}>
          {urgency}
        </StatusPill>
      </td>
      <td className="px-3 py-3 align-top">
        <MonoRef title={lead.id}>{shortRef(lead.id)}</MonoRef>
      </td>
      <td className="min-w-[280px] px-3 py-3 align-top">
        <Link
          href={`/counsel/leads/${lead.id}`}
          className="block font-semibold text-foreground hover:underline"
        >
          {areas ? <span data-no-translate>{areas}</span> : <T>Legal matter</T>}
          {lead.jurisdictionState && (
            <span className="text-muted" data-no-translate>
              {' · '}
              {lead.jurisdictionState}
            </span>
          )}
        </Link>
        <p
          className="mt-0.5 line-clamp-2 max-w-[62ch] text-[12.5px] leading-snug text-muted"
          data-no-translate
        >
          {lead.summary}
        </p>
      </td>
      <td className="px-3 py-3 align-top text-[12.5px] text-muted">
        {lead.firmResponse ? (
          <ResponseLabel type={lead.firmResponse.responseType} />
        ) : (
          <Link href={`/counsel/leads/${lead.id}`} className="underline">
            <T>Not answered yet</T>
          </Link>
        )}
      </td>
      <td className="px-3 py-3 align-top text-[12px] tabular-nums text-muted">
        <span title={new Date(lead.createdAt).toLocaleString()}>
          {received ?? new Date(lead.createdAt).toLocaleDateString()}
        </span>
      </td>
    </tr>
  );
}

/**
 * The four response states, each written out so the i18n guard sees a
 * literal rather than a lookup through RESPONSE_LABEL.
 */
function ResponseLabel({ type }: { type: string }) {
  if (type === 'interested')
    return (
      <span className="text-accent-text">
        <T>You expressed interest</T>
      </span>
    );
  if (type === 'pass')
    return (
      <span>
        <T>You passed</T>
      </span>
    );
  if (type === 'accepted')
    return (
      <span className="font-semibold text-emerald-700 dark:text-emerald-300">
        <T>Accepted by the consumer</T>
      </span>
    );
  if (type === 'declined_by_user')
    return (
      <span>
        <T>Consumer picked another firm</T>
      </span>
    );
  return <span data-no-translate>{RESPONSE_LABEL[type] ?? type}</span>;
}
