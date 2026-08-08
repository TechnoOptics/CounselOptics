import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { listFirmProjects } from '@/lib/projects-actions';
import { NewProjectForm } from './new-project-form';
import { EmptyState, PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects · Counsel' };

/**
 * Firm projects list. A project is a named workspace of folders holding
 * notes and documents - anything the firm wants to keep together and
 * retrieve later (an onboarding, a policy review, a research binder).
 *
 * With ?caseId=, the page scopes to one case: it filters the list to
 * that case's projects and new ones created here attach to it (the
 * in-context entry from the case page, Product H3).
 */
export default async function CounselProjectsPage({
  searchParams,
}: {
  searchParams?: { caseId?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const caseId = searchParams?.caseId?.trim() || null;

  let caseTitle: string | null = null;
  if (caseId) {
    const supabase = createServerSupabase();
    const { data } = await supabase
      .from('cases')
      .select('title')
      .eq('id', caseId)
      .eq('firm_id', ctx.firm.id)
      .maybeSingle();
    caseTitle = (data as { title?: string } | null)?.title ?? null;
  }

  const allProjects = await listFirmProjects(ctx.firm.id);
  const projects = caseId
    ? allProjects.filter((p) => p.caseId === caseId)
    : allProjects;
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  return (
    <div className="space-y-6 animate-fade-up">
      {caseId && (
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2 ring-1 ring-forest-900/10 dark:ring-cream-100/10 bg-surface-2">
          <p className="text-[13px] text-foreground">
            <T>Showing projects for</T>{' '}
            <strong>{caseTitle ?? 'this matter'}</strong>.{' '}
            <T>New projects here attach to it.</T>
          </p>
          <Link href="/counsel/projects" className="text-[12px] underline">
            <T>All projects</T>
          </Link>
        </div>
      )}
      <PageHeader
        align="start"
        eyebrow={<T>Projects</T>}
        title={<T>Projects &amp; folders</T>}
        subtitleClassName="mt-1 max-w-2xl"
        subtitle={
          <T>
            Keep related notes and documents together. Create folders
            inside a project, drop things in, and archive what you want
            out of the way but not gone.
          </T>
        }
        action={<NewProjectForm firmId={ctx.firm.id} caseId={caseId} />}
      />

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title={<T>No projects yet</T>}
          sub={
            <T>
              Create one to start organizing folders, notes, and documents.
            </T>
          }
        />
      ) : (
        <>
          {active.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/counsel/projects/${p.id}`}
                    className="block card p-4 h-full hover:shadow-card-hover transition-all"
                  >
                    <p className="font-semibold text-foreground truncate">
                      {p.name}
                    </p>
                    {p.description && (
                      <p className="text-[12.5px] text-muted mt-1 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                    <p className="text-[11px] text-muted mt-2 font-mono">
                      <T>Updated</T> {new Date(p.updatedAt).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted">
                <T>Archived</T> ({archived.length})
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/counsel/projects/${p.id}`}
                      className="block card p-4 h-full opacity-70 hover:opacity-100 transition-opacity"
                    >
                      <p className="font-semibold text-foreground truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-muted mt-2 font-mono">
                        <T>Archived</T>
                      </p>
                    </Link>
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
