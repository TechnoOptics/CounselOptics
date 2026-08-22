import { notFound, redirect } from 'next/navigation';
import { getCase, getLatestReview, listExhibits } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { CasePacket, type PacketData, type PacketExhibit } from '@/components/CasePacket';
import { formatDate } from '@/lib/format';
import { isRealScan } from '@/lib/types';
import { buildChronology, resolveExhibitDate } from '@/lib/exhibit-chronology';
import { assessPacketReadiness, packetReadinessNotices } from '@/lib/packet-readiness';

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
  const [exhibits, review] = await Promise.all([
    listExhibits(c.id),
    getLatestReview(c.id).catch(() => null),
  ]);
  const user = isSupabaseConfigured() ? await getCurrentUser().catch(() => null) : null;

  // What the person is told before they print. Not a block: somebody with a
  // hearing tomorrow still gets their document. Not silence either, which is
  // how a packet came to be built over seventeen exhibits nobody had read.
  const readiness = assessPacketReadiness({ exhibits, review, now: Date.now() });

  // A court chronology is ordered by when the thing happened. The old rule
  // here was `incidentDate || uploadedAt`, which placed an exhibit at the
  // moment its file was uploaded and printed that moment in a column headed
  // "Date". See lib/exhibit-chronology for the ordering and its provenance.
  const chron = buildChronology(exhibits, (e) =>
    resolveExhibitDate({
      incidentDate: e.incidentDate ?? null,
      uploadedAt: e.uploadedAt ?? null,
      scanDates: e.scanData?.dates ?? null,
      scanIsReal: isRealScan(e.scanData),
    }),
  );

  // Exhibit numbering follows the chronology, then the items nobody could
  // date. Every row states where its date came from, so an upload date can
  // never be read as the date of the event.
  const ordered = [...chron.dated, ...chron.undated];
  const packetExhibits: PacketExhibit[] = ordered.map((entry, i) => ({
    n: i + 1,
    label: entry.item.label,
    category: entry.item.category || 'Evidence',
    fileName: entry.item.fileName,
    description: entry.item.description || '',
    source: entry.item.source || '',
    date: entry.date.known ? entry.date.iso : null,
    dateSource: entry.date.sourceShort,
  }));

  const numberOf = new Map(ordered.map((e, i) => [e.item.id, i + 1]));

  const chronology: { date: string; text: string; dateSource?: string }[] = [];
  if (c.createdAt) {
    chronology.push({
      date: formatDate(c.createdAt),
      text: `Case file opened (${c.caseType}).`,
    });
  }
  for (const entry of chron.dated) {
    const e = entry.item;
    chronology.push({
      date: formatDate(entry.date.iso),
      text: `${e.label}${e.description ? ` - ${e.description}` : ''} (Exhibit ${
        numberOf.get(e.id) ?? ''
      }).`,
      dateSource: entry.date.sourceShort,
    });
  }
  if (c.hearingAt && !Number.isNaN(Date.parse(c.hearingAt))) {
    chronology.push({
      date: formatDate(c.hearingAt),
      text: `Hearing${c.hearingLocation ? ` at ${c.hearingLocation}` : ''}.`,
    });
  }
  chronology.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  // Items nobody could date are named on the packet under their own heading
  // rather than being dropped or slotted into the chronology at one end.
  const undatedItems = chron.undated.map((entry) => ({
    label: entry.item.label,
    text: entry.item.description || entry.item.fileName,
    n: numberOf.get(entry.item.id) ?? 0,
  }));

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
    undatedItems,
    notices: packetReadinessNotices(readiness),
  };

  return <CasePacket data={data} />;
}
