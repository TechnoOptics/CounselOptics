import Link from 'next/link';

import { isBulkSelectable, type ApprovalRow } from '@/lib/approval-queue';
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
 *
 * It takes ApprovalRow rather than TemplateSubmission, which is the
 * narrowed shape with no document wording in it. This list is rendered
 * from a client component, so everything it holds is serialized into
 * the page, and the surest way for an unreleased agreement never to
 * reach a browser through here is for the type not to carry it.
 */

export function SubmissionList({
  items,
  stamp,
  selected,
  onSelect,
  selectLabel,
}: {
  items: ApprovalRow[] | undefined;
  /**
   * Which date the row's relative time refers to. A queue row is
   * waiting since it was filed; a history row is settled since it was
   * decided, and a decided row with no decision timestamp says nothing
   * rather than borrowing the other one.
   */
  stamp: 'filed' | 'decided';
  /** Ticked ids. Only meaningful together with `onSelect`. */
  selected?: ReadonlySet<string>;
  /**
   * Pass to put a checkbox on every row a bulk action can reach. The
   * rule for which rows those are is isBulkSelectable, shared with the
   * bulk bar and its confirmation, so a reviewer cannot tick something
   * the action would then refuse.
   */
  onSelect?: (id: string, on: boolean) => void;
  /** Accessible name for a row's checkbox, already translated. */
  selectLabel?: string;
}) {
  return (
    <ul className="divide-y divide-edge">
      {(items ?? []).map((s) => {
        const selectable = onSelect != null && isBulkSelectable(s);
        return (
          <li key={s.id} className="flex items-center">
            {/* The gutter is present on every row once the list is
                selectable, empty on the rows that are not. A view that mixes
                the two otherwise has a ragged left edge, with half the names
                starting a checkbox further in than the rest. */}
            {onSelect != null && (
              <span className="w-8 shrink-0 pl-4">
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selected?.has(s.id) ?? false}
                    onChange={(e) => onSelect(s.id, e.target.checked)}
                    aria-label={selectLabel}
                    className="h-3.5 w-3.5 align-middle accent-[var(--accent)]"
                  />
                )}
              </span>
            )}
            <Link
              // The row carries its own link, because the two directions live
              // in different tables and open different screens. Building it
              // here from the id would have sent every inbound authorisation
              // to a submission page that has no such record.
              href={s.href}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[14px] font-medium text-foreground"
                  data-no-translate
                >
                  {s.templateName}
                </span>
                <span
                  className="mt-0.5 block truncate text-[12px] text-muted"
                  suppressHydrationWarning
                >
                  {/* The reference the legal team and the employee quote at each
                      other. One helper decides it, so a document filed before
                      numbering existed still has something to be called. */}
                  <MonoRef className="text-accent-text">
                    <span data-no-translate>{displayTicket(s)}</span>
                  </MonoRef>
                  {' · '}
                  <span data-no-translate>{s.submitterName ?? s.submitterEmail ?? 'A colleague'}</span>
                  {' · '}
                  {/* THE FRAMING, AND IT IS THE ONLY THING ON THIS ROW THAT
                      TURNS ON DIRECTION. "to" over the name of the party who
                      SENT us a document would tell a reviewer the firm is
                      addressing somebody it is in fact answering. Two
                      literals rather than one wrap around a variable, for the
                      reason the filed/decided pair below is two: a dynamic
                      wrap has to be reviewed and listed in
                      scripts/test/counsel-i18n-invariants.mjs. */}
                  {s.direction === 'inbound' ? <T>from</T> : <T>to</T>}{' '}
                  <span data-no-translate>{s.recipientEmail}</span>
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
        );
      })}
    </ul>
  );
}
