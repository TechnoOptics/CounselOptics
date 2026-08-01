import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmInvitations,
  listFirmMembers,
} from '@/lib/firm-storage';
import { FIRM_ROLES, FIRM_ROLE_LABEL, FIRM_ROLE_DESCRIPTION } from '@/lib/firm-types';
import { listFirmEmployeesAction } from '@/lib/firm-actions';
import { readPortalRoles } from '@/lib/portal-features';
import { InviteMemberForm } from './invite-form';
import { TeamMemberRow } from './member-row';
import { EmployeesPanel } from './employees-panel';
import { RolesManager } from './roles-manager';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team · Counsel' };

export default async function CounselTeamPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const [members, invitations] = await Promise.all([
    listFirmMembers(ctx.firm.id),
    listFirmInvitations(ctx.firm.id),
  ]);

  const canManage = ctx.membership.role === 'owner' || ctx.membership.role === 'admin';
  const employees = canManage
    ? await listFirmEmployeesAction(ctx.firm.id)
    : [];
  const portalRoles = canManage ? readPortalRoles(ctx.firm.metadata) : [];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Team</T>}
        title={<T>Members & roles</T>}
        subtitle={
          <T>
            Roles control what each person can do across cases, documents,
            signing, and chat.
          </T>
        }
      />

      {canManage && <InviteMemberForm firmId={ctx.firm.id} />}

      <section className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-cream-50 dark:bg-forest-900/60 text-ink-700 dark:text-cream-100/85 text-left">
            <tr>
              <th className="font-semibold px-4 py-2.5"><T>Name</T></th>
              <th className="font-semibold px-4 py-2.5"><T>Email</T></th>
              <th className="font-semibold px-4 py-2.5"><T>Role</T></th>
              <th className="font-semibold px-4 py-2.5"><T>Joined</T></th>
              <th className="font-semibold px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
            {members.map((m) => (
              <TeamMemberRow
                key={m.id}
                member={m}
                firmId={ctx.firm.id}
                canManage={canManage}
                isMe={m.userId === ctx.membership.userId}
                isLastOwner={
                  m.role === 'owner' &&
                  members.filter((x) => x.role === 'owner').length === 1
                }
                otherMembers={members.filter((x) => x.userId !== m.userId)}
              />
            ))}
          </tbody>
        </table>
      </section>

      {canManage && (
        <RolesManager firmId={ctx.firm.id} initial={portalRoles} />
      )}

      {canManage && (
        <EmployeesPanel
          firmId={ctx.firm.id}
          initial={employees}
          roles={portalRoles}
        />
      )}

      {invitations.length > 0 && (
        <section className="card p-5 sm:p-6">
          <p className="eyebrow mb-2"><T>Pending invitations</T></p>
          <ul className="space-y-1.5">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 text-sm py-1.5"
              >
                <span className="text-ink-900 dark:text-cream-100">{inv.email}</span>
                <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
                  <T>Invited as</T> {FIRM_ROLE_LABEL[inv.role].toLowerCase()}{' '}
                  &middot; <T>expires</T>{' '}
                  {new Date(inv.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <summary className="cursor-pointer font-semibold text-forest-900 dark:text-cream-100">
          <T>What each role can do</T>
        </summary>
        <ul className="mt-3 space-y-2">
          {FIRM_ROLES.map((r) => (
            <li key={r}>
              <strong className="text-ink-900 dark:text-cream-100">
                {FIRM_ROLE_LABEL[r]}:
              </strong>{' '}
              <T>{FIRM_ROLE_DESCRIPTION[r]}</T>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
