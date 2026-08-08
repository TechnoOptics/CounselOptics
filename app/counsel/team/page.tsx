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
import { PanelCard, relativeTime } from '@/components/counsel/patterns';
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
          <>
            {members.length}{' '}
            {members.length === 1 ? (
              <T>person on the legal team.</T>
            ) : (
              <T>people on the legal team.</T>
            )}{' '}
            <T>
              Roles control what each person can do across cases, documents,
              signing, and chat.
            </T>
          </>
        }
      />

      {canManage && <InviteMemberForm firmId={ctx.firm.id} />}

      <PanelCard title={<T>Members</T>} bodyClassName="">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead className="border-b border-edge">
              <tr className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">
                <th scope="col" className="px-3 py-2"><T>Name</T></th>
                <th scope="col" className="px-3 py-2"><T>Email</T></th>
                <th scope="col" className="px-3 py-2"><T>Role</T></th>
                <th scope="col" className="px-3 py-2"><T>Joined</T></th>
                <th scope="col" className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
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
        </div>
      </PanelCard>

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
        <PanelCard
          title={<T>Pending invitations</T>}
          action={
            <p className="text-[12px] tabular-nums text-muted">
              {invitations.length}
            </p>
          }
        >
          <ul className="space-y-1.5">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 py-1.5 text-sm"
              >
                <span className="font-mono text-[12px] text-foreground" data-no-translate>
                  {inv.email}
                </span>
                <span className="text-[12px] text-muted">
                  <T>Invited as</T> {FIRM_ROLE_LABEL[inv.role].toLowerCase()}{' '}
                  &middot; <T>expires</T>{' '}
                  <span suppressHydrationWarning>
                    {relativeTime(inv.expiresAt) ??
                      new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>
      )}

      <details className="text-[12px] text-muted">
        <summary className="cursor-pointer font-semibold text-foreground">
          <T>What each role can do</T>
        </summary>
        <ul className="mt-3 space-y-2">
          {FIRM_ROLES.map((r) => (
            <li key={r}>
              <strong className="text-foreground">
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
