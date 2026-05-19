import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmInvitations,
  listFirmMembers,
} from '@/lib/firm-storage';
import { FIRM_ROLES, FIRM_ROLE_LABEL, FIRM_ROLE_DESCRIPTION } from '@/lib/firm-types';
import { listFirmEmployeesAction } from '@/lib/firm-actions';
import { InviteMemberForm } from './invite-form';
import { TeamMemberRow } from './member-row';
import { EmployeesPanel } from './employees-panel';

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

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Team</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Members & roles
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Roles control what each person can do across cases, documents, signing, and
          chat.
        </p>
      </header>

      {canManage && <InviteMemberForm firmId={ctx.firm.id} />}

      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream-50 dark:bg-forest-900/60 text-ink-700 dark:text-cream-100/85 text-left">
            <tr>
              <th className="font-semibold px-4 py-2.5">Name</th>
              <th className="font-semibold px-4 py-2.5">Email</th>
              <th className="font-semibold px-4 py-2.5">Role</th>
              <th className="font-semibold px-4 py-2.5">Joined</th>
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
              />
            ))}
          </tbody>
        </table>
      </section>

      {canManage && (
        <EmployeesPanel firmId={ctx.firm.id} initial={employees} />
      )}

      {invitations.length > 0 && (
        <section className="card p-5 sm:p-6">
          <p className="eyebrow mb-2">Pending invitations</p>
          <ul className="space-y-1.5">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 text-sm py-1.5"
              >
                <span className="text-ink-900 dark:text-cream-100">{inv.email}</span>
                <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
                  Invited as {FIRM_ROLE_LABEL[inv.role].toLowerCase()} &middot; expires{' '}
                  {new Date(inv.expiresAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <summary className="cursor-pointer font-semibold text-forest-900 dark:text-cream-100">
          What each role can do
        </summary>
        <ul className="mt-3 space-y-2">
          {FIRM_ROLES.map((r) => (
            <li key={r}>
              <strong className="text-ink-900 dark:text-cream-100">
                {FIRM_ROLE_LABEL[r]}:
              </strong>{' '}
              {FIRM_ROLE_DESCRIPTION[r]}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
