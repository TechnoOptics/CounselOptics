import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmClients } from '@/lib/firm-storage';
import { InviteClientForm } from './invite-form';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clients · Counsel' };

export default async function CounselClientsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const clients = await listFirmClients(ctx.firm.id);

  const canInvite =
    ctx.membership.role === 'owner' ||
    ctx.membership.role === 'admin' ||
    ctx.membership.role === 'attorney';

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Clients</T>}
        title={<T>Client roster</T>}
        subtitle={
          <T>Invite a client by email. They get a regular Advottic account; this firm gains view + collaborate access on cases they share.</T>
        }
        action={
          <p className="text-[12px] text-muted font-mono uppercase tracking-wider">
            {clients.length} <T>total</T>
          </p>
        }
      />

      {canInvite && <InviteClientForm firmId={ctx.firm.id} />}

      {clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-2xl text-foreground">
            <T>No clients yet.</T>
          </p>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
            <T>Use the invite form above to add your first client.</T>
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-surface-2 text-foreground text-left">
              <tr>
                <th className="font-semibold px-4 py-2.5"><T>Email</T></th>
                <th className="font-semibold px-4 py-2.5"><T>Name</T></th>
                <th className="font-semibold px-4 py-2.5"><T>Status</T></th>
                <th className="font-semibold px-4 py-2.5"><T>Joined</T></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 text-foreground">
                    {c.email ?? '(pending sign-in)'}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">
                    {c.displayName ?? '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge text-[10px] tracking-wider ${
                        c.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
                          : c.status === 'invited'
                            ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
                            : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {c.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted font-mono text-[11px] tabular-nums">
                    {new Date(c.joinedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
