import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmEmployeeDirectory } from '@/lib/firm-actions';
import { readPortalRoles } from '@/lib/portal-features';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
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
 */
export default async function CounselEmployeesPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const employees = await listFirmEmployeeDirectory(ctx.firm.id);
  const roles = readPortalRoles(ctx.firm.metadata);
  const roleName = (key: string | null) =>
    key ? roles.find((r) => r.key === key)?.name ?? key : 'Default access';

  const active = employees.filter((e) => !e.deactivatedAt).length;
  const deactivated = employees.length - active;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>People</T>}
        title={<T>Employees</T>}
        subtitle={
          <>
            <T>Everyone with an employee-portal account at</T> {ctx.firm.name}{' '}
            <T>
              - staff, contractors, and any guest accounts. To add, deactivate,
              or change a role, an owner or admin uses the Team page.
            </T>
          </>
        }
      />

      {employees.length === 0 ? (
        <p className="card p-6 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          <T>
            No employee accounts yet. Owners and admins can add people, or
            connect a directory, from the Team page.
          </T>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/80">
              <strong className="font-semibold text-forest-900 dark:text-cream-100">
                {employees.length}
              </strong>{' '}
              <T>total</T>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ring-emerald-200 dark:ring-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200">
              <strong className="font-semibold">{active}</strong> <T>active</T>
            </span>
            {deactivated > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-600 dark:text-cream-100/60">
                <strong className="font-semibold">{deactivated}</strong>{' '}
                <T>deactivated</T>
              </span>
            )}
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-cream-50 dark:bg-forest-900/60 text-ink-700 dark:text-cream-100/85 text-left">
                <tr>
                  <th className="font-semibold px-4 py-2.5"><T>Name</T></th>
                  <th className="font-semibold px-4 py-2.5"><T>Email</T></th>
                  <th className="font-semibold px-4 py-2.5"><T>Department</T></th>
                  <th className="font-semibold px-4 py-2.5"><T>Access</T></th>
                  <th className="font-semibold px-4 py-2.5"><T>Source</T></th>
                  <th className="font-semibold px-4 py-2.5"><T>Status</T></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
                {employees.map((e) => {
                  const inactive = Boolean(e.deactivatedAt);
                  return (
                    <tr
                      key={e.id}
                      className={inactive ? 'opacity-60' : undefined}
                    >
                      <td className="px-4 py-2.5 font-medium text-forest-900 dark:text-cream-100">
                        {e.displayName || <T>Not set</T>}
                        {!e.linked && (
                          <Tt
                            className="ml-2 align-middle text-[10px] uppercase tracking-[0.12em] text-ink-400 dark:text-cream-100/40"
                            title="Invited but has not signed in yet"
                          >
                            <T>Pending</T>
                          </Tt>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-cream-100/70 font-mono text-[12px]">
                        {e.email}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-cream-100/70">
                        {e.department || <T>Not set</T>}
                      </td>
                      <td className="px-4 py-2.5 text-ink-600 dark:text-cream-100/70">
                        {roleName(e.roleKey)}
                      </td>
                      <td className="px-4 py-2.5 text-ink-500 dark:text-cream-100/55 text-[12px]">
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill
                          size="sm"
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
        </>
      )}
    </div>
  );
}
