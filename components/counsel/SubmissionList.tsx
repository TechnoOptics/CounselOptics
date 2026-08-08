import Link from 'next/link';

import type { TemplateSubmission } from '@/lib/template-submission-types';
import { displayTicket } from '@/lib/ticket-numbers';
import { MonoRef, relativeTime } from '@/components/counsel/patterns';
import { SubmissionStatusPill } from '@/components/portal/SubmissionStatusPill';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * One queue of filled-in forms, as rows.
 *
 * Lifted out of the approvals page so the preview harness can render
 * the SHIPPED row with made-up submissions. A page that needs a firm
 * admin's session and a live database cannot be looked at, and a copy
 * of the row in a harness would only ever prove the copy right.
 */

export function SubmissionList({
  items,
  stamp,
}: {
  items: TemplateSubmission[] | undefined;
  /**
   * Which date the row's relative time refers to. A queue row is
   * waiting since it was filed; a history row is settled since it was
   * decided, and a decided row with no decision timestamp says nothing
   * rather than borrowing the other one.
   */
  stamp: 'filed' | 'decided';
}) {
  return (
    <ul className="divide-y divide-edge">
      {(items ?? []).map((s) => (
        <li key={s.id}>
          <Link
            href={`/counsel/forms/approvals/${s.id}`}
            className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[14px] font-medium text-foreground"
                data-no-translate
              >
                {s.templateName}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted">
                {/* The reference the legal team and the employee quote at each
                    other. One helper decides it, so a document filed before
                    numbering existed still has something to be called. */}
                <MonoRef className="text-accent-text">
                  <span data-no-translate>{displayTicket(s)}</span>
                </MonoRef>
                {' · '}
                <span data-no-translate>{s.submitterName ?? s.submitterEmail ?? 'A colleague'}</span>
                {' · '}
                <T>to</T> <span data-no-translate>{s.recipientEmail}</span>
                {s.revision > 1 ? ` · v${s.revision}` : ''}
                {(() => {
                  const when = relativeTime(
                    stamp === 'decided' ? s.decidedAt : s.submittedAt,
                  );
                  return when ? (
                    <>
                      {' · '}
                      {/* Two literals rather than one wrap around the
                          variable: a dynamic wrap has to be reviewed and
                          listed in scripts/test/counsel-i18n-invariants.mjs,
                          and there are only ever two words. */}
                      {stamp === 'decided' ? <T>decided</T> : <T>filed</T>}{' '}
                      <span data-no-translate>{when}</span>
                    </>
                  ) : null;
                })()}
              </span>
            </span>
            <SubmissionStatusPill status={s.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
