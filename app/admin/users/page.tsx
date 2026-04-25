import { adminListUsers } from '@/lib/storage';
import { TIER_LABEL, REPRESENTATION_LABEL } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminUsersPage() {
  const users = await adminListUsers();

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        {users.length} user{users.length === 1 ? '' : 's'}
      </p>
      <div className="card overflow-x-auto">
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
              <Th>Admin</Th>
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
                  {u.isAdmin ? (
                    <span className="badge bg-ink-950 text-white">Admin</span>
                  ) : (
                    <span className="text-ink-400">-</span>
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
        To grant admin access: <code className="font-mono">profiles.is_admin = true</code> via
        Supabase SQL editor.
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
