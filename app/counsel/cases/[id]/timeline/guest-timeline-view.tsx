import Link from 'next/link';
import type { GuestTimelineBundle } from '@/lib/counsel-guest';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Read-only Case Timeline for a case-scoped Counsel GUEST (co-counsel). Guests
 * review the chronology + narrative and export it; they do not run the firm's
 * timeline builder, so this is a calm, static presentation with no edit,
 * comment, or chat controls.
 */
export function GuestTimelineView({
  caseId,
  caseTitle,
  bundle,
}: {
  caseId: string;
  caseTitle: string;
  bundle: GuestTimelineBundle;
}) {
  const { events, narrative } = bundle;
  return (
    <div className="space-y-6">
      <header className="min-w-0">
        <Link
          href={`/counsel/cases/${caseId}`}
          className="text-[12px] text-cream-100/55 hover:underline"
        >
          ← <T>Back to matter</T>
        </Link>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100 mt-1">
          <T>Timeline</T>
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 break-words" data-no-translate>
          {caseTitle}
        </p>
      </header>

      {narrative && (narrative.summary || narrative.narrative || narrative.conclusion) && (
        <section className="card p-5 space-y-3">
          <h2 className="text-[11px] uppercase tracking-[0.12em] font-semibold text-cream-100/55">
            <T>Advottic Review</T>
          </h2>
          {narrative.summary && (
            <p className="text-sm text-cream-100/85 leading-relaxed" data-no-translate>
              {narrative.summary}
            </p>
          )}
          {narrative.narrative && (
            <p
              className="text-sm text-cream-100/75 whitespace-pre-wrap leading-relaxed"
              data-no-translate
            >
              {narrative.narrative}
            </p>
          )}
          {narrative.conclusion && (
            <p className="text-sm text-cream-100/85 leading-relaxed" data-no-translate>
              {narrative.conclusion}
            </p>
          )}
        </section>
      )}

      {events.length === 0 ? (
        <p className="card p-6 text-sm text-cream-100/60 text-center">
          <T>No timeline events have been added to this matter yet.</T>
        </p>
      ) : (
        <ol className="space-y-3">
          {events.map((e) => (
            <li key={e.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-cream-100" data-no-translate>
                  {e.title || '(untitled)'}
                </p>
                <span className="text-[11px] font-mono tabular-nums text-cream-100/55">
                  {e.occurredAt
                    ? new Date(e.occurredAt).toLocaleDateString()
                    : 'Undated'}
                </span>
              </div>
              {e.description && (
                <p
                  className="text-[13px] text-cream-100/75 mt-1 whitespace-pre-wrap leading-relaxed"
                  data-no-translate
                >
                  {e.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-forest-800/50 text-cream-100/85 ring-forest-700/40">
                  {e.kind}
                </span>
                {e.sourceLabel && (
                  <span
                    className="text-[11px] text-cream-100/55"
                    data-no-translate
                  >
                    {e.sourceLabel}
                  </span>
                )}
                {e.attachments > 0 && (
                  <span className="text-[11px] text-cream-100/55">
                    {e.attachments}{' '}
                    <T>{e.attachments === 1 ? 'attachment' : 'attachments'}</T>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
