import { adminListFeedback } from '@/lib/storage';
import { FeedbackRow } from './feedback-row';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const allowedFilters = ['all', 'new', 'triaged', 'resolved', 'wontfix'] as const;
  const statusParam = (allowedFilters as readonly string[]).includes(
    searchParams?.status ?? '',
  )
    ? (searchParams?.status as (typeof allowedFilters)[number])
    : 'new';

  const feedback = await adminListFeedback({ status: statusParam });

  const counts = await getStatusCounts();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          {feedback.length} item{feedback.length === 1 ? '' : 's'}
          {statusParam !== 'all' && ` · filtered to "${statusParam}"`}
        </p>
        <nav className="flex flex-wrap items-center gap-1.5 text-xs">
          {allowedFilters.map((s) => (
            <a
              key={s}
              href={`?status=${s}`}
              className={`px-3 py-1.5 rounded-md transition-colors capitalize ${
                statusParam === s
                  ? 'bg-forest-900 text-cream-100 dark:bg-gold-metal dark:text-forest-950 font-semibold'
                  : 'text-ink-700 dark:text-cream-100/70 hover:bg-ink-100 dark:hover:bg-forest-800/60'
              }`}
            >
              {s === 'wontfix' ? "Won't fix" : s}{' '}
              <span className="text-[10px] opacity-70 tabular-nums">
                ({counts[s] ?? 0})
              </span>
            </a>
          ))}
        </nav>
      </div>

      {feedback.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-600 dark:text-cream-100/70">
          No feedback in this view yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {feedback.map((f) => (
            <FeedbackRow key={f.id} item={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

async function getStatusCounts(): Promise<Record<string, number>> {
  const all = await adminListFeedback({ status: 'all' });
  const counts: Record<string, number> = { all: all.length };
  for (const f of all) {
    counts[f.status] = (counts[f.status] ?? 0) + 1;
  }
  return counts;
}
