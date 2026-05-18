import type { Metadata } from 'next';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { DeadlineRadar, type RadarItem } from '@/components/DeadlineRadar';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Deadline Radar',
  description:
    'Every hearing and deadline across all your cases, sorted by urgency with live countdowns.',
};

export default async function DeadlinesPage() {
  if (storageUnavailable()) {
    return (
      <div className="max-w-3xl mx-auto card p-8 text-sm text-ink-600">
        Connect storage to use the Deadline Radar.
      </div>
    );
  }

  let items: RadarItem[] = [];
  try {
    const cases = await listCases();
    items = cases
      .filter((c) => c.hearingAt)
      .map((c) => ({
        caseId: c.id,
        caseTitle: c.title,
        at: c.hearingAt as string,
        label: 'Hearing',
        location: c.hearingLocation ?? null,
      }));
  } catch {
    items = [];
  }

  return (
    <div className="max-w-3xl mx-auto">
      <DeadlineRadar items={items} />
    </div>
  );
}
