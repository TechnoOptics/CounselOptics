import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { SignupRequestRow } from '@/lib/access-requests';
import { LocaleTime } from '@/components/LocaleTime';
import { ReviewButtons } from './review-buttons';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Access requests · Counsel' };

export default async function CounselAccessPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const isAdmin =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';
  if (!isAdmin) redirect('/counsel');

  const admin = createAdminSupabase();
  let pending: SignupRequestRow[] = [];
  let reviewed: SignupRequestRow[] = [];
  if (admin) {
    const { data } = await admin
      .from('firm_signup_requests')
      .select('*')
      .eq('firm_id', ctx.firm.id)
      .order('requested_at', { ascending: false })
      .limit(150);
    const rows = (data ?? []) as SignupRequestRow[];
    pending = rows.filter((r) => r.status === 'pending');
    reviewed = rows.filter((r) => r.status !== 'pending').slice(0, 40);
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>People</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Access requests</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>People with a work email on the firm&rsquo;s allowed domains
          are set up automatically. Everyone else - outside clients,
          vendors, counterparties - lands here for you to approve or
          decline before any account exists. Approved external accounts
          get the request loop only, never internal tools.</T>
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg text-forest-900 dark:text-cream-100">
            <T>Pending</T>
          </h2>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-gold-400 text-forest-950">
            {pending.length}
          </span>
        </div>
        {pending.length === 0 ? (
          <p className="card p-6 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            <T>No requests waiting. New external sign-ups will appear here.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r.id}
                className="card p-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-forest-900 dark:text-cream-100">
                    {r.full_name || r.email}
                  </p>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    <span className="font-mono">{r.email}</span> ·{' '}
                    <T>external · requested</T>{' '}
                    <LocaleTime iso={r.requested_at} mode="datetime" />
                  </p>
                </div>
                <ReviewButtons requestId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {reviewed.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg text-forest-900 dark:text-cream-100">
            <T>Recently reviewed</T>
          </h2>
          <ul className="space-y-1.5">
            {reviewed.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 text-[12.5px] px-1"
              >
                <span className="text-ink-700 dark:text-cream-100/75 truncate">
                  {r.full_name || r.email}{' '}
                  <span className="text-ink-400 dark:text-cream-100/40 font-mono">
                    {r.email}
                  </span>
                </span>
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${
                    r.status === 'approved'
                      ? 'text-emerald-700 dark:text-emerald-200 ring-emerald-300/50 dark:ring-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30'
                      : 'text-ink-600 dark:text-cream-100/60 ring-ink-200 dark:ring-forest-700/40 bg-ink-50 dark:bg-forest-800/40'
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
