import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmClients } from '@/lib/firm-storage';
import { InviteClientForm } from './invite-form';

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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Clients</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Client roster
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Invite a client by email. They get a regular Advottic account; this firm gains
            view + collaborate access on cases they share.
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {clients.length} total
        </p>
      </header>

      {canInvite && <InviteClientForm firmId={ctx.firm.id} />}

      {clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            No clients yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Use the invite form above to add your first client.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream-50 dark:bg-forest-900/60 text-ink-700 dark:text-cream-100/85 text-left">
              <tr>
                <th className="font-semibold px-4 py-2.5">Email</th>
                <th className="font-semibold px-4 py-2.5">Name</th>
                <th className="font-semibold px-4 py-2.5">Status</th>
                <th className="font-semibold px-4 py-2.5">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
              {clients.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 text-ink-900 dark:text-cream-100">
                    {c.email ?? '(pending sign-in)'}
                  </td>
                  <td className="px-4 py-2.5 text-ink-700 dark:text-cream-100/80">
                    {c.displayName ?? '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`badge text-[10px] tracking-wider ${
                        c.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
                          : c.status === 'invited'
                            ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
                            : 'bg-ink-100 text-ink-600 dark:bg-forest-800/60 dark:text-cream-100/55'
                      }`}
                    >
                      {c.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-500 dark:text-cream-100/55 font-mono text-[11px] tabular-nums">
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
