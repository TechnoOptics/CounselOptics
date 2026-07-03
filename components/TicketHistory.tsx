import type { FeedbackRow } from '@/lib/storage';

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Something's broken",
  suggestion: 'Design / feature request',
  praise: 'Praise',
  other: 'Question / other',
};

const STATUS_STYLE: Record<
  string,
  { label: string; className: string }
> = {
  new: {
    label: 'Open',
    className:
      'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  },
  triaged: {
    label: 'In progress',
    className:
      'bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  },
  resolved: {
    label: 'Resolved',
    className:
      'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  },
  wontfix: {
    label: 'Closed',
    className:
      'bg-ink-100 dark:bg-forest-800/50 text-ink-600 dark:text-cream-100/55 ring-ink-200 dark:ring-forest-700/40',
  },
};

/**
 * Read-only list of the tickets the current user has opened with
 * Advottic, newest first, with a live status badge. Shared by the
 * Counsel and Portal help pages.
 */
export function TicketHistory({ tickets }: { tickets: FeedbackRow[] }) {
  if (tickets.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Your tickets
        </h2>
        <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          You haven&rsquo;t opened any tickets yet. Anything you send above
          will show up here with its status.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
        Your tickets
      </h2>
      <ul className="space-y-2">
        {tickets.map((t) => {
          const status = STATUS_STYLE[t.status] ?? STATUS_STYLE.new;
          return (
            <li key={t.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                    {t.subject}
                  </p>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    {CATEGORY_LABEL[t.category] ?? t.category} ·{' '}
                    {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${status.className}`}
                >
                  {status.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
