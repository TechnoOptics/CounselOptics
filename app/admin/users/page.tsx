import { adminListUsers } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await adminListUsers();

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">{users.length} user{users.length === 1 ? '' : 's'}</p>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 border-b border-ink-200">
            <tr className="text-left">
              <Th>User</Th>
              <Th>Role</Th>
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
                </Td>
                <Td>{u.role || <span className="text-ink-400">—</span>}</Td>
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
                    <span className="text-ink-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-ink-500">
                  No users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-500">
        To grant admin access, set <code className="font-mono">profiles.is_admin = true</code> for
        the target user in the Supabase SQL editor.
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
