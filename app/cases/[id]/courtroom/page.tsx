import { notFound, redirect } from 'next/navigation';
import { getCase, listExhibits } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { CourtroomMode } from '@/components/CourtroomMode';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Courtroom Mode', robots: { index: false, follow: false } };
}

export default async function CourtroomPage({
  params,
}: {
  params: { id: string };
}) {
  if (storageUnavailable()) redirect('/cases');
  const c = await getCase(params.id);
  if (!c) notFound();
  const exhibits = await listExhibits(c.id);

  return (
    <CourtroomMode
      caseId={c.id}
      caseTitle={c.title}
      hearingAt={c.hearingAt ?? null}
      hearingLocation={c.hearingLocation ?? null}
      seedPoints={[c.hearingNotes, c.description].filter(Boolean).join('\n')}
      exhibits={exhibits.map((e) => ({
        id: e.id,
        label: e.label,
        fileName: e.fileName,
        category: e.category ?? null,
      }))}
    />
  );
}
