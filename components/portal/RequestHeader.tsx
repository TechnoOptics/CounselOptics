import { StatusPill } from '@/components/counsel/StatusPill';
import { ActionBar, Chip, MonoRef, relativeTime } from '@/components/counsel/patterns';
import Link from 'next/link';

/**
 * The top of a ticket as the employee who filed it sees it: the breadcrumb
 * with its reference, the title, the meta chip row, and a strip of the facts
 * that decide what they do next.
 *
 * A TICKET IS NOT A MATTER, AND THIS IS WHERE THAT STARTS. The strip below
 * is the service-desk shape: a row of labelled readouts, the way a service
 * desk puts Status / Priority / Assignee / SLA in one bordered band above
 * the record. On the legal team's side those are live controls. An employee
 * can change none of them on their own request, so here they are readouts,
 * and the only interactive thing in the row is the one thing they can
 * actually do, which is say something to legal.
 *
 * WHAT USED TO BE HERE, because deleting it was the point of the change: a
 * three-node milestone stepper, Received / In review / Decision. It spent a
 * full bordered strip restating the one value the status pill six pixels
 * above it already carried, and it drew that restatement in the accent, a
 * gold ring and a gold connector, while the family chip beside the title was
 * also accent. That is the accent spent twice in one viewport, which
 * docs/DESIGN.md names as the defect that makes a reader obey neither claim.
 * The accent is now spent once, on "Message legal". The family chip is
 * neutral for the same reason.
 *
 * Presentational, and a component rather than markup on the page, so the
 * header can be rendered without a signed-in employee and a live row.
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
  assigneeName,
  createdAt,
  dueAt,
  decided,
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
  /**
   * Who at legal is holding this, when somebody is. Null reads as nobody
   * has picked it up yet, which is a real and useful state, so it is shown
   * rather than hidden.
   */
  assigneeName?: string | null;
  createdAt: string;
  /** The due timestamp, or null when the request carries no date. */
  dueAt: number | null;
  /** True once legal has decided, which is what stops a due date nagging. */
  decided?: boolean;
  canMessage: boolean;
  conversationId: string;
}) {
  const overdue = dueAt != null && dueAt < Date.now() && !decided;

  // The readouts, in the order an employee reads them: how urgent they said
  // it was, then who has it. A fact with no value is dropped rather than
  // printed as a dash, so the strip never pads itself out with nothing.
  // `userData` marks a value that is somebody's own words rather than app
  // copy, so only those carry data-no-translate. Marking the fallback too
  // would exempt "Not yet assigned" from translation, which is app copy.
  const facts: Array<{ label: string; value: string; userData: boolean }> = [];
  if (priority) facts.push({ label: 'Priority', value: priority, userData: true });
  facts.push({
    label: 'With',
    value: assigneeName || 'Not yet assigned',
    userData: Boolean(assigneeName),
  });

  return (
    <>
      {/* Breadcrumb. The mono element is the request's own reference, which
          unlike a matter this record really does carry. */}
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
          className="break-words text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[26px]"
          data-no-translate
        >
          {title}
        </h1>
        {/* Meta chip row: the one live state as a pill, the fixed facts as
            quiet chips, then plain provenance as the last and quietest
            thing in the row. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <StatusPill dot color={statusColor}>
            {statusLabel}
          </StatusPill>
          {familyTitle && <Chip>{familyTitle}</Chip>}
          {matterType && (
            <Chip>
              <span data-no-translate>{matterType}</span>
            </Chip>
          )}
          <span className="text-[12px] text-muted">
            filed {relativeTime(createdAt)} · <span data-no-translate>{firmName}</span>
          </span>
        </div>
      </header>

      <ActionBar
        trailing={
          <>
            {dueAt != null && (
              <p
                className={`text-[12.5px] ${
                  overdue ? 'font-semibold text-danger-text' : 'text-muted'
                }`}
              >
                {/* relativeTime already says which side of now this is:
                    "in 3d" ahead, "2d ago" behind. So the word "due" plus
                    that reads correctly in both directions, and the colour,
                    not a second adjective, carries the alarm. */}
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
        <dl className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-2">
          {facts.map((f) => (
            <div key={f.label} className="flex items-baseline gap-2">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                {f.label}
              </dt>
              <dd className="text-[13px] text-foreground">
                {f.userData ? (
                  <span data-no-translate>{f.value}</span>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </ActionBar>
    </>
  );
}
