import Link from 'next/link';
import { readIntakeFolder } from '@/lib/request-folders';
import {
  INTAKE_LANE_BLURB,
  INTAKE_LANE_LABEL,
  intakeLaneOf,
  type IntakeLane,
} from '@/lib/intake-lanes';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';
import { T } from '@/components/i18n/LocaleProvider';
import { Tt } from '@/components/i18n/Tt';

export type InboxIntake = {
  id: string;
  client_name: string;
  matter_type: string | null;
  jurisdiction_state: string | null;
  status: string;
  created_at: string;
  intake_answers: Record<string, unknown> | null;
};

// One hex per status, the same shape as app/counsel/intake/[id]. This was
// the last per-file triple of Tailwind classes on this surface, and it
// agreed with the detail page on every status the two share: grey for
// new, emerald for a passed conflict check and for engaged, rose for a
// flag. So no status changes meaning, and the three the inbox alone
// knows about (converted, closed, rejected) keep the family they had.
//
// The chips do change shade. The old map painted a pale tint on a dark
// panel - near-white text for the greys, emerald-200, rose-200 - which
// is a louder chip than the same status wears on the detail page or
// anywhere else in counsel. They now read at StatusPill's strength.
// That is the point of folding it in: these were the last chips in the
// product still shouting a different dialect. The light-mode half of
// the old map was dead code either way, since this list only ever
// renders inside the always-dark counsel shell.
const STATUS_COLOR: Record<string, string> = {
  in_progress: PILL_COLORS.neutral,
  conflict_check_passed: PILL_COLORS.good,
  conflict_check_flagged: PILL_COLORS.flagged,
  engaged: PILL_COLORS.good,
  converted: PILL_COLORS.good,
  closed: PILL_COLORS.neutral,
  rejected: PILL_COLORS.neutral,
};
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'New',
  conflict_check_passed: 'In review',
  conflict_check_flagged: 'Conflict flag',
  engaged: 'Accepted',
  converted: 'Converted to a matter',
  closed: 'Closed',
  rejected: 'Closed',
};
// Lanes come from lib/intake-lanes, the one definition the dashboard row and
// the Impact "Open requests" KPI also read. The local copy here classified
// `converted` and `closed` as "needs attention", which is why a CONVERTED
// request sat in the triage lane.
type Lane = IntakeLane;
const LANE_META: Record<Lane, { name: string; blurb: string }> = {
  attention: {
    name: INTAKE_LANE_LABEL.attention,
    blurb: INTAKE_LANE_BLURB.attention,
  },
  review: { name: INTAKE_LANE_LABEL.review, blurb: INTAKE_LANE_BLURB.review },
  accepted: {
    name: INTAKE_LANE_LABEL.accepted,
    blurb: INTAKE_LANE_BLURB.accepted,
  },
  closed: { name: INTAKE_LANE_LABEL.closed, blurb: INTAKE_LANE_BLURB.closed },
};
const laneOf = intakeLaneOf;
const PRIORITY_RANK: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};
const PRIORITY_TONE: Record<string, string> = {
  Urgent: 'bg-rose-500 text-white',
  High: 'bg-amber-500 text-forest-950',
  Normal:
    'bg-ink-200 dark:bg-forest-700 text-foreground',
  Low: 'bg-surface-2 text-muted',
};
const GRADE_TONE: Record<string, string> = {
  A: 'bg-emerald-500 text-white',
  B: 'bg-emerald-600 text-white',
  C: 'bg-amber-500 text-forest-950',
  D: 'bg-rose-500 text-white',
  F: 'bg-rose-700 text-white',
};
function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

type Row = InboxIntake & {
  _lane: Lane;
  _priority: string;
  _grade: string | null;
  _folder: string;
  _replyNeeded: boolean;
};

export function IntakeInbox({
  intakes,
  folders,
  emptyMessage,
}: {
  intakes: InboxIntake[];
  folders: { key: string; name: string }[];
  emptyMessage?: string;
}) {
  const folderName = new Map(folders.map((f) => [f.key, f.name]));
  const rows: Row[] = intakes.map((i) => {
    const ans = (i.intake_answers ?? {}) as Record<string, unknown>;
    const thread = Array.isArray(ans.thread)
      ? (ans.thread as Array<{ role?: string }>)
      : [];
    const last = thread[thread.length - 1];
    const review = (ans.review ?? null) as { grade?: string } | null;
    const fk = readIntakeFolder(i.intake_answers);
    return {
      ...i,
      _lane: laneOf(i.status),
      _priority: String(ans.priority ?? 'Normal'),
      _grade: review?.grade ?? null,
      _folder: (fk && folderName.get(fk)) || '',
      _replyNeeded:
        thread.length > 0 &&
        last?.role === 'employee' &&
        i.status !== 'rejected',
    };
  });
  const sortRows = (a: Row, b: Row) => {
    if (a._replyNeeded !== b._replyNeeded) return a._replyNeeded ? -1 : 1;
    const pa = PRIORITY_RANK[a._priority] ?? 2;
    const pb = PRIORITY_RANK[b._priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  };
  const lanes: Lane[] = ['attention', 'review', 'accepted', 'closed'];
  const byLane = (l: Lane) =>
    rows.filter((r) => r._lane === l).sort(sortRows);
  const replyCount = rows.filter((r) => r._replyNeeded).length;

  if (intakes.length === 0) {
    return (
      <p className="card p-6 text-[13px] text-muted italic">
        <T>{emptyMessage ?? 'No requests here yet.'}</T>
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {replyCount > 0 && (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-gold-500/15 ring-1 ring-gold-500/40 px-2.5 py-1 text-[12px] font-semibold text-gold-700 dark:text-gold-200">
          {replyCount} awaiting your reply
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {lanes.map((l) => (
          <div key={l} className="card p-3.5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {LANE_META[l].name}
            </p>
            <p className="text-2xl text-foreground mt-1">
              {byLane(l).length}
            </p>
          </div>
        ))}
      </div>

      {lanes.map((l) => {
        const items = byLane(l);
        if (items.length === 0) return null;
        return (
          <div key={l} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted">
                {LANE_META[l].name}{' '}
                <span className="text-ink-300 dark:text-cream-100/30">
                  ({items.length})
                </span>
              </p>
              <span className="text-[11px] text-muted">
                {LANE_META[l].blurb}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((i) => {
                const statusColor =
                  STATUS_COLOR[i.status] ?? STATUS_COLOR.in_progress;
                const ans = (i.intake_answers ?? {}) as Record<
                  string,
                  unknown
                >;
                const isEmployeeReq =
                  String(ans.submitted_by ?? '').trim().length > 0;
                const threadCount = Array.isArray(ans.thread)
                  ? (ans.thread as unknown[]).length
                  : 0;
                return (
                  <li
                    key={i.id}
                    className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
                  >
                    <Link
                      href={`/counsel/intake/${i.id}`}
                      className="block"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-foreground truncate flex items-center gap-2 min-w-0">
                          <span className="truncate">
                            {i.client_name}
                          </span>
                          {i._replyNeeded && (
                            <span className="shrink-0 inline-flex items-center rounded-full bg-gold-500 px-2 py-[1px] text-[10px] font-bold uppercase tracking-[0.1em] text-forest-950">
                              Reply
                            </span>
                          )}
                          {isEmployeeReq && (
                            <span className="shrink-0 inline-flex items-center rounded-full bg-gold-500/15 ring-1 ring-gold-500/30 px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-700 dark:text-gold-200">
                              In-house
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {i._grade && (
                            <Tt
                              className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded px-1 text-[11px] font-bold ${
                                GRADE_TONE[i._grade] ??
                                'bg-ink-400 text-white'
                              }`}
                              title="Advottic Review grade"
                            >
                              {i._grade}
                            </Tt>
                          )}
                          <span
                            className={`inline-flex items-center rounded px-2 py-[2px] text-[10px] font-semibold ${
                              PRIORITY_TONE[i._priority] ??
                              PRIORITY_TONE.Normal
                            }`}
                          >
                            {i._priority}
                          </span>
                          <StatusPill size="sm" color={statusColor}>
                            {STATUS_LABEL[i.status] ??
                              i.status.replace(/_/g, ' ')}
                          </StatusPill>
                        </div>
                      </div>
                      <p className="text-[12px] text-muted mt-1.5">
                        {i.matter_type ?? 'Matter type not set'}
                        {i.jurisdiction_state &&
                          ` · ${i.jurisdiction_state}`}
                        {i._folder && ` · ${i._folder}`}
                        {' · '}
                        {ageLabel(i.created_at)}
                        {threadCount > 0 &&
                          ` · ${threadCount} message${threadCount === 1 ? '' : 's'}`}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
