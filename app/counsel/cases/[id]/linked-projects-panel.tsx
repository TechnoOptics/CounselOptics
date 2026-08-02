import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import { T } from '@/components/i18n/LocaleProvider';
import { SectionTitle } from '@/components/counsel/ui';

/**
 * Lists the project binders bound to this matter (firm_projects.case_id). A
 * self-contained async server component: it does its own RLS-scoped read and
 * renders nothing when the case has no linked projects, so it is safe to drop
 * onto the case detail page as a single line.
 */
export async function LinkedProjectsPanel({
  firmId,
  caseId,
}: {
  firmId: string;
  caseId: string;
}) {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_projects')
    .select('id, name, description, status')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .order('updated_at', { ascending: false });
  const projects = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
  }>;
  if (projects.length === 0) return null;

  return (
    <section className="card p-4 space-y-3">
      <SectionTitle
        variant="display"
        action={
          <Link
            href="/counsel/projects"
            className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:underline"
          >
            <T>All projects</T> →
          </Link>
        }
      >
        <T>Linked projects</T>
      </SectionTitle>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/counsel/projects/${p.id}`}
                  className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100 hover:underline break-words"
                >
                  {p.name}
                </Link>
                {p.description && (
                  <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-0.5 line-clamp-2">
                    {p.description}
                  </p>
                )}
              </div>
              {p.status === 'archived' && (
                <span className="text-[11px] uppercase tracking-[0.1em] text-ink-400 dark:text-cream-100/40 shrink-0">
                  <T>Archived</T>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
