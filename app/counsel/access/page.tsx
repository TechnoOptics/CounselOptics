import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { SignupRequestRow } from '@/lib/access-requests';
import { LocaleTime } from '@/components/LocaleTime';
import { ReviewButtons } from './review-buttons';
import { PageHeader } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { PanelCard, MonoRef } from '@/components/counsel/patterns';
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
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>People</T>}
        title={<T>Access requests</T>}
        subtitle={
          <T>People with a work email on the firm&rsquo;s allowed domains
          are set up automatically. Everyone else - outside clients,
          vendors, counterparties - lands here for you to approve or
          decline before any account exists. Approved external accounts
          get the request loop only, never internal tools.</T>
        }
      />

      {/* Two cards rather than a view strip. Pending and reviewed are
          real subsets, but they are not interchangeable views of one
          list: only the pending set carries the approve/decline
          controls, and putting it behind a tab would let a queue that
          needs an answer sit unseen. The counts sit in the card headers
          instead. */}
      <PanelCard
        title={<T>Pending</T>}
        action={
          <p className="text-[12px] tabular-nums text-muted">
            {pending.length}
          </p>
        }
      >
        {pending.length === 0 ? (
          <p className="text-[13px] italic text-muted">
            <T>No requests waiting. New external sign-ups will appear here.</T>
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-edge bg-surface-2 p-3"
              >
                <div className="min-w-0">
                  <p
                    className="text-[13.5px] font-semibold text-foreground"
                    data-no-translate
                  >
                    {r.full_name || r.email}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    <MonoRef>{r.email}</MonoRef> ·{' '}
                    <T>external · requested</T>{' '}
                    <LocaleTime iso={r.requested_at} mode="datetime" />
                  </p>
                </div>
                <ReviewButtons requestId={r.id} />
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      {reviewed.length > 0 && (
        <PanelCard
          title={<T>Recently reviewed</T>}
          action={
            <p className="text-[12px] tabular-nums text-muted">
              {reviewed.length}
            </p>
          }
        >
          <ul className="space-y-1.5">
            {reviewed.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 text-[12.5px]"
              >
                <span className="truncate text-foreground" data-no-translate>
                  {r.full_name || r.email}{' '}
                  <MonoRef>{r.email}</MonoRef>
                </span>
                <StatusPill
                  size="sm"
                  dot
                  color={
                    r.status === 'approved'
                      ? PILL_COLORS.good
                      : PILL_COLORS.neutral
                  }
                >
                  {r.status}
                </StatusPill>
              </li>
            ))}
          </ul>
        </PanelCard>
      )}
    </div>
  );
}
