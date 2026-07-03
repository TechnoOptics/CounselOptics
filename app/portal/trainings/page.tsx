import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { LocaleTime } from '@/components/LocaleTime';
import { ExternalLink } from '@/components/ExternalLink';
import { CompleteTrainingButton } from './complete-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trainings · Hub' };

export default async function HubTrainingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/trainings');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const admin = createAdminSupabase();
  let assignments: Array<{
    id: string;
    title: string;
    description: string | null;
    url: string | null;
    due_at: string | null;
    completed_at: string | null;
  }> = [];
  if (admin) {
    const { data } = await admin
      .from('firm_training_assignments')
      .select(
        'id, due_at, completed_at, firm_trainings ( title, description, url )',
      )
      .eq('firm_id', persona.firm.id)
      .eq('employee_user_id', user.id)
      .order('assigned_at', { ascending: false })
      .limit(100);
    assignments = ((data ?? []) as Array<Record<string, unknown>>).map(
      (r) => {
        const t = (r.firm_trainings ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id),
          title: String(t.title ?? 'Training'),
          description: (t.description as string | null) ?? null,
          url: (t.url as string | null) ?? null,
          due_at: (r.due_at as string | null) ?? null,
          completed_at: (r.completed_at as string | null) ?? null,
        };
      },
    );
  }
  const open = assignments.filter((a) => !a.completed_at);
  const done = assignments.filter((a) => a.completed_at);

  return (
    <div className="space-y-7 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100">
          Trainings
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Trainings your legal team has assigned. Open each one, then
          mark it complete.
        </p>
      </header>

      {assignments.length === 0 ? (
        <div className="popup-panel p-6 text-[13px] text-cream-100/60 italic">
          No trainings assigned yet. When legal assigns a required
          training, it will appear here with its due date.
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-display text-lg text-cream-100">
              To do{' '}
              <span className="text-[12px] text-cream-100/45">
                ({open.length})
              </span>
            </h2>
            {open.length === 0 ? (
              <p className="popup-panel p-5 text-[13px] text-cream-100/55 italic">
                All caught up - nothing outstanding.
              </p>
            ) : (
              <ul className="space-y-2">
                {open.map((a) => (
                  <li key={a.id} className="popup-panel p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-cream-100">
                          {a.title}
                        </p>
                        {a.description && (
                          <p className="text-[12.5px] text-cream-100/65 mt-1 leading-snug">
                            {a.description}
                          </p>
                        )}
                        {a.due_at && (
                          <p className="text-[11.5px] text-amber-300 mt-1">
                            Due{' '}
                            <LocaleTime iso={a.due_at} mode="date" />
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {a.url && (
                          <ExternalLink
                            href={a.url}
                            className="btn text-[12px] ring-1 ring-gold-500/40 text-gold-200 hover:bg-gold-500/10"
                          >
                            Open
                          </ExternalLink>
                        )}
                        <CompleteTrainingButton assignmentId={a.id} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {done.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-display text-lg text-cream-100">
                Completed
              </h2>
              <ul className="space-y-1.5">
                {done.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 text-[12.5px] px-1"
                  >
                    <span className="text-cream-100/75 truncate">
                      {a.title}
                    </span>
                    <span className="shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ring-emerald-700/40 bg-emerald-950/30 text-emerald-200">
                      Done
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
