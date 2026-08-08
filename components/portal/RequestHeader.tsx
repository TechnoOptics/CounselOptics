import Link from 'next/link';

import { StatusPill } from '@/components/counsel/StatusPill';
import {
  ActionBar,
  Chip,
  MonoRef,
  relativeTime,
} from '@/components/counsel/patterns';

/**
 * The top of a request as the employee who filed it sees it: the
 * breadcrumb with its reference, the title, the meta chip row, and the
 * action bar.
 *
 * THE ACTION BAR DOES NOT PRETEND. On the legal team's side that bar
 * carries the controls that change the record: status, assignee, a
 * timer. An employee can change none of those on their own request, so
 * this one carries the two facts that decide what they do next, where
 * it has got to and when it is due, and the single thing they can
 * actually do, which is say something to legal. Below the two-pane
 * breakpoint the conversation stacks under everything else, and the
 * link is the only quick way back to it.
 *
 * Presentational, and a component rather than markup on the page so the
 * preview harness renders the shipped header with made-up values. The
 * page needs a signed-in employee and a live row; this does not.
 */
export function PortalRequestHeader({
  reference,
  requestId,
  title,
  firmName,
  statusLabel,
  statusColor,
  familyTitle,
  matterType,
  priority,
  confidentiality,
  createdAt,
  dueAt,
  steps,
  currentStep,
  decidedLabel,
  canMessage,
  conversationId,
}: {
  /** REQ-XXXXXX, or a partner ticket's own external id. */
  reference: string;
  /** The full uuid, shown on hover of the reference. */
  requestId: string;
  title: string;
  firmName: string;
  statusLabel: string;
  statusColor: string;
  /** Which home tile this request came from, when it came from one. */
  familyTitle?: string | null;
  matterType?: string | null;
  priority?: string;
  confidentiality?: string;
  createdAt: string;
  /** The due timestamp, or null when the request carries no date. */
  dueAt: number | null;
  steps: readonly string[];
  currentStep: number;
  /**
   * The word to show in place of the last step once it has been
   * reached, because "Decision" is the step and "Accepted" or "Closed"
   * is what the decision was. Null while the request is still moving.
   */
  decidedLabel?: string | null;
  canMessage: boolean;
  conversationId: string;
}) {
  const overdue = dueAt != null && dueAt < Date.now() && !decidedLabel;
  return (
    <>
      {/* Breadcrumb. The mono element is the request's own reference,
          which unlike a matter this record really does carry. */}
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/portal/requests"
          className="text-muted transition-colors hover:text-foreground"
        >
          My requests
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <MonoRef title={requestId}>{reference}</MonoRef>
      </nav>

      <header className="min-w-0">
        <h1
          className="break-words text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-3xl"
          data-no-translate
        >
          {title}
        </h1>
        {/* Meta chip row: the one live state as a pill, the fixed facts
            as quiet chips, then plain provenance underneath. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <StatusPill dot color={statusColor}>
            {statusLabel}
          </StatusPill>
          {familyTitle && <Chip tone="accent">{familyTitle}</Chip>}
          {matterType && (
            <Chip>
              <span data-no-translate>{matterType}</span>
            </Chip>
          )}
          {priority && (
            <Chip>
              <span data-no-translate>{priority} priority</span>
            </Chip>
          )}
          {confidentiality && (
            <Chip>
              <span data-no-translate>{confidentiality}</span>
            </Chip>
          )}
        </div>
        <p className="mt-2 text-[12px] text-muted">
          filed {relativeTime(createdAt)}
          {' · '}
          <span data-no-translate>{firmName}</span>
        </p>
      </header>

      <ActionBar
        trailing={
          <>
            {dueAt != null && (
              <p
                className={`text-[12.5px] ${overdue ? 'font-semibold text-danger-text' : 'text-muted'}`}
              >
                {/* relativeTime already says which side of now this is:
                    "in 3d" ahead, "2d ago" behind. So the word "due"
                    plus that reads correctly in both directions and the
                    colour, not a second adjective, carries the alarm. */}
                due {relativeTime(new Date(dueAt).toISOString())}
              </p>
            )}
            {canMessage && (
              <a
                href={`#${conversationId}`}
                className="btn border border-edge text-[12.5px] text-accent-text"
              >
                Message legal
              </a>
            )}
          </>
        }
      >
        <ol className="flex min-w-0 flex-1 items-center gap-2">
          {steps.map((s, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const last = i === steps.length - 1;
            return (
              <li key={s} className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 flex-col items-center">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                      done || active ? 'text-accent-text' : 'text-muted ring-1 ring-edge'
                    }`}
                    style={
                      done || active
                        ? {
                            background:
                              'color-mix(in oklab, var(--accent) 16%, transparent)',
                            boxShadow:
                              'inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, transparent)',
                          }
                        : undefined
                    }
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span
                    className={`mt-1 text-center text-[10.5px] ${
                      active ? 'font-semibold text-foreground' : 'text-muted'
                    }`}
                  >
                    {last && decidedLabel ? decidedLabel : s}
                  </span>
                </div>
                {!last && (
                  <span
                    aria-hidden
                    className={`h-px flex-1 ${
                      i < currentStep ? 'bg-accent' : 'bg-edge'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </ActionBar>
    </>
  );
}
