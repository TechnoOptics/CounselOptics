import Link from 'next/link';
import { listMyFeedback } from '@/lib/storage';
import { FeedbackForm } from './feedback-form';
// Rendered from the counsel route too, which runs under a LocaleProvider.
// <T> is a client component, so a server component can render it.
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The feedback form, the submitter's own history, and the contact
 * footer. Rendered from two routes - /feedback in the consumer app and
 * /counsel/feedback inside the firm workspace - so it holds no page
 * header and no auth redirect. Each page supplies those.
 */
export async function FeedbackPanel() {
  const mine = await listMyFeedback().catch(() => []);

  return (
    <>
      <FeedbackForm />

      {mine.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wider uppercase text-forest-700 dark:text-gold-300">
            <T>Your previous feedback</T>
          </h2>
          <ul className="space-y-2">
            {mine.map((f) => (
              <li
                key={f.id}
                className="card p-4 flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="badge bg-forest-900 text-cream-200 dark:bg-gold-metal dark:text-forest-950 capitalize">
                      {f.category}
                    </span>
                    <span
                      className={`badge ${statusBadge(f.status)}`}
                      aria-label={`Status: ${f.status}`}
                    >
                      {humanStatus(f.status)}
                    </span>
                    <span className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono">
                      {new Date(f.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <p
                    className="font-semibold text-ink-950 dark:text-cream-100 truncate"
                    data-no-translate
                  >
                    {f.subject}
                  </p>
                  <p
                    className="text-sm text-ink-600 dark:text-cream-100/70 mt-0.5 line-clamp-2 whitespace-pre-wrap"
                    data-no-translate
                  >
                    {f.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="text-xs text-ink-500 dark:text-cream-100/55">
        <T>For urgent contact:</T>{' '}
        <a
          href="mailto:contact@advottic.com"
          className="underline hover:text-forest-900 dark:hover:text-cream-100"
        >
          contact@advottic.com
        </a>{' '}
        ·{' '}
        <Link href="/security" className="underline hover:text-forest-900 dark:hover:text-cream-100">
          <T>Trust &amp; Security</T>
        </Link>
      </div>
    </>
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case 'new':
      return 'bg-cream-100 text-forest-900 border border-gold-300 dark:bg-forest-800 dark:text-cream-100 dark:border-gold-500/40';
    case 'triaged':
      return 'bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-700/40';
    case 'resolved':
      return 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/40';
    case 'wontfix':
      return 'bg-ink-100 text-ink-700 border border-ink-200 dark:bg-forest-800 dark:text-cream-100/70';
    default:
      return 'bg-ink-100 text-ink-700';
  }
}
function humanStatus(s: string): string {
  if (s === 'wontfix') return "Won't fix";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
