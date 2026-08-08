import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { getContractType } from '@/lib/contract-types';
import { PageHeader, EmptyState } from '@/components/counsel/ui';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contracts · Counsel' };

// One hex per status; StatusPill derives the fill and the border from
// it. An unlisted status falls back to the stored neutral.
const STATUS_COLOR: Record<string, string> = {
  stored: PILL_COLORS.neutral,
  reviewed: PILL_COLORS.good,
  expired: PILL_COLORS.flagged,
};

export default async function CounselContractsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_contracts')
    .select(
      'id, name, contract_type, custom_type, status, signed_at, expiry_at, review_confidence, reviewed_at, parties, created_at',
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    contract_type: string;
    custom_type: string | null;
    status: string;
    signed_at: string | null;
    expiry_at: string | null;
    review_confidence: number | null;
    reviewed_at: string | null;
    parties: string[];
    created_at: string;
  }>;

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · contracts</T>}
        title={<T>Contract repository</T>}
        subtitle={
          <T>Standalone contracts (not tied to a specific case). Useful for
          firm operating docs, vendor agreements, employment offers, and
          any document you want Bella to review in seconds.</T>
        }
        action={
          <Link href="/counsel/contracts/new" className="btn-primary text-sm">
            <T>Add a contract</T>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={<T>No contracts stored yet.</T>}
          sub={
            <T>Upload an NDA, MSA, lease, or anything else not yet associated
            with a matter.</T>
          }
          action={
            <Link href="/counsel/contracts/new" className="btn-primary">
              <T>Upload your first contract</T>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const type = getContractType(r.contract_type);
            return (
              <li
                key={r.id}
                className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
              >
                <Link
                  href={`/counsel/contracts/${r.id}`}
                  className="block space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground truncate">
                      {r.name}
                    </p>
                    <StatusPill
                      size="sm"
                      color={STATUS_COLOR[r.status] ?? STATUS_COLOR.stored}
                    >
                      {r.status.replace(/_/g, ' ')}
                    </StatusPill>
                  </div>
                  <p className="text-[12px] text-muted font-mono">
                    {r.custom_type ?? type?.label ?? r.contract_type}
                    {r.parties.length > 0 && ` · ${r.parties.slice(0, 2).join(', ')}`}
                    {r.expiry_at &&
                      ` · expires ${new Date(r.expiry_at).toLocaleDateString()}`}
                  </p>
                  {r.review_confidence !== null && (
                    <p className="text-[12px] text-muted font-mono tabular-nums">
                      <T>Bella confidence</T> {r.review_confidence}/100
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
