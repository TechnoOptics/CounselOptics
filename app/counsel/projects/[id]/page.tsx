import { notFound, redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import {
  getProjectDetail,
  getLinkedCaseAction,
  listFirmCaseOptions,
} from '@/lib/projects-actions';
import { ProjectWorkspace } from './project-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }) {
  const ctx = await getActiveFirmContext();
  if (!ctx) return { title: 'Project · Counsel' };
  const detail = await getProjectDetail(ctx.firm.id, params.id);
  return { title: `${detail?.project.name ?? 'Project'} · Counsel` };
}

export default async function CounselProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const detail = await getProjectDetail(ctx.firm.id, params.id);
  if (!detail) notFound();

  const [linkedCase, caseOptions] = await Promise.all([
    detail.project.caseId
      ? getLinkedCaseAction(ctx.firm.id, detail.project.caseId)
      : Promise.resolve(null),
    listFirmCaseOptions(ctx.firm.id),
  ]);

  return (
    <ProjectWorkspace
      firmId={ctx.firm.id}
      project={detail.project}
      folders={detail.folders}
      items={detail.items}
      linkedCase={linkedCase}
      caseOptions={caseOptions}
    />
  );
}
