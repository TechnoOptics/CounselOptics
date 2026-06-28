import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { listNotifications } from '@/lib/notifications';
import { PushOptIn } from '@/components/PushOptIn';
import { ShowMore } from '@/components/ShowMore';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Inbox',
  description:
    'Notifications about your cases, meetings, and documents in one place.',
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  case_invited: 'Case invitation',
  case_accepted: 'Case accepted',
  case_exhibit_added: 'New exhibit',
  case_review_complete: 'Review complete',
  case_hearing_reminder: 'Hearing reminder',
  case_status_changed: 'Case updated',
  signing_request_received: 'Signature requested',
  signing_request_completed: 'Document executed',
  signing_request_canceled: 'Request canceled',
  meeting_scheduled: 'Meeting scheduled',
  document_received: 'Document shared',
  system: 'Advottic',
};

const TYPE_TONE: Record<string, string> = {
  signing_request_received:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40',
  signing_request_completed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  signing_request_canceled:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  meeting_scheduled:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  case_invited:
    'bg-violet-50 dark:bg-violet-950/30 text-violet-800 dark:text-violet-200 ring-violet-200 dark:ring-violet-700/40',
  case_accepted:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  case_status_changed:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
  default:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/80 ring-ink-200 dark:ring-forest-700/40',
};

export default async function InboxPage() {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/inbox');

  const notifications = await listNotifications({ limit: 60 });

  const unread = notifications.filter((n) => !n.readAt);
  const read = notifications.filter((n) => n.readAt);

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Inbox</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Your inbox
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
            Notifications about your cases, meetings, and documents in one
            place. Click any item to jump to the source.
          </p>
        </div>
        {/* Browser push opt-in. Surfaces only when push is supported
            and the user hasn't subscribed yet; otherwise renders
            nothing. Closes the gap between in-app + device alerts. */}
        <PushOptIn />
      </header>

      {/* Sub-section quick links */}
      <nav className="flex flex-wrap gap-2 text-[12.5px]">
        <Link
          href="/inbox"
          className="px-3 py-1.5 rounded-md bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 font-semibold"
        >
          All
        </Link>
        <Link
          href="/inbox/documents"
          className="px-3 py-1.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 hover:text-forest-900 dark:hover:text-cream-100"
        >
          Documents
        </Link>
        <Link
          href="/cases"
          className="px-3 py-1.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/80 hover:text-forest-900 dark:hover:text-cream-100"
        >
          Cases
        </Link>
      </nav>

      {notifications.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            Nothing in your inbox yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            When a firm sends you a document, schedules a meeting, or updates
            your case, you&rsquo;ll see it here.
          </p>
        </div>
      ) : (
        <>
          {unread.length > 0 && (
            <Section title={`Unread (${unread.length})`}>
              <ul className="space-y-2">
                {unread.map((n) => (
                  <Item key={n.id} n={n} />
                ))}
              </ul>
            </Section>
          )}
          {read.length > 0 && (
            <Section title="Earlier">
              <ul className="space-y-2 opacity-80">
                <ShowMore initial={3} noun="notifications">
                {read.map((n) => (
                  <Item key={n.id} n={n} />
                ))}
                </ShowMore>
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Item({
  n,
}: {
  n: Awaited<ReturnType<typeof listNotifications>>[number];
}) {
  const tone = TYPE_TONE[n.type] ?? TYPE_TONE.default;
  const label = TYPE_LABEL[n.type] ?? n.type;
  const Inner = (
    <article className="card p-4 hover:shadow-card-hover transition-all flex items-start gap-3">
      <span
        className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
          {n.title}
        </p>
        {n.body && (
          <p className="text-[12.5px] text-ink-600 dark:text-cream-100/75 mt-0.5 leading-snug">
            {n.body}
          </p>
        )}
        <p className="text-[10.5px] text-ink-500 dark:text-cream-100/70 mt-1.5 font-mono tabular-nums">
          {new Date(n.createdAt).toLocaleString()}
        </p>
      </div>
      {!n.readAt && (
        <span
          aria-label="unread"
          className="h-2 w-2 rounded-full bg-amber-500 mt-1.5"
        />
      )}
    </article>
  );
  return (
    <li>{n.link ? <Link href={n.link}>{Inner}</Link> : Inner}</li>
  );
}
