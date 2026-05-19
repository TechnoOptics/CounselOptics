import Link from 'next/link';
import type { CounselTileId } from '@/lib/counsel-dashboard';

/**
 * Read-only data envelope the dashboard page hydrates and passes to
 * each enabled tile. Keeping it in one shape (rather than per-tile
 * fetchers) means we fetch each underlying table once even if two
 * tiles consume the same data - the dashboard already pulled most
 * of these for its old fixed grid, so it's cheap.
 *
 * Tiles render purely from this envelope - no I/O inside the tile
 * component. That keeps them server-rendered, predictable, and easy
 * to add to.
 */
export type DashboardTileData = {
  firmId: string;
  firmName: string;
  accent: string;
  userId: string;
  userDisplayName: string;
  isAdmin: boolean;
  counts: {
    casesOpen: number;
    casesTotal: number;
    clients: number;
    clientsActive: number;
    members: number;
    invitations: number;
    documents: number;
    signingPending: number;
  };
  intake: {
    needsAttention: number;
    inReview: number;
    accepted: number;
    closed: number;
    /** New (last 24h) requests not yet triaged. */
    newToday: number;
    /** Most recent unread internal items (for action center). */
    recentNew: Array<{
      id: string;
      clientName: string;
      matterType: string | null;
      createdAt: string;
      isInternal: boolean;
    }>;
  };
  assigned: {
    cases: Array<{ id: string; title: string; status: string }>;
    clients: Array<{ id: string; displayName: string; status: string }>;
  };
  signing: {
    /** Signature requests created by the current user, still pending. */
    mineAwaiting: Array<{
      id: string;
      documentTitle: string | null;
      createdAt: string;
    }>;
  };
  meetings: Array<{
    id: string;
    topic: string;
    provider: 'microsoft' | 'zoom' | string;
    startAt: string;
    joinUrl: string | null;
  }>;
  deadlines: Array<{
    id: string;
    title: string;
    kind: string;
    dueAt: string;
  }>;
  recentUploads: Array<{
    id: string;
    title: string;
    uploadedAt: string;
  }>;
};

export function DashboardTileRenderer({
  id,
  data,
}: {
  id: CounselTileId;
  data: DashboardTileData;
}) {
  switch (id) {
    case 'action-center':
      return <ActionCenterTile data={data} />;
    case 'assigned-to-me':
      return <AssignedToMeTile data={data} />;
    case 'quick-actions':
      return <QuickActionsTile data={data} />;
    case 'meetings-upcoming':
      return <MeetingsTile data={data} />;
    case 'upcoming-hearings':
      return <DeadlinesTile data={data} />;
    case 'intake-pipeline':
      return <IntakePipelineTile data={data} />;
    case 'cases-overview':
      return <SimpleCountTile
        href="/counsel/cases"
        eyebrow="Cases"
        headline={`${data.counts.casesOpen} open`}
        metric={`${data.counts.casesTotal} total`}
        body="Cases shared with the firm. Open + active matters at the top."
        accent={data.accent}
      />;
    case 'clients-overview':
      return <SimpleCountTile
        href="/counsel/clients"
        eyebrow="Clients"
        headline={String(data.counts.clients)}
        metric={`${data.counts.clientsActive} active`}
        body="Invite a client and they stay linked to your firm."
        accent={data.accent}
      />;
    case 'team-overview':
      return <SimpleCountTile
        href="/counsel/team"
        eyebrow="Team"
        headline={`${data.counts.members} member${data.counts.members === 1 ? '' : 's'}`}
        metric={
          data.counts.invitations > 0
            ? `${data.counts.invitations} pending`
            : 'No pending invites'
        }
        body="Admins, attorneys, paralegals, staff."
        accent={data.accent}
      />;
    case 'documents-overview':
      return <SimpleCountTile
        href="/counsel/documents"
        eyebrow="Documents"
        headline={String(data.counts.documents)}
        metric="Versioned"
        body="Contracts, motions, evidence packets."
        accent={data.accent}
      />;
    case 'signing-overview':
      return <SimpleCountTile
        href="/counsel/signing"
        eyebrow="Signing"
        headline={String(data.counts.signingPending)}
        metric="awaiting signature"
        body="UETA-aligned, tamper-evident audit chain."
        accent={data.accent}
      />;
    case 'recent-activity':
      return <RecentActivityTile data={data} />;
    case 'recent-uploads':
      return <RecentUploadsTile data={data} />;
    case 'team-chat':
      return <SimpleCountTile
        href="/counsel/chat"
        eyebrow="Team chat"
        headline="Channels + DMs"
        metric="Realtime"
        body="Channels for firm-wide topics, group DMs per matter, 1:1s."
        accent={data.accent}
      />;
    case 'firm-settings':
      if (!data.isAdmin) return null;
      return <SimpleCountTile
        href="/counsel/settings"
        eyebrow="Firm settings"
        headline="Brand + scope"
        metric="Owner / admin"
        body="Logo, accent color, jurisdictions, practice areas."
        accent={data.accent}
      />;
    default:
      return null;
  }
}

/* ----- atomic tile presentational components ----- */

function TileFrame({
  eyebrow,
  title,
  href,
  span,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  href?: string;
  span?: 1 | 2 | 4;
  accent: string;
  children: React.ReactNode;
}) {
  const colSpan =
    span === 4
      ? 'sm:col-span-2 lg:col-span-4'
      : span === 2
        ? 'sm:col-span-2 lg:col-span-2'
        : '';
  const inner = (
    <div className="card p-5 h-full hover:shadow-card-hover transition-all">
      <div className="flex items-center justify-between mb-1">
        <p
          className="text-[10px] uppercase tracking-[0.22em] font-semibold"
          style={{ color: accent }}
        >
          {eyebrow}
        </p>
        {href ? (
          <span className="text-[11px] text-cream-100/45">View</span>
        ) : null}
      </div>
      <p className="font-display text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </p>
      {children}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className={`group block ${colSpan}`}>
        {inner}
      </Link>
    );
  }
  return <div className={colSpan}>{inner}</div>;
}

function SimpleCountTile({
  href,
  eyebrow,
  headline,
  metric,
  body,
  accent,
}: {
  href: string;
  eyebrow: string;
  headline: string;
  metric: string;
  body: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all group block h-full"
    >
      <p
        className="text-[10px] uppercase tracking-[0.22em] font-semibold"
        style={{ color: accent }}
      >
        {eyebrow}
      </p>
      <p className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
        {headline}
      </p>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono uppercase tracking-wider">
        {metric}
      </p>
      <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2.5 leading-relaxed">
        {body}
      </p>
    </Link>
  );
}

/* ----- Action center: only-renders-when-there's-something tile ----- */

function ActionCenterTile({ data }: { data: DashboardTileData }) {
  const items: Array<{
    label: string;
    href: string;
    detail: string;
    tone: 'warn' | 'ok';
  }> = [];
  if (data.intake.needsAttention > 0) {
    items.push({
      label: `${data.intake.needsAttention} request${data.intake.needsAttention === 1 ? '' : 's'} need attention`,
      href: '/counsel/inbox',
      detail: 'Untriaged matters waiting on legal.',
      tone: 'warn',
    });
  }
  if (data.intake.newToday > 0) {
    items.push({
      label: `${data.intake.newToday} new in the last 24h`,
      href: '/counsel/inbox',
      detail: 'Hot off the press - check before the day fills up.',
      tone: 'warn',
    });
  }
  if (data.signing.mineAwaiting.length > 0) {
    items.push({
      label: `${data.signing.mineAwaiting.length} signing request${data.signing.mineAwaiting.length === 1 ? '' : 's'} you sent are still out`,
      href: '/counsel/signing',
      detail: 'Send a reminder or escalate if the deadline is close.',
      tone: 'warn',
    });
  }
  if (data.counts.invitations > 0 && data.isAdmin) {
    items.push({
      label: `${data.counts.invitations} pending team invitation${data.counts.invitations === 1 ? '' : 's'}`,
      href: '/counsel/team',
      detail: 'Members invited but not yet accepted.',
      tone: 'warn',
    });
  }

  return (
    <TileFrame
      eyebrow="Action center"
      title={
        items.length === 0
          ? 'All clear'
          : `${items.length} thing${items.length === 1 ? '' : 's'} need a human`
      }
      accent={data.accent}
      span={4}
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Nothing waiting on you right now. New requests, signing
          chase-ups, and pending invitations will surface here.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((it) => (
            <li key={it.label}>
              <Link
                href={it.href}
                className="flex items-start gap-3 rounded-lg p-2.5 ring-1 ring-amber-400/30 bg-amber-400/10 hover:bg-amber-400/15 transition-colors"
              >
                <span className="mt-0.5 h-2 w-2 flex-none rounded-full bg-amber-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-cream-100">
                    {it.label}
                  </span>
                  <span className="block text-[11.5px] text-cream-100/65 leading-relaxed">
                    {it.detail}
                  </span>
                </span>
                <span className="text-[11px] text-cream-100/55 mt-1">
                  Open
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/* ----- Assigned to me ----- */

function AssignedToMeTile({ data }: { data: DashboardTileData }) {
  const clientCount = data.assigned.clients.length;
  const caseCount = data.assigned.cases.length;
  const total = clientCount + caseCount;
  return (
    <TileFrame
      eyebrow="Assigned to me"
      title={
        total === 0
          ? 'Nothing assigned yet'
          : `${total} thing${total === 1 ? '' : 's'} in your name`
      }
      accent={data.accent}
      span={4}
    >
      {total === 0 ? (
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          When you're set as the primary attorney on a client or case,
          it'll show up here for quick access.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-100/45 mb-1">
              Your clients ({clientCount})
            </p>
            {clientCount === 0 ? (
              <p className="text-[12px] text-cream-100/55">
                No primary-attorney clients.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.assigned.clients.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/counsel/clients/${c.id}`}
                      className="block rounded px-2 py-1 text-[13px] text-cream-100 hover:bg-cream-100/5"
                    >
                      {c.displayName}
                      <span className="ml-2 text-[10.5px] uppercase tracking-wider text-cream-100/45">
                        {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
                {clientCount > 5 && (
                  <li className="text-[11px] text-cream-100/45 px-2 pt-0.5">
                    +{clientCount - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-100/45 mb-1">
              Your cases ({caseCount})
            </p>
            {caseCount === 0 ? (
              <p className="text-[12px] text-cream-100/55">
                No cases tied to your clients yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.assigned.cases.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/case/${c.id}`}
                      className="block rounded px-2 py-1 text-[13px] text-cream-100 hover:bg-cream-100/5"
                    >
                      {c.title}
                      <span className="ml-2 text-[10.5px] uppercase tracking-wider text-cream-100/45">
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </Link>
                  </li>
                ))}
                {caseCount > 5 && (
                  <li className="text-[11px] text-cream-100/45 px-2 pt-0.5">
                    +{caseCount - 5} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </TileFrame>
  );
}

/* ----- Quick actions ----- */

function QuickActionsTile({ data }: { data: DashboardTileData }) {
  const actions = [
    { href: '/counsel/cases/new', label: 'New case' },
    { href: '/counsel/intake', label: 'New intake' },
    { href: '/counsel/meetings', label: 'Schedule meeting' },
    { href: '/counsel/documents', label: 'Upload document' },
  ];
  return (
    <TileFrame
      eyebrow="Quick actions"
      title="Start something"
      accent={data.accent}
      span={2}
    >
      <div className="mt-3 grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-md ring-1 ring-forest-700/40 bg-forest-900/40 hover:bg-forest-800/60 px-3 py-2 text-[12.5px] text-cream-100/85 hover:text-cream-100 transition-colors text-center"
          >
            {a.label}
          </Link>
        ))}
      </div>
    </TileFrame>
  );
}

/* ----- Meetings upcoming ----- */

function MeetingsTile({ data }: { data: DashboardTileData }) {
  return (
    <TileFrame
      eyebrow="Upcoming meetings"
      title={
        data.meetings.length === 0
          ? 'Nothing on the calendar'
          : `Next ${Math.min(data.meetings.length, 5)}`
      }
      href="/counsel/meetings"
      accent={data.accent}
      span={2}
    >
      {data.meetings.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          Connect Microsoft 365 or Zoom from Meetings to see your
          schedule here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.meetings.slice(0, 5).map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <span className="text-cream-100/55 w-[78px] font-mono">
                {formatDate(m.startAt)}
              </span>
              <span className="flex-1 text-cream-100 truncate">
                {m.topic}
              </span>
              <span className="text-[10.5px] uppercase tracking-wider text-cream-100/45">
                {m.provider}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/* ----- Hearings + deadlines ----- */

function DeadlinesTile({ data }: { data: DashboardTileData }) {
  return (
    <TileFrame
      eyebrow="Hearings + deadlines"
      title={
        data.deadlines.length === 0
          ? 'Nothing due'
          : `Next ${Math.min(data.deadlines.length, 5)}`
      }
      href="/counsel/calendar"
      accent={data.accent}
      span={2}
    >
      {data.deadlines.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          Hearings and case deadlines flagged in your matters will
          appear here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.deadlines.slice(0, 5).map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <span className="text-cream-100/55 w-[78px] font-mono">
                {formatDate(d.dueAt)}
              </span>
              <span className="flex-1 text-cream-100 truncate">
                {d.title}
              </span>
              <span className="text-[10.5px] uppercase tracking-wider text-cream-100/45">
                {d.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/* ----- Intake pipeline ----- */

function IntakePipelineTile({ data }: { data: DashboardTileData }) {
  const lanes = [
    { label: 'Needs attention', count: data.intake.needsAttention, tone: 'warn' },
    { label: 'In review', count: data.intake.inReview, tone: 'info' },
    { label: 'Accepted', count: data.intake.accepted, tone: 'ok' },
    { label: 'Closed', count: data.intake.closed, tone: 'muted' },
  ];
  return (
    <TileFrame
      eyebrow="Intake pipeline"
      title="Request inbox"
      href="/counsel/inbox"
      accent={data.accent}
      span={2}
    >
      <div className="mt-3 grid grid-cols-4 gap-2">
        {lanes.map((l) => (
          <div
            key={l.label}
            className="rounded-md ring-1 ring-forest-700/40 bg-forest-900/40 px-2 py-2 text-center"
          >
            <p className="font-display text-xl text-cream-100">
              {l.count}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-cream-100/55 mt-0.5">
              {l.label}
            </p>
          </div>
        ))}
      </div>
    </TileFrame>
  );
}

/* ----- Recent activity ----- */

function RecentActivityTile({ data }: { data: DashboardTileData }) {
  // Synthesize recent activity from the most recent items across
  // intake + uploads. A dedicated firm activity stream is a future
  // upgrade; this gives a useful preview today.
  const events: Array<{ when: string; what: string; href: string }> = [];
  for (const i of data.intake.recentNew.slice(0, 5)) {
    events.push({
      when: i.createdAt,
      what: `${i.isInternal ? 'Employee request' : 'External intake'}: ${i.clientName}`,
      href: `/counsel/intake/${i.id}`,
    });
  }
  for (const u of data.recentUploads.slice(0, 3)) {
    events.push({
      when: u.uploadedAt,
      what: `Document uploaded: ${u.title}`,
      href: '/counsel/documents',
    });
  }
  events.sort((a, b) => (a.when < b.when ? 1 : -1));
  const top = events.slice(0, 6);
  return (
    <TileFrame
      eyebrow="Recent activity"
      title={top.length === 0 ? 'Nothing recently' : 'Across the firm'}
      accent={data.accent}
      span={2}
    >
      {top.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          New intakes, uploads, and signings will surface here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {top.map((e, i) => (
            <li key={`${e.href}-${i}`} className="text-[12.5px]">
              <Link
                href={e.href}
                className="flex items-center gap-2 hover:bg-cream-100/5 rounded px-2 py-1 -mx-2"
              >
                <span className="text-cream-100/55 w-[68px] font-mono">
                  {formatDate(e.when)}
                </span>
                <span className="flex-1 text-cream-100 truncate">
                  {e.what}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/* ----- Recent uploads ----- */

function RecentUploadsTile({ data }: { data: DashboardTileData }) {
  return (
    <TileFrame
      eyebrow="Recent uploads"
      title={
        data.recentUploads.length === 0
          ? 'No documents yet'
          : `Last ${Math.min(data.recentUploads.length, 5)}`
      }
      href="/counsel/documents"
      accent={data.accent}
      span={2}
    >
      {data.recentUploads.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          Upload contracts, motions, evidence and they'll show up
          here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {data.recentUploads.slice(0, 5).map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 text-[12.5px]"
            >
              <span className="text-cream-100/55 w-[78px] font-mono">
                {formatDate(u.uploadedAt)}
              </span>
              <span className="flex-1 text-cream-100 truncate">
                {u.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}

/* ----- helpers ----- */

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameYear = d.getFullYear() === today.getFullYear();
    const opts: Intl.DateTimeFormatOptions = sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: '2-digit' };
    return d.toLocaleDateString(undefined, opts);
  } catch {
    return '';
  }
}
