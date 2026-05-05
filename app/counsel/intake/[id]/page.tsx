import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { ConflictCheckPanel } from './conflict-check-panel';

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
};

export default async function IntakeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_matter_intakes')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!data) notFound();
  const intake = data as {
    id: string;
    firm_id: string;
    client_name: string;
    client_email: string | null;
    client_phone: string | null;
    matter_type: string | null;
    matter_summary: string | null;
    jurisdiction_state: string | null;
    opposing_parties: string[];
    related_parties: string[];
    status: string;
    conflict_check_notes: string | null;
    conflict_results: Array<{
      source: string;
      matchedParty: string;
      matchedAgainst: string;
      severity: string;
    }> | null;
    created_at: string;
  };
  if (intake.firm_id !== ctx.firm.id) notFound();

  const tone = STATUS_TONE[intake.status] ?? STATUS_TONE.in_progress;

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/intake"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Intake
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">Intake</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 break-words">
            {intake.client_name}
          </h1>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
            {intake.matter_type ?? 'Matter type not set'}
            {intake.jurisdiction_state && ` · ${intake.jurisdiction_state}`}
            {' · '}created{' '}
            {new Date(intake.created_at).toLocaleString()}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
        >
          {intake.status.replace(/_/g, ' ')}
        </span>
      </header>

      <section className="card p-5 grid sm:grid-cols-2 gap-3">
        <div>
          <p className="eyebrow text-[10px] mb-1">Email</p>
          <p className="text-[13px]">
            {intake.client_email ? (
              <a href={`mailto:${intake.client_email}`} className="underline">
                {intake.client_email}
              </a>
            ) : (
              <span className="italic text-ink-500 dark:text-cream-100/55">
                Not set
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="eyebrow text-[10px] mb-1">Phone</p>
          <p className="text-[13px]">
            {intake.client_phone ?? (
              <span className="italic text-ink-500 dark:text-cream-100/55">
                Not set
              </span>
            )}
          </p>
        </div>
        <div className="sm:col-span-2">
          <p className="eyebrow text-[10px] mb-1">Matter summary</p>
          <p className="text-[13px] text-ink-700 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap">
            {intake.matter_summary ?? '(none)'}
          </p>
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow mb-2">Opposing parties</p>
          {intake.opposing_parties.length === 0 ? (
            <p className="text-[13px] italic text-ink-500 dark:text-cream-100/55">
              None listed.
            </p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {intake.opposing_parties.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <p className="eyebrow mb-2">Related parties</p>
          {intake.related_parties.length === 0 ? (
            <p className="text-[13px] italic text-ink-500 dark:text-cream-100/55">
              None listed.
            </p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {intake.related_parties.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConflictCheckPanel
        firmId={ctx.firm.id}
        intakeId={intake.id}
        status={intake.status}
        results={intake.conflict_results}
        notes={intake.conflict_check_notes}
      />
    </div>
  );
}
