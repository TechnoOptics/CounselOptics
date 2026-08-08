import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { listFirmProjects } from '@/lib/projects-actions';
import { NewProjectForm } from './new-project-form';
import { EmptyState, PageHeader } from '@/components/counsel/ui';
import {
  Chip,
  MonoRef,
  ViewStrip,
  relativeTime,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
import type { Project } from '@/lib/project-types';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Projects · Counsel' };

/**
 * The views a project can genuinely be in. `status` is the column, and
 * it holds exactly these two values, so these are the only subsets.
 */
const VIEWS = {
  active: (p: Project) => p.status === 'active',
  archived: (p: Project) => p.status === 'archived',
  all: () => true,
} as const;

type ViewKey = keyof typeof VIEWS;

function parseView(raw: string | undefined): ViewKey {
  return raw === 'archived' || raw === 'all' ? raw : 'active';
}

/**
 * Firm projects list, on the configuration-list pattern: cards rather
 * than rows, each with a name, a scope chip, a right-aligned mono
 * reference and a description.
 *
 * Cards rather than the table the matter list uses because a project's
 * whole identity is a name and a sentence. There is no priority, no
 * assignee, no status beyond active/archived and no date other than
 * "updated", so a table would have one column worth sorting and four
 * worth nothing.
 *
 * The metrics row the configuration-list pattern puts under the
 * description is deliberately absent: the folder and item counts that
 * would fill it are not in listFirmProjects, and reading them per card
 * would be a query per project. The pattern's DEFAULT badge is absent
 * for the same class of reason - a project has no default.
 *
 * With ?caseId=, the page scopes to one case: it filters the list to
 * that case's projects and new ones created here attach to it (the
 * in-context entry from the case page, Product H3).
 */
export default async function CounselProjectsPage({
  searchParams,
}: {
  searchParams?: { caseId?: string; view?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const caseId = searchParams?.caseId?.trim() || null;
  const view = parseView(searchParams?.view);

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
  // The set the view strip counts over is the set this page can show,
  // so a ?caseId= scope narrows the counts too rather than promising
  // rows the filter has already removed.
  const inScope = caseId
    ? allProjects.filter((p) => p.caseId === caseId)
    : allProjects;
  const projects = inScope.filter(VIEWS[view]);

  const href = (k: string) => {
    const qs = new URLSearchParams();
    if (caseId) qs.set('caseId', caseId);
    if (k !== 'active') qs.set('view', k);
    const s = qs.toString();
    return s ? `/counsel/projects?${s}` : '/counsel/projects';
  };
  const options: ViewOption[] = [
    { key: 'active', label: <T>Active</T>, count: inScope.filter(VIEWS.active).length },
    {
      key: 'archived',
      label: <T>Archived</T>,
      count: inScope.filter(VIEWS.archived).length,
    },
    { key: 'all', label: <T>Everything</T>, count: inScope.length },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      {caseId && (
        <div className="card flex flex-wrap items-center justify-between gap-2 bg-surface-2 p-3">
          <p className="text-[13px] text-foreground">
            <T>Showing projects for</T>{' '}
            <strong data-no-translate>{caseTitle ?? 'this matter'}</strong>.{' '}
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
          <>
            {inScope.length}{' '}
            <T>
              named workspaces of folders holding notes and documents. Create
              folders inside a project, drop things in, and archive what you
              want out of the way but not gone. The view is in the address bar.
            </T>
          </>
        }
        action={<NewProjectForm firmId={ctx.firm.id} caseId={caseId} />}
      />

      {inScope.length === 0 ? (
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
          <ViewStrip
            label="Project views"
            options={options}
            active={view}
            href={href}
          />
          {projects.length === 0 ? (
            <EmptyState
              title={<T>Nothing in this view.</T>}
              sub={<T>Pick another view above.</T>}
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id}>
                  <ProjectCard project={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const archived = p.status === 'archived';
  const updated = relativeTime(p.updatedAt);
  return (
    <Link
      href={`/counsel/projects/${p.id}`}
      className={`card block h-full p-4 transition-all hover:shadow-card-hover ${
        archived ? 'opacity-75 hover:opacity-100' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-foreground" data-no-translate>
          {p.name}
        </p>
        <MonoRef title={p.id}>{shortRef(p.id)}</MonoRef>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {p.caseId ? (
          <Chip tone="accent">
            <T>On a matter</T>
          </Chip>
        ) : (
          <Chip>
            <T>Firm-wide</T>
          </Chip>
        )}
        {archived && (
          <Chip>
            <T>Archived</T>
          </Chip>
        )}
      </div>
      {p.description && (
        <p
          className="mt-2 line-clamp-2 text-[12.5px] text-muted"
          data-no-translate
        >
          {p.description}
        </p>
      )}
      <p
        className="mt-2 text-[11px] text-muted"
        title={new Date(p.updatedAt).toLocaleString()}
      >
        <T>Updated</T> {updated ?? new Date(p.updatedAt).toLocaleDateString()}
      </p>
    </Link>
  );
}
