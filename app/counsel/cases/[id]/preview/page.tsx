import { redirect } from 'next/navigation';
import { PreviewClient } from './preview-client';
import { caseFileIsOpen } from '@/lib/case-file';

/**
 * Advottic-themed PDF preview for a court-packet export. Lets the user
 * proofread the document in the browser (and share, download, or print it
 * from the toolbar) instead of having to download it first. The `src` query
 * param is validated to be one of THIS matter's export routes so the viewer
 * can never be pointed at an arbitrary URL.
 */
export default async function ExportPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { src?: string; label?: string };
}) {
  // The viewer holds no matter data of its own: every byte it shows comes from
  // the export route in `src`, which refuses a closed case file itself. This
  // is here for the person, not for the security boundary - without it they
  // would get a working viewer reporting an error instead of the page they
  // were actually trying to reach.
  if (!(await caseFileIsOpen(params.id))) redirect(`/counsel/cases/${params.id}`);

  const src = (searchParams.src || `/counsel/cases/${params.id}/export`).trim();
  const ok = new RegExp(
    `^/counsel/cases/${params.id}/(export|approach/[0-9a-f-]{36}/export)(\\?[\\w=&,%.-]*)?$`,
    'i',
  ).test(src);
  if (!ok) redirect(`/counsel/cases/${params.id}`);

  const label = (searchParams.label || 'Court packet').slice(0, 80);
  return <PreviewClient caseId={params.id} src={src} label={label} />;
}
