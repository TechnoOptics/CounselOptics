import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { listFirmProjects } from '@/lib/projects-actions';
import { NewProjectForm } from './new-project-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects · Counsel' };

/**
 * Firm projects list. A project is a named workspace of folders holding
 * notes and documents - anything the firm wants to keep together and
 * retrieve later (an onboarding, a policy review, a research binder).
 */
export default async function CounselProjectsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const projects = await listFirmProjects(ctx.firm.id);
  const active = projects.filter((p) => p.status === 'active');
  const archived = projects.filter((p) => p.status === 'archived');

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Projects</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Projects &amp; folders
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Keep related notes and documents together. Create folders
            inside a project, drop things in, and archive what you want
            out of the way but not gone.
          </p>
        </div>
        <NewProjectForm firmId={ctx.firm.id} />
      </header>

      {active.length === 0 && archived.length === 0 ? (
        <p className="card p-6 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          No projects yet. Create one to start organizing folders, notes,
          and documents.
        </p>
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
                    <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                      {p.name}
                    </p>
                    {p.description && (
                      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 mt-1 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                    <p className="text-[11px] text-ink-400 dark:text-cream-100/40 mt-2 font-mono">
                      Updated {new Date(p.updatedAt).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-500 dark:text-cream-100/55">
                Archived ({archived.length})
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/counsel/projects/${p.id}`}
                      className="block card p-4 h-full opacity-70 hover:opacity-100 transition-opacity"
                    >
                      <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                        {p.name}
                      </p>
                      <p className="text-[11px] text-ink-400 dark:text-cream-100/40 mt-2 font-mono">
                        Archived
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
