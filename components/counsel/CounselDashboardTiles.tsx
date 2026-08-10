import Link from 'next/link';
import type { CounselTileId } from '@/lib/counsel-dashboard';
import type { CounselMetric, MetricBand } from '@/lib/counsel-metrics';
import { T } from '@/components/i18n/LocaleProvider';
import { formatDateWith } from '@/lib/format';

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
  /**
   * The lists here are the few rows the tile DRAWS; the totals beside
   * them are how many there are. They used to be one thing: the page
   * sliced each list to ten and the tile printed that slice's length as
   * the count, so an attorney with 24 matters read "10" and a title of
   * "20 things in your name" that could never say anything else.
   */
  assigned: {
    cases: Array<{ id: string; title: string; status: string }>;
    casesTotal: number;
    clients: Array<{ id: string; displayName: string; status: string }>;
    clientsTotal: number;
  };
  signing: {
    /**
     * How many signature requests the current user created are still
     * out. A count, not a list: nothing renders the rows, and when this
     * was an array sliced to ten the action center headed the card with
     * that ten and added it into "N things need a human".
     */
    mineAwaitingCount: number;
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
        headline={<>{data.counts.casesOpen} <T>open</T></>}
        metric={<>{data.counts.casesTotal} <T>total</T></>}
        body="Cases shared with the firm. Open + active matters at the top."
      />;
    case 'clients-overview':
      return <SimpleCountTile
        href="/counsel/clients"
        eyebrow="Clients"
        headline={String(data.counts.clients)}
        metric={<>{data.counts.clientsActive} <T>active</T></>}
        body="Invite a client and they stay linked to your firm."
      />;
    case 'team-overview':
      return <SimpleCountTile
        href="/counsel/team"
        eyebrow="Team"
        headline={
          <>
            {data.counts.members}{' '}
            <T>{data.counts.members === 1 ? 'member' : 'members'}</T>
          </>
        }
        metric={
          data.counts.invitations > 0 ? (
            <>{data.counts.invitations} <T>pending</T></>
          ) : (
            <T>No pending invites</T>
          )
        }
        body="Admins, attorneys, paralegals, staff."
      />;
    case 'documents-overview':
      return <SimpleCountTile
        href="/counsel/documents"
        eyebrow="Documents"
        headline={String(data.counts.documents)}
        // Was "Versioned". Nothing is versioned: `firm_documents.version`
        // is written as the literal 1 at all five insert sites and no code
        // path ever increments it, so the word described a feature that
        // does not exist. This is the same wording the metric strip on the
        // dashboard already uses for the same number.
        metric={<T>held for this firm</T>}
        body="Contracts, motions, evidence packets."
      />;
    case 'signing-overview':
      return <SimpleCountTile
        // The count is sent-or-partial, so the link carries the view that
        // shows exactly those. Unfiltered, the tile said "7 awaiting
        // signature" and opened a page listing every request the firm has
        // ever sent, including the completed ones.
        href="/counsel/signing?view=out"
        eyebrow="Signing"
        headline={String(data.counts.signingPending)}
        metric={<T>awaiting signature</T>}
        body="UETA-aligned, tamper-evident audit chain."
      />;
    case 'recent-activity':
      return <RecentActivityTile data={data} />;
    case 'recent-uploads':
      return <RecentUploadsTile data={data} />;
    case 'team-chat':
      return <SimpleCountTile
        href="/counsel/chat"
        eyebrow="Team chat"
        headline={<T>Channels + DMs</T>}
        metric={<T>Realtime</T>}
        body="Channels for firm-wide topics, group DMs per matter, 1:1s."
      />;
    case 'firm-settings':
      if (!data.isAdmin) return null;
      return <SimpleCountTile
        href="/counsel/settings"
        eyebrow="Firm settings"
        headline={<T>Brand + scope</T>}
        metric={<T>Owner / admin</T>}
        body="Logo, accent color, jurisdictions, practice areas."
      />;
    default:
      return null;
  }
}

/* ----- the metric board ----- */

/**
 * The board under the headline strip: every operational figure a partner
 * asks for on a Monday, each one opening the list that holds its rows.
 *
 * THE BANDS SAY WHOSE MOVE IT IS. That is a real property of each figure
 * and the question somebody scanning this is actually asking, so it earns
 * the structure. "Awaiting approval" and "Out for signature" are both
 * documents in flight and they sit in different bands, because only one of
 * them is waiting on this firm.
 *
 * STATE IS ENCODED THREE TIMES: in the thickness of the left rail, in the
 * colour of the figure, and in a word under it. Thickness carries it in
 * greyscale and under forced colours; the word carries it for a reader who
 * cannot separate amber from red. Nothing here reads as colour alone.
 *
 * THE STATE COLOURS ARE NOT THE FIRM ACCENT. `--warn-text` and
 * `--danger-text` are fixed in app/globals.css for both themes precisely
 * because status is not branding, and they arrive as CLASSES so the
 * contrast guards in tests/accent-text.test.ts can see them. A firm's own
 * `accent_color` painted as words is the failure lib/accent-text.ts exists
 * to prevent.
 */
/**
 * The rail is a PAINTED ELEMENT, not a left border, and that is not a
 * stylistic preference. `.counsel-shell .card` sets border-color in
 * app/globals.css, which outranks a single `border-l-*` colour utility,
 * so a bordered rail rendered at the right thickness in the card's own
 * hairline gold and carried no state at all. Rendering it as a child that
 * paints its own background puts it out of that rule's reach.
 */
const METRIC_RAIL: Record<CounselMetric['tone'], string> = {
  clear: 'w-0.5 bg-edge',
  waiting: 'w-1 bg-warn-text',
  urgent: 'w-1.5 bg-danger-text',
};

const METRIC_VALUE: Record<CounselMetric['tone'], string> = {
  // A token, not the forest/cream palette pair a card heading reaches for
  // by habit. Those two steps take their colour from the .dark override
  // block in app/globals.css, and tests/accent-text.test.ts refuses them
  // here: a token has one declaration per theme and so cannot go
  // unrepainted, which is how the light counsel layer used to leave half
  // this surface measured and the other half at whatever it inherited.
  clear: 'text-foreground',
  waiting: 'text-warn-text',
  urgent: 'text-danger-text',
};

const METRIC_STATE: Record<CounselMetric['tone'], string> = {
  clear: 'text-muted',
  waiting: 'text-warn-text',
  urgent: 'text-danger-text',
};

/**
 * Props are destructured to their own names rather than passed as a metric
 * object so the copy reaches <T> as `label` / `state` / `hint`, which is
 * what scripts/test/counsel-i18n-invariants.mjs allows: every one of them
 * comes from the static tables in lib/counsel-metrics.ts, never from firm
 * data.
 */
function MetricCell({
  label,
  value,
  state,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  state: string;
  hint: string;
  tone: CounselMetric['tone'];
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
    >
      <div className="card relative h-full overflow-hidden p-4 pl-5 transition-all hover:-translate-y-0.5 hover:shadow-card-hover">
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 ${METRIC_RAIL[tone]}`}
        />
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted">
          <T>{label}</T>
        </p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={`text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] ${METRIC_VALUE[tone]}`}
          >
            {value}
          </span>
          <span
            className={`text-[11px] font-medium uppercase tracking-[0.1em] ${METRIC_STATE[tone]}`}
          >
            <T>{state}</T>
          </span>
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          <T>{hint}</T>
        </p>
      </div>
    </Link>
  );
}

function MetricBandHeader({
  label,
  blurb,
}: {
  label: string;
  blurb: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-text">
        <T>{label}</T>
      </h3>
      <p className="text-[12px] text-muted">
        <T>{blurb}</T>
      </p>
    </div>
  );
}

export function CounselMetricBoard({ bands }: { bands: MetricBand[] }) {
  if (bands.length === 0) return null;
  return (
    <section className="space-y-5" aria-label="Firm metrics">
      {bands.map((band) => (
        <div key={band.id} className="space-y-2.5">
          <MetricBandHeader label={band.label} blurb={band.blurb} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {band.metrics.map((m) => (
              <MetricCell
                key={m.id}
                label={m.label}
                value={m.value}
                state={m.state}
                hint={m.hint}
                tone={m.tone}
                href={m.href}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ----- atomic tile presentational components ----- */

/**
 * Every tile eyebrow on this page.
 *
 * It used to be `style={{ color: firm.accentColor }}`: the customer's own
 * hex, painted as TEXT on a card. That is the one thing lib/accent-text.ts
 * exists to stop. A colour chosen to work as a button FILL is usually
 * unreadable as words - Advottic's own default gold measures 1.87:1 on a
 * white card - and because the value arrived as an inline style rather
 * than as a class, no contrast guard could see it and none of the
 * arithmetic in that file ever ran on it. `--accent-text` is the same
 * firm's accent with its lightness pinned and its chroma capped, proved
 * against every surface either theme paints, for every hex a customer can
 * type. Fills keep the exact brand colour; only words move.
 */
const TILE_EYEBROW =
  'text-[10px] uppercase tracking-[0.22em] font-semibold text-accent-text';

function TileFrame({
  eyebrow,
  title,
  href,
  span,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  href?: string;
  span?: 1 | 2 | 4;
  children: React.ReactNode;
}) {
  const colSpan =
    span === 4
      ? 'sm:col-span-2 lg:col-span-4'
      : span === 2
        ? 'sm:col-span-2 lg:col-span-2'
        : '';
  const inner = (
    <div className="card p-5 h-full hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
      <div className="flex items-center justify-between mb-1">
        <p className={TILE_EYEBROW}>
          <T>{eyebrow}</T>
        </p>
        {href ? (
          <span className="text-[11px] text-cream-100/60"><T>View</T></span>
        ) : null}
      </div>
      <p className="text-lg font-medium tracking-[-0.01em] text-foreground">
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
}: {
  href: string;
  eyebrow: string;
  headline: React.ReactNode;
  metric: React.ReactNode;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all group block h-full"
    >
      <p className={TILE_EYEBROW}>
        <T>{eyebrow}</T>
      </p>
      <p className="text-2xl font-medium tracking-[-0.01em] text-foreground mt-1">
        {headline}
      </p>
      <p className="text-[11px] text-muted mt-0.5 font-mono uppercase tracking-wider">
        {metric}
      </p>
      <p className="text-[13px] text-muted mt-2.5 leading-relaxed">
        <T>{body}</T>
      </p>
    </Link>
  );
}

/* ----- Action center: only-renders-when-there's-something tile ----- */

export type ActionCenterItem = {
  label: string;
  href: string;
  detail: string;
  tone: 'warn' | 'ok';
  workItems: number;
};

/**
 * The rows of the action center, as data.
 *
 * Exported and pure so the arithmetic and the wording can be exercised
 * directly. Two things here are only wrong at particular counts, and both
 * shipped: the title once counted ROWS, so a tile headed "1 thing needs a
 * human" sat directly above a row reading "5 requests need attention"; and
 * the labels pluralised the noun but not the verb, so at exactly one item
 * a firm read "1 request need attention" and "1 signing request you sent
 * are still out". A small firm sits on a count of one most days, so that
 * was the state most users saw and the one no test covered.
 *
 * The rows are disjoint, which is what makes their sum honest. "New in the
 * last 24 hours" counts arrivals in EVERY lane, so it is not a row of its
 * own when there is anything needing attention - it would double-count -
 * and rides along as a clause that names itself as the separate measure it
 * is.
 */
export function actionCenterItems(data: DashboardTileData): ActionCenterItem[] {
  const items: ActionCenterItem[] = [];
  const plural = (n: number, one: string, many: string) =>
    n === 1 ? one : many;
  if (data.intake.needsAttention > 0) {
    const n = data.intake.needsAttention;
    const today = data.intake.newToday;
    items.push({
      label: `${n} ${plural(n, 'request needs', 'requests need')} attention`,
      href: '/counsel/inbox',
      detail:
        today > 0
          ? `Untriaged or flagged, waiting on legal. Separately, ${today} ${plural(today, 'request', 'requests')} arrived in the last 24 hours, in any lane.`
          : 'Untriaged or flagged, waiting on legal.',
      tone: 'warn',
      workItems: n,
    });
  } else if (data.intake.newToday > 0) {
    items.push({
      label: `${data.intake.newToday} new in the last 24 hours`,
      href: '/counsel/inbox',
      detail: 'Already triaged, but worth a look before the day fills up.',
      tone: 'warn',
      workItems: data.intake.newToday,
    });
  }
  const outstanding = data.signing.mineAwaitingCount;
  if (outstanding > 0) {
    items.push({
      label: `${outstanding} signing ${plural(outstanding, 'request you sent is', 'requests you sent are')} still out`,
      href: '/counsel/signing',
      detail: 'Send a reminder or escalate if the deadline is close.',
      tone: 'warn',
      workItems: outstanding,
    });
  }
  if (data.counts.invitations > 0 && data.isAdmin) {
    const n = data.counts.invitations;
    items.push({
      label: `${n} pending team ${plural(n, 'invitation', 'invitations')}`,
      href: '/counsel/team',
      detail: 'Members invited but not yet accepted.',
      tone: 'warn',
      workItems: n,
    });
  }
  return items;
}

/** The tile's headline: the work behind every row, added up. */
export function actionCenterWorkItems(items: ActionCenterItem[]): number {
  return items.reduce((sum, i) => sum + i.workItems, 0);
}

function ActionCenterTile({ data }: { data: DashboardTileData }) {
  const items = actionCenterItems(data);
  const workItems = actionCenterWorkItems(items);

  return (
    <TileFrame
      eyebrow="Action center"
      title={
        items.length === 0 ? (
          <T>All clear</T>
        ) : (
          <>
            {workItems}{' '}
            <T>
              {workItems === 1
                ? 'thing needs a human'
                : 'things need a human'}
            </T>
          </>
        )
      }
      span={4}
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          <T>
            Nothing waiting on you right now. New requests, signing
            chase-ups, and pending invitations will surface here.
          </T>
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
                    <T>{it.detail}</T>
                  </span>
                </span>
                <span className="text-[11px] text-cream-100/55 mt-1">
                  <T>Open</T>
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
  // The totals, not the length of the rows drawn below them.
  const clientCount = data.assigned.clientsTotal;
  const caseCount = data.assigned.casesTotal;
  const total = clientCount + caseCount;
  return (
    <TileFrame
      eyebrow="Assigned to me"
      title={
        total === 0 ? (
          <T>Nothing assigned yet</T>
        ) : (
          <>
            {total}{' '}
            <T>
              {total === 1 ? 'thing in your name' : 'things in your name'}
            </T>
          </>
        )
      }
      span={4}
    >
      {total === 0 ? (
        <p className="text-[13px] text-muted mt-2 leading-relaxed">
          <T>
            When you're set as the primary attorney on a client or case,
            it'll show up here for quick access.
          </T>
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-100/60 mb-1">
              <T>Your clients</T> ({clientCount})
            </p>
            {clientCount === 0 ? (
              <p className="text-[12px] text-cream-100/55">
                <T>No primary-attorney clients.</T>
              </p>
            ) : (
              <ul className="space-y-1">
                {/* There is no /counsel/clients/[id] route. Every row here
                    used to link at one, so Next prefetched a 404 on dashboard
                    render and the console carried the failure before anyone
                    clicked. The client list is the real destination. */}
                {data.assigned.clients.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href="/counsel/clients"
                      className="block rounded px-2 py-1 text-[13px] text-cream-100 hover:bg-cream-100/5"
                    >
                      {c.displayName}
                      <span className="ml-2 text-[10.5px] uppercase tracking-wider text-cream-100/60">
                        {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
                {clientCount > 5 && (
                  <li className="text-[11px] text-cream-100/60 px-2 pt-0.5">
                    +{clientCount - 5} <T>more</T>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-cream-100/60 mb-1">
              <T>Your cases</T> ({caseCount})
            </p>
            {caseCount === 0 ? (
              <p className="text-[12px] text-cream-100/55">
                <T>No cases tied to your clients yet.</T>
              </p>
            ) : (
              <ul className="space-y-1">
                {data.assigned.cases.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/counsel/cases/${c.id}`}
                      className="block rounded px-2 py-1 text-[13px] text-cream-100 hover:bg-cream-100/5"
                    >
                      {c.title}
                      <span className="ml-2 text-[10.5px] uppercase tracking-wider text-cream-100/60">
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </Link>
                  </li>
                ))}
                {caseCount > 5 && (
                  <li className="text-[11px] text-cream-100/60 px-2 pt-0.5">
                    +{caseCount - 5} <T>more</T>
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
    // There is no dedicated "new matter" route - the control lives on the
    // caseload page itself, so this shortcut used to 404 on click.
    { href: '/counsel/cases', label: 'New matter' },
    { href: '/counsel/intake', label: 'New intake' },
    { href: '/counsel/calendar', label: 'Schedule meeting' },
    { href: '/counsel/documents', label: 'Upload document' },
  ];
  return (
    <TileFrame
      eyebrow="Quick actions"
      title={<T>Start something</T>}
      span={2}
    >
      <div className="mt-3 grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="rounded-md ring-1 ring-forest-700/40 bg-forest-900/40 hover:bg-forest-800/60 px-3 py-2 text-[12.5px] text-cream-100/85 hover:text-cream-100 transition-colors text-center"
          >
            <T>{a.label}</T>
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
        data.meetings.length === 0 ? (
          <T>Nothing on the calendar</T>
        ) : (
          <><T>Next</T> {Math.min(data.meetings.length, 5)}</>
        )
      }
      href="/counsel/calendar"
      span={2}
    >
      {data.meetings.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          <T>
            Connect Microsoft 365 or Zoom from Calendar to see your
            schedule here.
          </T>
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
              <span className="text-[10.5px] uppercase tracking-wider text-cream-100/60">
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
        data.deadlines.length === 0 ? (
          <T>Nothing due</T>
        ) : (
          <><T>Next</T> {Math.min(data.deadlines.length, 5)}</>
        )
      }
      href="/counsel/calendar"
      span={2}
    >
      {data.deadlines.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          <T>
            Hearings and case deadlines flagged in your matters will
            appear here.
          </T>
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
              <span className="text-[10.5px] uppercase tracking-wider text-cream-100/60">
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
      title={<T>Request inbox</T>}
      href="/counsel/inbox"
      span={2}
    >
      <div className="mt-3 grid grid-cols-4 gap-2">
        {lanes.map((l) => (
          <div
            key={l.label}
            className="rounded-md ring-1 ring-forest-700/40 bg-forest-900/40 px-2 py-2 text-center"
          >
            <p className="text-xl text-cream-100">
              {l.count}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-cream-100/55 mt-0.5">
              <T>{l.label}</T>
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
      title={
        top.length === 0 ? <T>Nothing recently</T> : <T>Across the firm</T>
      }
      span={2}
    >
      {top.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          <T>New intakes, uploads, and signings will surface here.</T>
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
        data.recentUploads.length === 0 ? (
          <T>No documents yet</T>
        ) : (
          <><T>Last</T> {Math.min(data.recentUploads.length, 5)}</>
        )
      }
      href="/counsel/documents"
      span={2}
    >
      {data.recentUploads.length === 0 ? (
        <p className="text-[12.5px] text-cream-100/60 mt-2 leading-relaxed">
          <T>Upload contracts, motions, evidence and they'll show up here.</T>
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
    return formatDateWith(d, opts);
  } catch {
    return '';
  }
}
