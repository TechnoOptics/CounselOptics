import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { CreateIntakeForm } from './create-intake-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Intake · Counsel · Advottic' };

const STATUS_TONE: Record<string, string> = {
  in_progress:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  conflict_check_passed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  conflict_check_flagged:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  engaged:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  rejected:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
};

export default async function CounselIntakePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data: intakesRaw } = await supabase
    .from('firm_matter_intakes')
    .select(
      'id, client_name, matter_type, jurisdiction_state, status, created_at',
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(100);
  const intakes = (intakesRaw ?? []) as Array<{
    id: string;
    client_name: string;
    matter_type: string | null;
    jurisdiction_state: string | null;
    status: string;
    created_at: string;
  }>;

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · intake</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Matter intake
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Capture client + opposing parties, run a conflict check across
          your prior matters and existing client list, then promote the
          intake to a real matter once the check passes.
        </p>
      </header>

      <CreateIntakeForm firmId={ctx.firm.id} />

      <section className="space-y-3">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Recent intakes
        </h2>
        {intakes.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No intakes yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {intakes.map((i) => {
              const tone = STATUS_TONE[i.status] ?? STATUS_TONE.in_progress;
              return (
                <li
                  key={i.id}
                  className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
                >
                  <Link href={`/counsel/intake/${i.id}`} className="block">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                        {i.client_name}
                      </p>
                      <span
                        className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                      >
                        {i.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-1">
                      {i.matter_type ?? 'Matter type not set'}
                      {i.jurisdiction_state && ` · ${i.jurisdiction_state}`}
                      {' · '}
                      {new Date(i.created_at).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
