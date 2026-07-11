import Link from 'next/link';
import type { GuestTimelineBundle } from '@/lib/counsel-guest';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Read-only Evidence list for a case-scoped Counsel GUEST (co-counsel). Guests
 * review what has been gathered and export the full evidentiary record; they do
 * not run the firm's intake/analysis tools. To avoid handing an outside party
 * raw storage access, this lists the evidence items and their context but
 * routes file-level review through the matter's export (embedded exhibits).
 */
export function GuestEvidenceView({
  caseId,
  caseTitle,
  bundle,
}: {
  caseId: string;
  caseTitle: string;
  bundle: GuestTimelineBundle;
}) {
  const items = bundle.events.filter((e) => e.attachments > 0);
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
          <T>Evidence</T>
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 break-words" data-no-translate>
          {caseTitle}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/counsel/cases/${caseId}/export`}
          className="btn-primary text-sm"
        >
          <T>Export evidentiary record</T>
        </Link>
        <Link
          href={`/counsel/cases/${caseId}/timeline`}
          className="text-sm text-cream-100/70 hover:underline"
        >
          <T>View full timeline</T>
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="card p-6 text-sm text-cream-100/60 text-center">
          <T>No evidence has been added to this matter yet.</T>
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
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
              <div className="flex flex-wrap gap-2 mt-2 items-center">
                <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 bg-forest-800/50 text-cream-100/85 ring-forest-700/40">
                  {e.kind}
                </span>
                <span className="text-[11px] text-cream-100/55">
                  {e.attachments}{' '}
                  <T>{e.attachments === 1 ? 'file' : 'files'}</T>
                </span>
                {e.sourceLabel && (
                  <span className="text-[11px] text-cream-100/55" data-no-translate>
                    {e.sourceLabel}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
