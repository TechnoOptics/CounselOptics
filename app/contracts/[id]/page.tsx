import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured, createServerSupabase } from '@/lib/supabase/server';
import { getContractType } from '@/lib/contract-types';
import { ReviewPanel } from './review-panel';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Contract',
  robots: { index: false, follow: false },
};

function confidenceTone(score: number) {
  if (score >= 70) return 'text-emerald-700 dark:text-emerald-300';
  if (score >= 50) return 'text-amber-700 dark:text-amber-300';
  return 'text-rose-700 dark:text-rose-300';
}

function confidenceLabel(score: number) {
  if (score >= 90) return 'Very standard / low risk';
  if (score >= 70) return 'Workable; carve-outs to negotiate';
  if (score >= 50) return 'Meaningful issues; push back';
  if (score >= 25) return 'Significant red flags';
  return 'Walk away or get an attorney';
}

export default async function ContractDetailPage({
  params,
}: {
  params: { id: string };
}) {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=/contracts/${params.id}`);

  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('user_contracts')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const c = data as {
    id: string;
    user_id: string | null;
    name: string;
    contract_type: string;
    custom_type: string | null;
    parties: string[];
    jurisdiction: string | null;
    signed_at: string | null;
    expiry_at: string | null;
    file_path: string | null;
    notes: string | null;
    tags: string[];
    review_summary: string | null;
    review_confidence: number | null;
    review_pros: string[] | null;
    review_cons: string[] | null;
    review_suggestions: string[] | null;
    reviewed_at: string | null;
    reviewed_model: string | null;
    created_at: string;
  };
  if (c.user_id && c.user_id !== user.id) notFound();

  const type = getContractType(c.contract_type);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/contracts"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Contracts
        </Link>
      </p>

      <header>
        <p className="eyebrow mb-1">Contract</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words">
          {c.name}
        </h1>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
          {c.custom_type ?? type?.label ?? c.contract_type}
          {c.jurisdiction && ` · ${c.jurisdiction}`}
          {' · '}
          added {new Date(c.created_at).toLocaleDateString()}
        </p>
      </header>

      <section className="card p-5 grid sm:grid-cols-2 gap-3 text-[13px]">
        <Field label="Parties">
          {c.parties.length > 0 ? c.parties.join(', ') : '—'}
        </Field>
        <Field label="Signed">
          {c.signed_at ? new Date(c.signed_at).toLocaleDateString() : '—'}
        </Field>
        <Field label="Expires">
          {c.expiry_at ? new Date(c.expiry_at).toLocaleDateString() : '—'}
        </Field>
        <Field label="Tags">
          {c.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1 mt-0.5">
              {c.tags.map((t) => (
                <span
                  key={t}
                  className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10.5px]"
                >
                  {t}
                </span>
              ))}
            </span>
          ) : (
            '—'
          )}
        </Field>
        {c.notes && (
          <div className="sm:col-span-2">
            <p className="eyebrow text-[10px] mb-1">Notes</p>
            <p className="text-[13px] text-ink-700 dark:text-cream-100/85 whitespace-pre-wrap leading-relaxed">
              {c.notes}
            </p>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="eyebrow">Bella review</p>
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5 leading-relaxed">
              Plain-English summary, confidence rating, pros, cons, and
              concrete edits. Not legal advice. Hand to your counsel for
              anything material.
            </p>
          </div>
          <ReviewPanel
            contractId={c.id}
            initialReviewedAt={c.reviewed_at}
          />
        </div>

        {c.reviewed_at ? (
          <div className="space-y-4">
            {c.review_confidence !== null && (
              <div className="rounded-lg p-4 ring-1 ring-ink-200 dark:ring-forest-700/40 bg-ink-50/40 dark:bg-forest-900/30">
                <div className="flex items-baseline gap-3">
                  <p
                    className={`font-display text-4xl font-medium tabular-nums ${confidenceTone(c.review_confidence)}`}
                  >
                    {c.review_confidence}
                    <span className="text-base font-normal text-ink-500 dark:text-cream-100/55">
                      {' '}
                      / 100
                    </span>
                  </p>
                  <p className={`text-[13px] font-semibold ${confidenceTone(c.review_confidence)}`}>
                    {confidenceLabel(c.review_confidence)}
                  </p>
                </div>
              </div>
            )}
            {c.review_summary && (
              <div>
                <p className="eyebrow text-[10px] mb-1">Summary</p>
                <p className="text-[13.5px] leading-relaxed text-ink-800 dark:text-cream-100/90">
                  {c.review_summary}
                </p>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <ReviewList
                title="Pros"
                items={c.review_pros}
                tone="emerald"
              />
              <ReviewList title="Cons" items={c.review_cons} tone="rose" />
            </div>
            {c.review_suggestions && c.review_suggestions.length > 0 && (
              <div>
                <p className="eyebrow text-[10px] mb-1.5">Suggested edits</p>
                <ul className="space-y-1.5 text-[13px] text-ink-800 dark:text-cream-100/90 leading-relaxed">
                  {c.review_suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-ink-400">
                        →
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-ink-500 dark:text-cream-100/55 italic pt-3 border-t border-ink-100 dark:border-forest-800/40">
              Reviewed {new Date(c.reviewed_at).toLocaleString()}
              {c.reviewed_model && ` · ${c.reviewed_model}`}. Not legal
              advice. Counsel decides what is binding in your jurisdiction.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No review yet. Click &ldquo;Run review&rdquo; to have Bella read
            this and return a structured assessment.
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow text-[10px] mb-1">{label}</p>
      <p className="text-ink-800 dark:text-cream-100/90">{children}</p>
    </div>
  );
}

function ReviewList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[] | null;
  tone: 'emerald' | 'rose';
}) {
  if (!items || items.length === 0) return null;
  const dot =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400';
  const sym = tone === 'emerald' ? '+' : '−';
  return (
    <div>
      <p className="eyebrow text-[10px] mb-1.5">{title}</p>
      <ul className="space-y-1 text-[13px] text-ink-800 dark:text-cream-100/90 leading-relaxed">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className={`${dot} font-mono shrink-0`} aria-hidden>
              {sym}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
