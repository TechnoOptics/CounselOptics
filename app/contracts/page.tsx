import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured, createServerSupabase } from '@/lib/supabase/server';
import { getContractType } from '@/lib/contract-types';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Contracts - Advottic',
  description: 'Store contracts. Run an AI review. Track expirations.',
  robots: { index: false, follow: false },
};

const STATUS_TONE: Record<string, string> = {
  stored:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  review_pending:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  reviewed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  active:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  expired:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  terminated:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  superseded:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
};

function confidenceTone(score: number | null) {
  if (score === null) return 'text-ink-500 dark:text-cream-100/55';
  if (score >= 70) return 'text-emerald-700 dark:text-emerald-300';
  if (score >= 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

export default async function ContractsListPage() {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/contracts');

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_contracts')
    .select(
      'id, name, contract_type, custom_type, status, signed_at, expiry_at, review_confidence, reviewed_at, created_at',
    )
    .eq('user_id', user.id)
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
    created_at: string;
  }>;

  const expiringSoon = rows.filter(
    (r) =>
      r.expiry_at &&
      Date.parse(r.expiry_at) > Date.now() &&
      Date.parse(r.expiry_at) < Date.now() + 60 * 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Contracts</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Your contract library
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
            Store contracts you&rsquo;ve signed (or are about to). Run an
            AI review for a confidence rating + suggested edits, or just
            keep them filed for reference.
          </p>
        </div>
        <Link href="/contracts/new" className="btn-primary text-sm">
          Add a contract
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="In library" value={String(rows.length)} />
        <Stat
          label="Reviewed"
          value={String(rows.filter((r) => r.reviewed_at).length)}
          tone="emerald"
        />
        <Stat
          label="Expiring within 60 days"
          value={String(expiringSoon)}
          tone={expiringSoon > 0 ? 'amber' : 'gray'}
        />
      </section>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            Nothing stored yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Upload an NDA, a lease, an offer letter, anything you want
            Bella to look over or that you just want to keep in one place.
          </p>
          <Link href="/contracts/new" className="btn-primary mt-5 inline-flex">
            Upload your first contract
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
                <Link href={`/contracts/${r.id}`} className="block space-y-1">
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
                    {r.signed_at &&
                      ` · signed ${new Date(r.signed_at).toLocaleDateString()}`}
                    {r.expiry_at &&
                      ` · expires ${new Date(r.expiry_at).toLocaleDateString()}`}
                  </p>
                  {r.review_confidence !== null && (
                    <p
                      className={`text-[12px] font-mono tabular-nums ${confidenceTone(r.review_confidence)}`}
                    >
                      Bella confidence: {r.review_confidence}/100
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

function Stat({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value: string;
  tone?: 'gray' | 'amber' | 'emerald';
}) {
  const cls =
    tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'emerald'
        ? 'text-emerald-700 dark:text-emerald-300'
        : 'text-forest-900 dark:text-cream-100';
  return (
    <div className="card p-4">
      <p className="eyebrow text-[10.5px] mb-1.5">{label}</p>
      <p className={`font-display text-2xl font-medium tabular-nums ${cls}`}>
        {value}
      </p>
    </div>
  );
}
