import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { FIRM_TYPE_LABEL, type FirmType } from '@/lib/firm-types';
import { RequestActions } from './request-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Counsel access requests · Advottic HQ' } };

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
  status: 'pending' | 'scheduled' | 'approved' | 'denied' | 'accepted';
  reviewed_at: string | null;
  review_note: string | null;
  scheduled_call_at: string | null;
  scheduled_call_note: string | null;
  created_at: string;
};

export default async function HqCounselRequestsPage() {
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
  const scheduled = requests.filter((r) => r.status === 'scheduled');
  const reviewed = requests.filter(
    (r) => r.status === 'approved' || r.status === 'denied' || r.status === 'accepted',
  );

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel</p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Access requests
        </h2>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Triage prospective firms. Schedule a discovery call, approve to mint a setup
          link, or deny with an internal note. Approving creates a single-use grant token
          and emails it to the applicant.
        </p>
      </header>

      <RequestSection title="Pending" tone="amber" rows={pending} />
      <RequestSection title="Scheduled" tone="sky" rows={scheduled} />
      {reviewed.length > 0 && <RequestSection title="Reviewed" tone="ink" rows={reviewed} />}
    </div>
  );
}

function RequestSection({
  title,
  tone,
  rows,
}: {
  title: string;
  tone: 'amber' | 'sky' | 'ink';
  rows: RequestRow[];
}) {
  if (rows.length === 0 && tone !== 'amber' && tone !== 'sky') return null;
  return (
    <section className="space-y-3">
      <p className="eyebrow">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          No {title.toLowerCase()} requests.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((req) => (
            <RequestCard key={req.id} req={req} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestCard({ req }: { req: RequestRow }) {
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
        <StatusBadge status={req.status} />
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
            <span className="text-[12px] text-ink-500 dark:text-cream-100/55">
              {' · '}
              {req.contact_role}
            </span>
          )}
        </p>
        {req.description && (
          <p className="text-[13px] text-ink-700 dark:text-cream-100/75 mt-2 leading-relaxed whitespace-pre-wrap">
            {req.description}
          </p>
        )}
        {req.scheduled_call_at && (
          <div className="text-[12px] mt-2 rounded-md bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-700/30 text-sky-900 dark:text-sky-100 px-3 py-2">
            <p className="font-semibold">
              Call proposed for{' '}
              {new Date(req.scheduled_call_at).toLocaleString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
              })}
            </p>
            {req.scheduled_call_note && (
              <p className="mt-1 whitespace-pre-wrap opacity-90">{req.scheduled_call_note}</p>
            )}
          </div>
        )}
        {req.review_note && (
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 italic mt-1.5">
            Internal note: {req.review_note}
          </p>
        )}
        <p className="text-[11px] text-ink-500 dark:text-cream-100/70 font-mono tabular-nums mt-2">
          Submitted {new Date(req.created_at).toLocaleString()}
          {req.reviewed_at && ` · Reviewed ${new Date(req.reviewed_at).toLocaleString()}`}
        </p>
      </div>
      {(req.status === 'pending' || req.status === 'scheduled') && (
        <RequestActions
          requestId={req.id}
          alreadyScheduled={req.status === 'scheduled'}
        />
      )}
    </li>
  );
}

function StatusBadge({
  status,
}: {
  status: 'pending' | 'scheduled' | 'approved' | 'denied' | 'accepted';
}) {
  const map: Record<string, string> = {
    pending:
      'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100',
    scheduled:
      'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-100',
    approved:
      'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-100',
    accepted:
      'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100',
    denied:
      'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-100',
  };
  return (
    <span className={`badge text-[10px] tracking-wider ${map[status] ?? map.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}
