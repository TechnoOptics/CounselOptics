import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { WarRoom, type WarItem } from '@/components/WarRoom';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Action Center',
  description:
    'Your legal command center: every case, every deadline, and the single best next move for each - plus Mock Trial practice, the Document Decoder, and Safe Witness, all in one place.',
};

/**
 * Action Center - the consumer command center.
 *
 * This used to be a hub that linked out to a separate "War Room". Those
 * two surfaces had the same job, so they're now one: the Action Center
 * IS the cockpit. The War Room route redirects here, and the cockpit
 * folds in the time-sensitive tools - Mock Trial (argue your case),
 * Decode a Document, Deadline Radar, and Safe Witness - so nothing has
 * to be hunted for from a second menu.
 */
export default async function ActionCenterPage() {
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) redirect('/sign-in?next=/action-center');
  }

  if (storageUnavailable()) {
    return (
      <div className="max-w-3xl mx-auto card p-8 text-sm text-ink-600">
        Connect storage to use the Action Center.
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
