import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmClients } from '@/lib/firm-storage';
import type { FirmClientStatus } from '@/lib/firm-types';
import { InviteClientForm } from './invite-form';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { ViewStrip, relativeTime, type ViewOption } from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateTimeNumeric } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clients · Counsel' };

/**
 * One hex per client state. StatusPill derives the fill and the border
 * from it, so a state costs a colour rather than three Tailwind classes.
 * This replaces a hand-written emerald/amber/grey badge whose classes
 * only resolved in light mode through the counsel repaint layer.
 */
const STATUS_COLOR: Record<FirmClientStatus, string> = {
  active: PILL_COLORS.good,
  invited: PILL_COLORS.waiting,
  archived: PILL_COLORS.quiet,
};

/**
 * Already-wrapped labels rather than raw strings the render site wraps.
 * A braced translation wrap is a reviewed exception under the counsel
 * i18n guard; holding the literals here keeps every wrap static.
 */
const STATUS_LABEL: Record<FirmClientStatus, JSX.Element> = {
  active: <T>Active</T>,
  invited: <T>Invited</T>,
  archived: <T>Archived</T>,
};

const VIEW_ORDER: FirmClientStatus[] = ['active', 'invited', 'archived'];

/**
 * The client roster, on the list pattern from PARITY-SPEC.md section 3.
 *
 * It gets the page header, the segmented view strip and the table.
 * What it does not get, and why:
 *
 * - No search or filter toolbar. Nothing on this page filters beyond
 *   the view, and a search box that narrowed nothing would be the
 *   control-without-a-behaviour this project has shipped before.
 * - No sortable column headers. The list arrives ordered by join date
 *   and there is no sort parameter behind a header link.
 * - No checkbox column. There is no bulk action a set of clients can be
 *   put through; the only write on this page is the invite form.
 * - No mono reference column. A client row's identity IS the email
 *   address, which already has a column; the row id is a uuid nobody
 *   quotes.
 */
export default async function CounselClientsPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const clients = await listFirmClients(ctx.firm.id);

  const canInvite =
    ctx.membership.role === 'owner' ||
    ctx.membership.role === 'admin' ||
    ctx.membership.role === 'attorney';

  // Only states this firm actually has become views. A view nobody can
  // be in is a tab that always reads zero.
  const present = VIEW_ORDER.filter((s) =>
    clients.some((c) => c.status === s),
  );
  const view =
    present.find((s) => s === searchParams?.view) ?? '';
  const shown = view ? clients.filter((c) => c.status === view) : clients;

  const options: ViewOption[] = [
    { key: '', label: <T>All</T>, count: clients.length },
    ...present.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: clients.filter((c) => c.status === s).length,
    })),
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Clients</T>}
        title={<T>Client roster</T>}
        subtitle={
          <>
            {clients.length}{' '}
            {clients.length === 1 ? <T>client at</T> : <T>clients at</T>}{' '}
            <span data-no-translate>{ctx.firm.name}</span>.{' '}
            <T>Invite a client by email. They get a regular Advottic account; this firm gains view and collaborate access on cases they share.</T>
          </>
        }
      />

      {canInvite && <InviteClientForm firmId={ctx.firm.id} />}

      {clients.length === 0 ? (
        <EmptyState
          title={<T>No clients yet.</T>}
          sub={
            canInvite ? (
              <T>Use the invite form above to add your first client.</T>
            ) : (
              <T>An owner, admin, or attorney at the firm can invite the first client.</T>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {present.length > 1 && (
            <ViewStrip
              options={options}
              active={view}
              href={(key) =>
                key ? `/counsel/clients?view=${key}` : '/counsel/clients'
              }
              label="Client views"
            />
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-left">
                <thead className="border-b border-edge">
                  <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                    <th scope="col" className="px-3 py-2"><T>Email</T></th>
                    <th scope="col" className="px-3 py-2"><T>Name</T></th>
                    <th scope="col" className="px-3 py-2"><T>Status</T></th>
                    <th scope="col" className="px-3 py-2"><T>Joined</T></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-edge last:border-0 transition-colors hover:bg-surface-2"
                    >
                      <td
                        className="px-3 py-2.5 font-mono text-[12px] text-foreground"
                        data-no-translate
                      >
                        {c.email ?? <T>Pending sign-in</T>}
                      </td>
                      <td
                        className="px-3 py-2.5 text-[13px] text-foreground"
                        data-no-translate
                      >
                        {c.displayName ?? '-'}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill
                          size="sm"
                          dot
                          color={STATUS_COLOR[c.status] ?? PILL_COLORS.neutral}
                        >
                          {STATUS_LABEL[c.status]}
                        </StatusPill>
                      </td>
                      <td
                        className="px-3 py-2.5 text-[12px] text-muted"
                        title={formatDateTimeNumeric(c.joinedAt)}
                        suppressHydrationWarning
                      >
                        {relativeTime(c.joinedAt) ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
