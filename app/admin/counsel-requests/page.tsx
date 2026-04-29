import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { FIRM_TYPE_LABEL, type FirmType } from '@/lib/firm-types';
import { RequestActions } from './request-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Counsel access requests · Admin' };

type RequestRow = {
  id: string;
  organization_name: string;
  contact_name: string;
  contact_email: string;
  contact_role: string | null;
  firm_type: FirmType;
  team_size: string | null;
  jurisdictions: string | null;
  description: string | null;
  status: 'pending' | 'approved' | 'denied' | 'accepted';
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

export default async function AdminCounselRequestsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/');
  const admin = createAdminSupabase();
  if (!admin) {
    return (
      <div className="card p-8">
        <p className="text-sm text-ink-700 dark:text-cream-100/80">
          Server is missing <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      </div>
    );
  }
  const { data } = await admin
    .from('firm_access_requests')
    .select('*')
    .order('created_at', { ascending: false });
  const requests = (data ?? []) as RequestRow[];

  const pending = requests.filter((r) => r.status === 'pending');
  const reviewed = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Admin</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Counsel access requests
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Review and approve organizational access requests. Approving creates a
          single-use grant token and emails it to the applicant.
        </p>
      </header>

      <section className="space-y-3">
        <p className="eyebrow">Pending ({pending.length})</p>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-cream-100/55">No pending requests.</p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((req) => (
              <RequestRow key={req.id} req={req} />
            ))}
          </ul>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="space-y-3">
          <p className="eyebrow">Reviewed ({reviewed.length})</p>
          <ul className="grid gap-3">
            {reviewed.map((req) => (
              <RequestRow key={req.id} req={req} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestRow({ req }: { req: RequestRow }) {
  return (
    <li className="card p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg text-forest-900 dark:text-cream-100">
            {req.organization_name}
          </p>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
            {FIRM_TYPE_LABEL[req.firm_type]}
            {req.team_size ? ` · ${req.team_size}` : ''}
            {req.jurisdictions ? ` · ${req.jurisdictions}` : ''}
          </p>
        </div>
        <span
          className={`badge text-[10px] tracking-wider ${
            req.status === 'pending'
              ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
              : req.status === 'approved'
                ? 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-100'
                : req.status === 'accepted'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
                  : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-100'
          }`}
        >
          {req.status.toUpperCase()}
        </span>
      </div>
      <div className="text-sm text-ink-700 dark:text-cream-100/80 space-y-0.5">
        <p>
          <strong>{req.contact_name}</strong>{' '}
          <a
            href={`mailto:${req.contact_email}`}
            className="text-[13px] underline text-ink-500 dark:text-cream-100/70 hover:text-forest-900 dark:hover:text-cream-100"
          >
            {req.contact_email}
          </a>
          {req.contact_role && (
            <span className="text-[12px] text-ink-500 dark:text-cream-100/55"> · {req.contact_role}</span>
          )}
        </p>
        {req.description && (
          <p className="text-[13px] text-ink-700 dark:text-cream-100/75 mt-2 leading-relaxed whitespace-pre-wrap">
            {req.description}
          </p>
        )}
        {req.review_note && (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 italic mt-1.5">
            Internal note: {req.review_note}
          </p>
        )}
        <p className="text-[11px] text-ink-400 dark:text-cream-100/45 font-mono tabular-nums mt-2">
          Submitted {new Date(req.created_at).toLocaleString()}
          {req.reviewed_at && ` · Reviewed ${new Date(req.reviewed_at).toLocaleString()}`}
        </p>
      </div>
      {req.status === 'pending' && <RequestActions requestId={req.id} />}
    </li>
  );
}
