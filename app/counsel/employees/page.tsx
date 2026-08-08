import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmEmployeeDirectory } from '@/lib/firm-actions';
import { readPortalRoles } from '@/lib/portal-features';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { ViewStrip, type ViewOption } from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';
import { Tt } from '@/components/i18n/Tt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employees · Counsel' };

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Added manually',
  azure: 'Microsoft directory',
  google: 'Google directory',
};

/**
 * Read-only directory of every person attached to the firm's employee
 * portal - the non-legal staff (and any guest/collaborator accounts)
 * who get the scoped /portal surface. Distinct from Team (the legal
 * members) and from the Team page's management panel: this is just the
 * list, visible to the whole legal team.
 *
 * On the list pattern from PARITY-SPEC.md section 3, minus the parts
 * with nothing behind them:
 *
 * - No search or filter toolbar, and no sortable headers. The view is
 *   the only thing that narrows this list; nothing else on the page
 *   filters or reorders it.
 * - No checkbox column. Every write lives on the Team page, which is
 *   what the subtitle says, so a selection here could not be used.
 * - No metric strip. The three numbers this page has (total, active,
 *   deactivated) ARE the view counts, and printing them twice would
 *   make a strip out of a strip.
 *
 * The three status chips this page used to carry became the view strip,
 * which is what they were describing.
 */
export default async function CounselEmployeesPage({
  searchParams,
}: {
  searchParams?: { view?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const employees = await listFirmEmployeeDirectory(ctx.firm.id);
  const roles = readPortalRoles(ctx.firm.metadata);
  const roleName = (key: string | null) =>
    key ? roles.find((r) => r.key === key)?.name ?? key : null;

  const active = employees.filter((e) => !e.deactivatedAt);
  const deactivated = employees.filter((e) => Boolean(e.deactivatedAt));

  const view =
    searchParams?.view === 'active' || searchParams?.view === 'deactivated'
      ? searchParams.view
      : '';
  const shown =
    view === 'active' ? active : view === 'deactivated' ? deactivated : employees;

  const options: ViewOption[] = [
    { key: '', label: <T>All</T>, count: employees.length },
    { key: 'active', label: <T>Active</T>, count: active.length },
    ...(deactivated.length > 0
      ? [
          {
            key: 'deactivated',
            label: <T>Deactivated</T>,
            count: deactivated.length,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>People</T>}
        title={<T>Employees</T>}
        subtitle={
          <>
            {employees.length}{' '}
            {employees.length === 1 ? (
              <T>employee-portal account at</T>
            ) : (
              <T>employee-portal accounts at</T>
            )}{' '}
            <span data-no-translate>{ctx.firm.name}</span>{' '}
            <T>
              - staff, contractors, and any guest accounts. To add, deactivate,
              or change a role, an owner or admin uses the Team page.
            </T>
          </>
        }
      />

      {employees.length === 0 ? (
        <EmptyState
          title={<T>No employee accounts yet.</T>}
          sub={
            <T>
              Owners and admins can add people, or connect a directory, from
              the Team page.
            </T>
          }
        />
      ) : (
        <div className="space-y-3">
          <ViewStrip
            options={options}
            active={view}
            href={(key) =>
              key ? `/counsel/employees?view=${key}` : '/counsel/employees'
            }
            label="Employee views"
          />

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-left">
                <thead className="border-b border-edge">
                  <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                    <th scope="col" className="px-3 py-2"><T>Name</T></th>
                    <th scope="col" className="px-3 py-2"><T>Email</T></th>
                    <th scope="col" className="px-3 py-2"><T>Department</T></th>
                    <th scope="col" className="px-3 py-2"><T>Access</T></th>
                    <th scope="col" className="px-3 py-2"><T>Source</T></th>
                    <th scope="col" className="px-3 py-2"><T>Status</T></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const inactive = Boolean(e.deactivatedAt);
                    const access = roleName(e.roleKey);
                    return (
                      <tr
                        key={e.id}
                        className={`border-b border-edge last:border-0 transition-colors hover:bg-surface-2 ${
                          inactive ? 'opacity-60' : ''
                        }`}
                      >
                        <td className="px-3 py-2.5 text-[13px] font-medium text-foreground">
                          {e.displayName ? (
                            <span data-no-translate>{e.displayName}</span>
                          ) : (
                            <T>Not set</T>
                          )}
                          {!e.linked && (
                            <Tt
                              className="ml-2 align-middle text-[10px] uppercase tracking-[0.12em] text-muted"
                              title="Invited but has not signed in yet"
                            >
                              <T>Pending</T>
                            </Tt>
                          )}
                        </td>
                        <td
                          className="px-3 py-2.5 font-mono text-[12px] text-muted"
                          data-no-translate
                        >
                          {e.email}
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-muted">
                          {e.department ? (
                            <span data-no-translate>{e.department}</span>
                          ) : (
                            <T>Not set</T>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-muted">
                          {access ? (
                            <span data-no-translate>{access}</span>
                          ) : (
                            <T>Default access</T>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-muted">
                          {SOURCE_LABEL[e.source] ?? e.source}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusPill
                            size="sm"
                            dot
                            color={
                              inactive ? PILL_COLORS.neutral : PILL_COLORS.good
                            }
                          >
                            {inactive ? <T>Deactivated</T> : <T>Active</T>}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
