import { adminListUsers } from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { TIER_LABEL, REPRESENTATION_LABEL } from '@/lib/types';
import { UserToggles } from './user-toggles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminUsersPage() {
  const [users, me] = await Promise.all([adminListUsers(), getCurrentUser()]);
  const adminCount = users.filter((u) => u.isAdmin).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-500">
          {users.length} user{users.length === 1 ? '' : 's'} · {adminCount} admin
          {adminCount === 1 ? '' : 's'}
        </p>
        {adminCount < 2 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
            At least 2 admins are required. Promote another user before
            demoting yourself.
          </p>
        )}
      </div>
      <p className="md:hidden text-[11px] text-ink-500 dark:text-cream-100/55 -mt-2">
        Swipe horizontally to see all columns →
      </p>
      <div
        className="card overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-ink-50 border-b border-ink-200">
            <tr className="text-left">
              <Th>User</Th>
              <Th>Representation</Th>
              <Th>Plan</Th>
              <Th>Sub status</Th>
              <Th>Cases</Th>
              <Th>Last sign-in</Th>
              <Th>Joined</Th>
              <Th>Access</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-ink-50/40">
                <Td>
                  <div className="font-medium text-ink-950">
                    {u.displayName || u.email || u.id.slice(0, 8)}
                  </div>
                  <div className="text-xs text-ink-500">{u.email}</div>
                  {u.organization && (
                    <div className="text-xs text-ink-500">{u.organization}</div>
                  )}
                  {!u.consentedAt && (
                    <div className="text-[10px] uppercase tracking-wider text-amber-700 mt-0.5">
                      No consent yet
                    </div>
                  )}
                </Td>
                <Td>
                  {u.representation ? (
                    <span className="text-ink-800 text-xs">
                      {REPRESENTATION_LABEL[u.representation]}
                    </span>
                  ) : (
                    <span className="text-ink-400">-</span>
                  )}
                </Td>
                <Td>
                  {u.subscriptionTier ? (
                    <span
                      className={`badge ${
                        u.subscriptionTier === 'pro'
                          ? 'bg-gold-500 text-forest-950'
                          : u.subscriptionTier === 'standard'
                            ? 'bg-forest-900 text-cream-200'
                            : 'bg-ink-100 text-ink-800'
                      }`}
                    >
                      {TIER_LABEL[u.subscriptionTier]}
                    </span>
                  ) : (
                    <span className="text-ink-400">-</span>
                  )}
                </Td>
                <Td>
                  {u.subscriptionStatus ? (
                    <span
                      className={`badge ${
                        u.subscriptionStatus === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : u.subscriptionStatus === 'trialing'
                            ? 'bg-sky-50 text-sky-800 border border-sky-200'
                            : u.subscriptionStatus === 'past_due' ||
                              u.subscriptionStatus === 'unpaid'
                              ? 'bg-amber-50 text-amber-900 border border-amber-200'
                              : u.subscriptionStatus === 'canceled' ||
                                u.subscriptionStatus === 'inactive'
                                ? 'bg-ink-100 text-ink-700'
                                : 'bg-rose-50 text-rose-800 border border-rose-200'
                      }`}
                    >
                      {u.subscriptionStatus}
                    </span>
                  ) : (
                    <span className="text-ink-400 text-xs">none</span>
                  )}
                </Td>
                <Td className="tabular-nums">{u.caseCount}</Td>
                <Td>
                  {u.lastSignInAt ? (
                    new Date(u.lastSignInAt).toLocaleString()
                  ) : (
                    <span className="text-ink-400">never</span>
                  )}
                </Td>
                <Td>{new Date(u.createdAt).toLocaleDateString()}</Td>
                <Td>
                  <UserToggles
                    userId={u.id}
                    initialIsAdmin={u.isAdmin}
                    initialIsBlocked={u.isBlocked}
                    isSelf={me?.id === u.id}
                    isPermanentAdmin={u.isPermanentAdmin}
                  />
                  {u.isPermanentAdmin && (
                    <p className="text-[10.5px] text-gold-700 dark:text-gold-300 mt-1.5 font-medium uppercase tracking-wider">
                      Permanent admin
                    </p>
                  )}
                  {u.isBlocked && (
                    <p className="text-[10.5px] text-rose-700 dark:text-rose-300 mt-1.5 font-medium uppercase tracking-wider">
                      Blocked
                    </p>
                  )}
                </Td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-sm text-ink-500">
                  No users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-500">
        Toggle admin to grant or revoke admin access. Toggle "Active" off to block a user from
        signing in. Blocked users see a friendly message pointing them at{' '}
        <a className="underline" href="mailto:contact@advottic.com">contact@advottic.com</a>.
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
