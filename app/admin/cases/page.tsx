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

export default async function AdminCasesPage({
  searchParams,
}: {
  searchParams?: { groupBy?: string };
}) {
  const cases = await adminListCases();
  const groupBy = searchParams?.groupBy === 'caseType' ? 'caseType' : 'flat';

  // Group by case type if requested
  const groups = new Map<string, typeof cases>();
  if (groupBy === 'caseType') {
    for (const c of cases) {
      const k = c.caseType || 'Uncategorized';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {cases.length} case{cases.length === 1 ? '' : 's'} across all users
        </p>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-ink-500">Group by:</span>
          <Link
            href="/admin/cases"
            className={`px-2.5 py-1 rounded ${
              groupBy === 'flat' ? 'bg-forest-900 text-cream-200' : 'text-ink-700 hover:bg-ink-100'
            }`}
          >
            Updated date
          </Link>
          <Link
            href="/admin/cases?groupBy=caseType"
            className={`px-2.5 py-1 rounded ${
              groupBy === 'caseType' ? 'bg-forest-900 text-cream-200' : 'text-ink-700 hover:bg-ink-100'
            }`}
          >
            Case type
          </Link>
        </div>
      </div>
      {groupBy === 'caseType' && (
        <div className="space-y-6">
          {Array.from(groups.entries())
            .sort((a, b) => b[1].length - a[1].length)
            .map(([type, items]) => (
              <div key={type}>
                <h3 className="font-semibold text-forest-900 mb-2 flex items-baseline gap-2">
                  {type}
                  <span className="text-xs text-ink-500 font-normal">
                    {items.length} case{items.length === 1 ? '' : 's'}
                  </span>
                </h3>
                <CasesTable rows={items} />
              </div>
            ))}
        </div>
      )}
      {groupBy === 'flat' && <CasesTable rows={cases} />}
    </div>
  );
}

function CasesTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof adminListCases>>;
}) {
  return (
      <div
        className="card overflow-x-auto"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <table className="w-full text-sm min-w-[720px]">
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
            {rows.map((c) => (
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-ink-500">
                  No cases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
