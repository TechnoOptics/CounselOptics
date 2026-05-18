import { notFound, redirect } from 'next/navigation';
import { getCase, listExhibits } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { CasePacket, type PacketData, type PacketExhibit } from '@/components/CasePacket';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Case Packet', robots: { index: false, follow: false } };
}

export default async function PacketPage({
  params,
}: {
  params: { id: string };
}) {
  if (storageUnavailable()) redirect('/cases');
  const c = await getCase(params.id);
  if (!c) notFound();
  const exhibits = await listExhibits(c.id);
  const user = isSupabaseConfigured() ? await getCurrentUser().catch(() => null) : null;

  const sorted = [...exhibits].sort((a, b) => {
    const ax = Date.parse(a.incidentDate || a.uploadedAt);
    const bx = Date.parse(b.incidentDate || b.uploadedAt);
    return ax - bx;
  });

  const packetExhibits: PacketExhibit[] = sorted.map((e, i) => ({
    n: i + 1,
    label: e.label,
    category: e.category || 'Evidence',
    fileName: e.fileName,
    description: e.description || '',
    source: e.source || '',
    date: e.incidentDate || e.uploadedAt || null,
  }));

  const chronology: { date: string; text: string }[] = [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  if (c.createdAt)
    chronology.push({
      date: fmt(c.createdAt),
      text: `Case file opened (${c.caseType}).`,
    });
  for (const e of sorted) {
    const when = e.incidentDate || e.uploadedAt;
    if (!when || Number.isNaN(Date.parse(when))) continue;
    chronology.push({
      date: fmt(when),
      text: `${e.label}${e.description ? ` - ${e.description}` : ''} (Exhibit ${
        packetExhibits.find((x) => x.label === e.label)?.n ?? ''
      })${e.incidentDate ? '' : ' (on or about - upload date)'}.`,
    });
  }
  if (c.hearingAt && !Number.isNaN(Date.parse(c.hearingAt)))
    chronology.push({
      date: fmt(c.hearingAt),
      text: `Hearing${c.hearingLocation ? ` at ${c.hearingLocation}` : ''}.`,
    });
  chronology.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const data: PacketData = {
    caseId: c.id,
    title: c.title,
    subjectName: c.subjectName,
    subjectType: c.subjectType,
    caseType: c.caseType,
    posture: c.posture,
    jurisdiction:
      [c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country]
        .filter(Boolean)
        .join(', ') || 'Not specified',
    description: c.description || '',
    hearingAt: c.hearingAt ?? null,
    hearingLocation: c.hearingLocation ?? null,
    preparedFor: user?.email || 'Review and filing',
    openedAt: c.createdAt,
    exhibits: packetExhibits,
    chronology,
  };

  return <CasePacket data={data} />;
}
