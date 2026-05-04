import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { InquiryRow } from './inquiry-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALL_STATUSES = [
  'new',
  'contacted',
  'demo-scheduled',
  'pilot',
  'signed',
  'closed-lost',
  'archived',
] as const;
type Status = (typeof ALL_STATUSES)[number];

type InquiryRowShape = {
  id: string;
  firm_name: string;
  contact_name: string;
  contact_role: string | null;
  email: string;
  sector: string;
  team_size: string | null;
  message: string | null;
  status: Status;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

const SECTOR_LABEL: Record<string, string> = {
  firm: 'Private firm',
  'inhouse-corp': 'In-house corp',
  'inhouse-other': 'In-house other',
  'legal-aid': 'Legal aid',
  government: 'Government',
  other: 'Other',
};

export default async function AdminEnterpriseInquiriesPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  if (!(await isCurrentUserAdmin())) {
    redirect('/');
  }
  const filter = ((ALL_STATUSES as readonly string[]).includes(searchParams?.status ?? '')
    ? (searchParams?.status as Status)
    : 'all') as Status | 'all';

  const admin = createAdminSupabase();
  if (!admin) {
    return (
      <div className="card p-6">
        <h1 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-2">
          Enterprise inquiries
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70">
          SUPABASE_SERVICE_ROLE_KEY isn&apos;t configured. Add it to read inquiries.
        </p>
      </div>
    );
  }

  const query = admin
    .from('enterprise_inquiries')
    .select('*')
    .order('created_at', { ascending: false });
  if (filter !== 'all') query.eq('status', filter);
  const { data, error } = await query;
  if (error) {
    return (
      <div className="card p-6">
        <p className="text-sm text-rose-700 dark:text-rose-300">
          Could not load inquiries: {error.message}
        </p>
      </div>
    );
  }
  const rows = (data ?? []) as InquiryRowShape[];

  // Count per status for the filter chips. One round-trip is fine
  // since the table is small (manual triage). Re-runs each render.
  const allRows: InquiryRowShape[] =
    filter === 'all'
      ? rows
      : ((await admin
          .from('enterprise_inquiries')
          .select('status')
          .then((r) => r.data ?? [])) as InquiryRowShape[]);
  const counts = new Map<string, number>();
  for (const r of allRows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  counts.set('all', allRows.length);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Sales</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Enterprise inquiries
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1">
          Submissions from /enterprise. Triage, contact, sign, and once a deal closes set the
          custom price on the firm&apos;s subscription record.
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-1.5 text-xs">
        {(['all', ...ALL_STATUSES] as const).map((s) => {
          const count = counts.get(s) ?? 0;
          const active = filter === s;
          return (
            <a
              key={s}
              href={s === 'all' ? '?' : `?status=${s}`}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                active
                  ? 'bg-forest-900 text-cream-100 dark:bg-gold-metal dark:text-forest-950 font-semibold'
                  : 'text-ink-700 dark:text-cream-100/70 hover:bg-ink-100 dark:hover:bg-forest-800/60'
              }`}
            >
              {s === 'all' ? 'All' : s.replace(/-/g, ' ')}
              <span className="ml-1.5 tabular-nums opacity-75">({count})</span>
            </a>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500 dark:text-cream-100/55">
          No inquiries yet. New submissions land here in real time.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <InquiryRow
              key={r.id}
              id={r.id}
              firmName={r.firm_name}
              contactName={r.contact_name}
              contactRole={r.contact_role}
              email={r.email}
              sector={SECTOR_LABEL[r.sector] ?? r.sector}
              teamSize={r.team_size}
              message={r.message}
              status={r.status}
              adminNotes={r.admin_notes}
              createdAt={r.created_at}
              updatedAt={r.updated_at}
            />
          ))}
        </div>
      )}
    </div>
  );
}
