import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getActiveFirmContext } from '@/lib/firm-storage';
import { getFirmSurfaceSettings } from '@/lib/firm-settings';
import {
  canReadMatterMaterial,
  getFirmReportFigures,
} from '@/lib/counsel-reports-data';
import {
  DASH,
  REPORT_WEEKS,
  REPORT_WINDOW_DAYS,
  buildReportTiles,
  rankBars,
} from '@/lib/counsel-reports';
import { INTAKE_LANE_LABEL } from '@/lib/intake-lanes';
import { PageHeader } from '@/components/counsel/ui';
import { MonoRef, relativeTime, shortRef } from '@/components/counsel/patterns';
import {
  CardEmpty,
  RankedBars,
  ReportCard,
  StatTile,
  WeekColumns,
} from '@/components/counsel/reports';
import { ReportActions } from '@/components/counsel/ReportActions';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { absolute: 'Reports · Advottic Counsel' },
  description:
    'Service levels and output across the firm: what came in, what went out, and what is still waiting.',
};

/**
 * /counsel/reports - the firm's service-level and output view.
 *
 * The dashboard shape from docs/PARITY-PAGE-RULES.md, arranged the way the
 * reference product arranges this particular screen: a title and a subtitle
 * naming the AUDIENCE, a secondary Print and a primary Export, a row of stat
 * tiles, then a band of charts, then a band of smaller panels.
 *
 * WHAT A `staff` MEMBER SEES, AND WHY IT IS NOT EVERYTHING. Every figure on
 * this page is a count over a table this reader may read, decided by
 * canReadMatterMaterial before the query is issued rather than after it comes
 * back. `cases` and `firm_documents` refuse a `staff` member under the applied
 * supabase/migrations/20260731_staff_role_read_scope.sql, and a refused select
 * returns an EMPTY SET WITH NO ERROR, so "Matters opened" and "Documents
 * overdue" would read as a confident zero for a firm with a full caseload.
 * Those two tiles are therefore absent for that role rather than wrong, and
 * the page is not offered a dash for them either, because a dash claims the
 * firm opened nothing.
 *
 * The rest of the page IS shown to `staff`. Requests, approvals, signing,
 * invoices and time entries are all member-wide reads: the migration above was
 * written from a sweep of the staff surface and narrowed exactly two tables,
 * naming both. A receptionist can already open /counsel/inbox and
 * /counsel/signing, so a count of what is on them is not a wider disclosure
 * than the lists themselves.
 *
 * MONEY HIDES ENTIRELY under firm_settings.hide_time_billing, because the
 * pages those figures open redirect to /counsel under that setting and a tile
 * that lands on a redirect is a dead click.
 *
 * WHAT IS NOT ON THIS PAGE. No money AMOUNTS: PostgREST cannot SUM, so a total
 * would have to be added up in JavaScript over an unbounded select, and this
 * product has already shipped three figures that were floors of exactly that
 * shape. The invoice figures here are COUNTS, which are exact; the amounts
 * live on /counsel/billing, which owns them. No satisfaction score and no
 * turnaround average either - see the note on the panels band.
 */
export default async function CounselReportsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const surfaces = await getFirmSurfaceSettings(ctx.firm.id);
  const matterMaterial = canReadMatterMaterial(ctx.membership.role);
  const f = await getFirmReportFigures({
    firmId: ctx.firm.id,
    role: ctx.membership.role,
    hideTimeBilling: surfaces.hideTimeBilling,
  });

  const tiles = buildReportTiles(
    {
      requestsReceivedInWindow: f.requestsReceivedInWindow,
      requestsNeedingAttention: f.requestsNeedingAttention,
      approvalsWaiting: f.approvalsWaiting,
      signingSentInWindow: f.signingSentInWindow,
      signingCompletedInWindow: f.signingCompletedInWindow,
      documentsOverdue: f.documentsOverdue,
      mattersOpenedInWindow: f.mattersOpenedInWindow,
    },
    { canReadMatterMaterial: matterMaterial },
  );

  const laneBars = rankBars(
    (['attention', 'review', 'accepted', 'closed'] as const).map((k) => ({
      key: k,
      label: INTAKE_LANE_LABEL[k],
      count: f.lanes[k],
    })),
  );

  const approvalBars = rankBars([
    { key: 'approved', label: 'Approved', count: f.approvalsApprovedInWindow },
    {
      key: 'returned',
      label: 'Sent back for changes',
      count: f.approvalsReturnedInWindow,
    },
    { key: 'declined', label: 'Declined', count: f.approvalsDeclinedInWindow },
  ]);

  const signingBars = rankBars([
    { key: 'sent', label: 'Awaiting signatures', count: f.signingAwaiting },
    { key: 'partial', label: 'Partially signed', count: f.signingPartial },
    {
      key: 'changes',
      label: 'Changes requested',
      count: f.signingChangesRequested,
    },
    { key: 'rejected', label: 'Rejected', count: f.signingRejected },
  ]);

  const invoiceBars = rankBars([
    { key: 'unpaid', label: 'Sent and unpaid', count: f.invoicesUnpaid },
    { key: 'paid', label: 'Paid in the window', count: f.invoicesPaidInWindow },
  ]);

  // What Export writes, built from the very arrays the page draws, so the
  // spreadsheet and the screen cannot state two different things.
  const csvRows: Array<[string, string]> = [
    ...tiles.map((t) => [t.label, t.display] as [string, string]),
    ...laneBars.map((b) => [`Requests: ${b.label}`, b.display] as [string, string]),
    ...approvalBars.map(
      (b) => [`Approvals decided: ${b.label}`, b.display] as [string, string],
    ),
    ...signingBars.map(
      (b) => [`Signing in flight: ${b.label}`, b.display] as [string, string],
    ),
    ...f.weekly.map(
      (w) => [`Requests received, week of ${w.label}`, w.count ?? DASH] as [string, string],
    ),
  ];
  if (!surfaces.hideTimeBilling) {
    csvRows.push(
      ...invoiceBars.map((b) => [`Invoices: ${b.label}`, b.display] as [string, string]),
    );
  }

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        size="lg"
        eyebrow={<T>Counsel</T>}
        title={<T>Reports</T>}
        subtitle={
          <T>
            Leadership view: service levels, demand, and what the firm has put
            out. Every figure is counted by the database over the whole set,
            never over a page of it.
          </T>
        }
        action={
          <ReportActions rows={csvRows} filename="advottic-reports.csv" />
        }
      />

      {/*
        The tile row. Six for a reader who reaches matter material, four for
        one who does not, and the grid says which rather than leaving two
        empty columns at the end of the row.
      */}
      <section
        className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${
          tiles.length === 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-4'
        }`}
      >
        {tiles.map((t) => (
          <StatTile
            key={t.id}
            label={t.label}
            display={t.display}
            hint={t.caption}
            tone={t.tone}
            href={t.href}
          />
        ))}
      </section>

      {/*
        The wide band: the two cards whose contents need width. The demand
        chart carries twelve columns and the queue carries names somebody
        typed, and both were unreadable in a quarter-page card.
      */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ReportCard
          title="Requests received"
          qualifier={`${REPORT_WEEKS} weeks`}
        >
          <WeekColumns points={f.weekly} />
        </ReportCard>

        <ReportCard title="Longest waiting requests" qualifier="Oldest first">
          {f.oldestOpenRequests.length === 0 ? (
            <CardEmpty>
              <T>No requests are waiting on the legal team.</T>
            </CardEmpty>
          ) : (
            <ul className="-my-1 divide-y divide-edge">
              {f.oldestOpenRequests.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/counsel/intake/${r.id}`}
                    className="flex items-center gap-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <MonoRef title={r.id}>{shortRef(r.id)}</MonoRef>
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] text-foreground"
                      title={r.clientName}
                      data-no-translate
                    >
                      {r.clientName}
                    </span>
                    <span
                      className="shrink-0 text-[11.5px] tabular-nums text-muted"
                      data-no-translate
                    >
                      {relativeTime(r.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </section>

      {/*
        The panels band.

        WHAT IS DELIBERATELY ABSENT FROM IT. The reference product puts a
        satisfaction trend and a resolution-time average here. Advottic
        records neither: there is no rating of a firm or of an attorney
        anywhere in the schema, and the moment a request was decided is
        stored inside `intake_answers.decision.at`, a jsonb field no count
        query can filter or average on. Drawing either would mean inventing
        the number, and docs/PARITY-PAGE-RULES.md is explicit that an
        invented figure is worse than an absent panel.
      */}
      {/*
        Two across, not four. Four of these fitted the row and truncated
        every category name in them ("Sent back fo...", "Awaiting sig..."),
        and a ranked list whose categories cannot be read is not a ranking.
        With money hidden there are three cards rather than four, so the
        band goes three across at that size instead of leaving a hole.
      */}
      <section
        className={`grid gap-4 sm:grid-cols-2 ${
          surfaces.hideTimeBilling ? 'lg:grid-cols-3' : ''
        }`}
      >
        <ReportCard title="Where requests stand" qualifier="Heaviest first">
          <RankedBars bars={laneBars} />
        </ReportCard>

        <ReportCard
          title="Approvals decided"
          qualifier={`${REPORT_WINDOW_DAYS} days`}
        >
          <RankedBars bars={approvalBars} />
        </ReportCard>

        <ReportCard title="Signing in flight" qualifier="Right now">
          <RankedBars bars={signingBars} />
        </ReportCard>

        {/*
          Money. Absent entirely, not greyed out, when the firm turned Time
          and Billing off: /counsel/billing redirects to /counsel under that
          setting, so every destination behind these figures is a dead click.
          The band drops to three columns with it rather than leaving a gap
          where a card used to be.
        */}
        {!surfaces.hideTimeBilling && (
          <ReportCard title="Invoices" qualifier={`${REPORT_WINDOW_DAYS} days`}>
            <RankedBars bars={invoiceBars} />
            <p className="mt-3 text-[11.5px] text-muted">
              <T>Counts of invoices. Amounts are on</T>{' '}
              <Link
                href="/counsel/billing"
                className="underline text-foreground"
              >
                <T>Billing</T>
              </Link>
              .
            </p>
          </ReportCard>
        )}

      </section>
    </div>
  );
}
