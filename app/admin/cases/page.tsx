import Link from 'next/link';
import { adminListCases } from '@/lib/storage';
import { STATUS_LABEL, SUBJECT_TYPE_LABEL, type CaseStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<CaseStatus, string> = {
  draft: 'bg-ink-100 text-ink-700',
  open: 'bg-sky-50 text-sky-800 border border-sky-200',
  under_review: 'bg-amber-50 text-amber-900 border border-amber-200',
  needs_evidence: 'bg-rose-50 text-rose-800 border border-rose-200',
  export_ready: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
  closed: 'bg-ink-100 text-ink-600',
  archived: 'bg-ink-100 text-ink-500',
};

export default async function AdminCasesPage() {
  const cases = await adminListCases();

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        {cases.length} case{cases.length === 1 ? '' : 's'} across all users
      </p>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 border-b border-ink-200">
            <tr className="text-left">
              <Th>Case</Th>
              <Th>Owner</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {cases.map((c) => (
              <tr key={c.id} className="hover:bg-ink-50/40">
                <Td>
                  <Link
                    href={`/cases/${c.id}`}
                    className="font-medium text-ink-950 hover:underline"
                  >
                    {c.title}
                  </Link>
                  <div className="text-xs text-ink-500">
                    {SUBJECT_TYPE_LABEL[c.subjectType]}: {c.subjectName}
                  </div>
                </Td>
                <Td>
                  <div className="text-ink-800">
                    {c.ownerDisplayName || c.ownerEmail || c.ownerId.slice(0, 8)}
                  </div>
                  {c.ownerDisplayName && (
                    <div className="text-xs text-ink-500">{c.ownerEmail}</div>
                  )}
                </Td>
                <Td>{c.caseType}</Td>
                <Td>
                  <span className={`badge ${STATUS_STYLES[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </Td>
                <Td>{new Date(c.updatedAt).toLocaleString()}</Td>
              </tr>
            ))}
            {cases.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-ink-500">
                  No cases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-500">
        Admin views bypass row-level security via the service role key. Acting on a case still
        requires opening it as that user, which RLS prevents.
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
