import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { getContractType } from '@/lib/contract-types';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Contracts · Counsel' };

const STATUS_TONE: Record<string, string> = {
  stored:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  reviewed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  expired:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1"><T>Counsel · contracts</T></p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            <T>Contract repository</T>
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            <T>Standalone contracts (not tied to a specific case). Useful for
            firm operating docs, vendor agreements, employment offers, and
            any document you want Bella to review in seconds.</T>
          </p>
        </div>
        <Link href="/counsel/contracts/new" className="btn-primary text-sm">
          <T>Add a contract</T>
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            <T>No contracts stored yet.</T>
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            <T>Upload an NDA, MSA, lease, or anything else not yet associated
            with a matter.</T>
          </p>
          <Link
            href="/counsel/contracts/new"
            className="btn-primary mt-5 inline-flex"
          >
            <T>Upload your first contract</T>
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const type = getContractType(r.contract_type);
            const tone = STATUS_TONE[r.status] ?? STATUS_TONE.stored;
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
                    <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                      {r.name}
                    </p>
                    <span
                      className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                    >
                      {r.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono">
                    {r.custom_type ?? type?.label ?? r.contract_type}
                    {r.parties.length > 0 && ` · ${r.parties.slice(0, 2).join(', ')}`}
                    {r.expiry_at &&
                      ` · expires ${new Date(r.expiry_at).toLocaleDateString()}`}
                  </p>
                  {r.review_confidence !== null && (
                    <p className="text-[12px] text-ink-600 dark:text-cream-100/70 font-mono tabular-nums">
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
