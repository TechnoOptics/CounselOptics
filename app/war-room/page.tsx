import type { Metadata } from 'next';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { WarRoom, type WarItem } from '@/components/WarRoom';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'War Room',
  description:
    'Every case, every deadline, and the single best next move for each - one command center.',
};

export default async function WarRoomPage() {
  if (storageUnavailable()) {
    return (
      <div className="max-w-3xl mx-auto card p-8 text-sm text-ink-600">
        Connect storage to use the War Room.
      </div>
    );
  }

  let items: WarItem[] = [];
  try {
    const cases = await listCases();
    items = cases.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      posture: c.posture,
      caseType: c.caseType,
      hearingAt: c.hearingAt ?? null,
      updatedAt: c.updatedAt,
    }));
  } catch {
    items = [];
  }

  return (
    <div className="max-w-4xl mx-auto">
      <WarRoom items={items} />
    </div>
  );
}
