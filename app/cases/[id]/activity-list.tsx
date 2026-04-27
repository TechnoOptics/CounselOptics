import type { AuditEvent, CaseEventType } from '@/lib/activity';

const EVENT_LABEL: Record<CaseEventType, string> = {
  case_created: 'created the case',
  case_viewed: 'viewed the case',
  case_status_changed: 'changed the status',
  case_deleted: 'deleted the case',
  exhibit_uploaded: 'uploaded an exhibit',
  exhibit_deleted: 'deleted an exhibit',
  review_run: 'ran a Legal Eye review',
  hearing_updated: 'updated the hearing',
  collaborator_invited: 'invited a collaborator',
  collaborator_removed: 'removed a collaborator',
  witness_statement_updated: 'updated their witness statement',
};

const EVENT_TONE: Record<CaseEventType, string> = {
  case_created: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  case_viewed: 'bg-cream-100/15 text-cream-100/85 ring-cream-100/25',
  case_status_changed: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  case_deleted: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  exhibit_uploaded: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  exhibit_deleted: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  review_run: 'bg-gold-500/15 text-gold-300 ring-gold-500/30',
  hearing_updated: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  collaborator_invited: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  collaborator_removed: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  witness_statement_updated: 'bg-gold-500/15 text-gold-300 ring-gold-500/30',
};

/**
 * Activity tab content: chronological list of audit_events for the case.
 * Server component since the data was already fetched on the page.
 */
export function ActivityList({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-ink-600 dark:text-cream-100/70">
        No activity yet. Uploads, edits, and views will show up here.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className="rounded-xl bg-gradient-to-br from-forest-800 via-forest-900 to-forest-950 ring-1 ring-forest-700/40 px-4 py-3 flex items-start gap-3"
        >
          <span
            className={`flex-none mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ${EVENT_TONE[e.eventType]}`}
            aria-hidden
          >
            <EventIcon type={e.eventType} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-cream-100">
              <span className="font-semibold">
                {e.actorDisplayName || e.actorEmail || 'Someone'}
              </span>{' '}
              <span className="text-cream-100/75">{EVENT_LABEL[e.eventType]}</span>
              {summary(e)}
            </p>
            <p className="text-[11px] text-cream-100/55 mt-0.5 font-mono tabular-nums">
              {formatRelative(e.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function summary(e: AuditEvent): React.ReactNode {
  const m = e.metadata;
  switch (e.eventType) {
    case 'exhibit_uploaded':
      if (m.label && m.fileName)
        return (
          <>
            <span className="text-cream-100/40 mx-1">·</span>
            <span className="text-cream-100/85">
              {String(m.label)}: {String(m.fileName)}
            </span>
          </>
        );
      return null;
    case 'case_status_changed':
      if (m.from && m.to)
        return (
          <>
            <span className="text-cream-100/40 mx-1">·</span>
            <span className="text-cream-100/85 font-mono text-[11px]">
              {String(m.from)} → {String(m.to)}
            </span>
          </>
        );
      return null;
    case 'collaborator_invited':
      if (m.email)
        return (
          <>
            <span className="text-cream-100/40 mx-1">·</span>
            <span className="text-cream-100/85">{String(m.email)}</span>
          </>
        );
      return null;
    case 'hearing_updated':
      if (m.hearingAt)
        return (
          <>
            <span className="text-cream-100/40 mx-1">·</span>
            <span className="text-cream-100/85">
              {new Date(String(m.hearingAt)).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </>
        );
      return null;
    default:
      return null;
  }
}

function EventIcon({ type }: { type: CaseEventType }) {
  // 14×14 stroked SVGs - one consistent style across the timeline so
  // the eye can scan event categories without context-switching
  // between emoji, ASCII, and Unicode glyphs.
  const stroke = 'currentColor';
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (type) {
    case 'case_created':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'case_viewed':
      return (
        <svg {...props}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'exhibit_uploaded':
      return (
        <svg {...props}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case 'exhibit_deleted':
      return (
        <svg {...props}>
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
        </svg>
      );
    case 'review_run':
      return (
        <svg {...props}>
          <path d="M12 2l2.6 6.4L21 9.3l-4.8 4.5L17.5 21 12 17.5 6.5 21l1.3-7.2L3 9.3l6.4-.9L12 2z" />
        </svg>
      );
    case 'hearing_updated':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case 'collaborator_invited':
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 21c0-3.5 3-6 6-6s6 2.5 6 6M19 8v6M16 11h6" />
        </svg>
      );
    case 'collaborator_removed':
      return (
        <svg {...props}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 21c0-3.5 3-6 6-6s6 2.5 6 6M16 11h6" />
        </svg>
      );
    case 'case_status_changed':
      return (
        <svg {...props}>
          <path d="M3 7h13l-3-3M21 17H8l3 3" />
        </svg>
      );
    case 'case_deleted':
      return (
        <svg {...props}>
          <path d="M21 12H7M11 7l-4 5 4 5" />
        </svg>
      );
    case 'witness_statement_updated':
      return (
        <svg {...props}>
          <path d="M16 3l5 5-11 11H5v-5L16 3z" />
        </svg>
      );
  }
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${Math.max(1, sec)}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
