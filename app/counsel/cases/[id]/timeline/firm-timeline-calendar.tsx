'use client';

import { useMemo, useState, useCallback, useEffect, type ReactNode } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { RelevanceBadge } from '@/components/RelevanceBadge';
import { getFirmEvidenceMediaUrl } from '@/lib/case-evidence-actions';
import { formatOccurred, KIND_LABEL, type TimelineEvent } from '@/lib/timeline-types';
import { KindIcon } from '@/components/counsel/KindIcon';

/**
 * Firm-native calendar view for the case timeline. A companion to the dated
 * chronology: instead of a list, it shows "where in time the key things
 * happened" as a grid of periods, each shaded by how many events fall in it.
 *
 * Five zoom levels, coarse to fine:
 *   Decade  - the ten years of a decade
 *   Year    - the twelve months of a year
 *   Month   - the days of a month (7-column calendar grid)
 *   Week    - the seven days of a week
 *   Day     - the twenty-four hours of a day
 *
 * Clicking a cell both DRILLS IN one zoom level (decade -> year -> month ->
 * day) and FILTERS the surrounding chronology to that period, via onSelect.
 * All bucketing is done in UTC so it lines up exactly with formatOccurred,
 * which renders occurred dates in UTC everywhere else in the timeline.
 */

export type CalLevel = 'decade' | 'year' | 'month' | 'week' | 'day';

/** A period the chronology can be filtered to. Half-open [start, end). */
export type PeriodRange = {
  start: string; // ISO
  end: string; // ISO (exclusive)
  label: string;
  /** Stable anchor key for calendar-period comments (e.g. '2026', '2026-07', '2026-07-08'). */
  refKey: string;
};

const LEVELS: { value: CalLevel; label: string }[] = [
  { value: 'decade', label: 'Decade' },
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Cell = {
  key: string;
  label: string;
  sub?: string;
  start: Date;
  end: Date;
  count: number;
  inScope: boolean; // e.g. day belongs to the shown month
  isToday: boolean;
};

// ── UTC period helpers ────────────────────────────────────────────────────
function utc(y: number, mo = 0, d = 1, h = 0): Date {
  return new Date(Date.UTC(y, mo, d, h, 0, 0, 0));
}
function startOfUTCDay(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function startOfUTCWeek(d: Date): Date {
  const s = startOfUTCDay(d);
  s.setUTCDate(s.getUTCDate() - s.getUTCDay()); // week starts Sunday
  return s;
}
function addMonthsUTC(d: Date, n: number): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
}
function sameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Count events whose occurredAt lands in [start, end). Ignores undated. */
function countInRange(sorted: number[], start: Date, end: Date): number {
  const lo = start.getTime();
  const hi = end.getTime();
  let n = 0;
  // sorted is ascending epoch ms; a linear scan is fine at timeline scale.
  for (const t of sorted) {
    if (t >= lo && t < hi) n++;
    else if (t >= hi) break;
  }
  return n;
}

/** Shade class by event-count intensity, relative to the busiest cell shown. */
function intensityClass(count: number, max: number): string {
  if (count <= 0) return '';
  const ratio = max <= 1 ? 1 : count / max;
  if (ratio > 0.75) return 'bg-gold-500/80 dark:bg-gold-500/80 text-forest-950';
  if (ratio > 0.5) return 'bg-gold-500/60 dark:bg-gold-500/60 text-forest-950';
  if (ratio > 0.25) return 'bg-gold-500/40 dark:bg-gold-500/45 text-forest-950';
  return 'bg-gold-500/25 dark:bg-gold-500/30 text-forest-900 dark:text-cream-100';
}

/** The events whose occurredAt lands in the half-open [start, end), ascending. */
function eventsInRange(events: TimelineEvent[], start: Date, end: Date): TimelineEvent[] {
  const lo = start.getTime();
  const hi = end.getTime();
  return events
    .filter((e) => {
      if (!e.occurredAt) return false;
      const ms = new Date(e.occurredAt).getTime();
      return !Number.isNaN(ms) && ms >= lo && ms < hi;
    })
    .sort((a, b) => (a.occurredAt! < b.occurredAt! ? -1 : 1));
}

function isImageMedia(mime: string | undefined): boolean {
  return !!mime && mime.startsWith('image/');
}

/** A lazy thumbnail for an evidence item on the day-detail popup. Signs the URL
 *  on mount (best-effort); falls back to the item's kind icon. */
function DayThumb({
  firmId,
  caseId,
  path,
  mime,
  fallback,
}: {
  firmId: string;
  caseId: string;
  path: string | null;
  mime: string | undefined;
  fallback: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (path && isImageMedia(mime)) {
      getFirmEvidenceMediaUrl(firmId, caseId, path).then((r) => {
        if (live && r.ok && r.url) setUrl(r.url);
      });
    }
    return () => {
      live = false;
    };
  }, [firmId, caseId, path, mime]);
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-cream-100 ring-1 ring-ink-100 dark:bg-forest-800/50 dark:ring-forest-700/40">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="inline-flex items-center justify-center text-ink-400 dark:text-cream-100/50">{fallback}</span>
      )}
    </span>
  );
}

export function FirmTimelineCalendar({
  events,
  activeRange,
  onSelect,
  firmId,
  caseId,
  onOpenItem,
}: {
  events: TimelineEvent[];
  activeRange: PeriodRange | null;
  onSelect: (range: PeriodRange | null) => void;
  firmId: string;
  caseId: string;
  /** Open an evidence item in the in-window viewer (by event id). */
  onOpenItem: (id: string) => void;
}) {
  const t = useT();
  const [level, setLevel] = useState<CalLevel>('month');
  // The day/hour the user clicked into, with its events listed in a popup.
  const [detail, setDetail] = useState<{ label: string; items: TimelineEvent[] } | null>(null);
  // Anchor: any moment inside the currently shown period.
  const [anchor, setAnchor] = useState<Date>(() => {
    const dated = events.find((e) => e.occurredAt)?.occurredAt;
    return dated ? new Date(dated) : new Date();
  });

  // Ascending epoch-ms list of dated events, plus the undated tally.
  const { sorted, undatedCount } = useMemo(() => {
    const times: number[] = [];
    let undated = 0;
    for (const e of events) {
      if (!e.occurredAt) {
        undated++;
        continue;
      }
      const ms = new Date(e.occurredAt).getTime();
      if (Number.isNaN(ms)) undated++;
      else times.push(ms);
    }
    times.sort((a, b) => a - b);
    return { sorted: times, undatedCount: undated };
  }, [events]);

  const now = useMemo(() => new Date(), []);

  // ── Build the cells for the current level + anchor ──────────────────────
  const { cells, heading, gridCols } = useMemo(() => {
    const out: Cell[] = [];
    let title = '';
    let cols = 7;

    if (level === 'decade') {
      const base = Math.floor(anchor.getUTCFullYear() / 10) * 10;
      title = `${base} to ${base + 9}`;
      cols = 5;
      for (let i = 0; i < 10; i++) {
        const y = base + i;
        const start = utc(y, 0, 1);
        const end = utc(y + 1, 0, 1);
        out.push({
          key: `y${y}`,
          label: String(y),
          start,
          end,
          count: countInRange(sorted, start, end),
          inScope: true,
          isToday: now.getUTCFullYear() === y,
        });
      }
    } else if (level === 'year') {
      const y = anchor.getUTCFullYear();
      title = String(y);
      cols = 4;
      for (let mo = 0; mo < 12; mo++) {
        const start = utc(y, mo, 1);
        const end = utc(y, mo + 1, 1);
        out.push({
          key: `m${y}-${mo}`,
          label: start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
          start,
          end,
          count: countInRange(sorted, start, end),
          inScope: true,
          isToday: now.getUTCFullYear() === y && now.getUTCMonth() === mo,
        });
      }
    } else if (level === 'month') {
      const first = utc(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
      title = first.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      cols = 7;
      const lead = first.getUTCDay();
      const gridStart = new Date(first);
      gridStart.setUTCDate(gridStart.getUTCDate() - lead);
      for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setUTCDate(d.getUTCDate() + i);
        const end = new Date(d);
        end.setUTCDate(end.getUTCDate() + 1);
        const inScope = d.getUTCMonth() === first.getUTCMonth();
        out.push({
          key: `d${d.toISOString().slice(0, 10)}`,
          label: String(d.getUTCDate()),
          start: startOfUTCDay(d),
          end: startOfUTCDay(end),
          count: countInRange(sorted, startOfUTCDay(d), startOfUTCDay(end)),
          inScope,
          isToday: sameUTCDay(d, now),
        });
      }
    } else if (level === 'week') {
      const ws = startOfUTCWeek(anchor);
      const we = new Date(ws);
      we.setUTCDate(we.getUTCDate() + 6);
      title =
        ws.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
        ' to ' +
        we.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      cols = 7;
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setUTCDate(d.getUTCDate() + i);
        const end = new Date(d);
        end.setUTCDate(end.getUTCDate() + 1);
        out.push({
          key: `wd${d.toISOString().slice(0, 10)}`,
          label: String(d.getUTCDate()),
          sub: d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' }),
          start: startOfUTCDay(d),
          end: startOfUTCDay(end),
          count: countInRange(sorted, startOfUTCDay(d), startOfUTCDay(end)),
          inScope: true,
          isToday: sameUTCDay(d, now),
        });
      }
    } else {
      // day -> 24 hours
      const d0 = startOfUTCDay(anchor);
      title = d0.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      cols = 4;
      for (let h = 0; h < 24; h++) {
        const start = utc(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), h);
        const end = new Date(start);
        end.setUTCHours(end.getUTCHours() + 1);
        out.push({
          key: `h${h}`,
          label: start.toLocaleString('en-US', { hour: 'numeric', timeZone: 'UTC' }),
          start,
          end,
          count: countInRange(sorted, start, end),
          inScope: true,
          isToday: sameUTCDay(d0, now) && now.getUTCHours() === h,
        });
      }
    }
    return { cells: out, heading: title, gridCols: cols };
  }, [level, anchor, sorted, now]);

  const maxCount = useMemo(() => cells.reduce((m, c) => Math.max(m, c.count), 0), [cells]);
  const total = useMemo(() => cells.reduce((s, c) => s + (c.inScope ? c.count : 0), 0), [cells]);

  // ── Navigation ──────────────────────────────────────────────────────────
  const step = useCallback(
    (dir: -1 | 1) => {
      setDetail(null);
      setAnchor((a) => {
        if (level === 'decade') return utc(a.getUTCFullYear() + dir * 10, a.getUTCMonth(), 1);
        if (level === 'year') return utc(a.getUTCFullYear() + dir, a.getUTCMonth(), 1);
        if (level === 'month') return addMonthsUTC(a, dir);
        if (level === 'week') {
          const n = new Date(a);
          n.setUTCDate(n.getUTCDate() + dir * 7);
          return n;
        }
        const n = new Date(a);
        n.setUTCDate(n.getUTCDate() + dir);
        return n;
      });
    },
    [level],
  );

  const drillInto = useCallback(
    (cell: Cell) => {
      // The label used when this becomes the chronology filter.
      const filterLabel =
        level === 'decade'
          ? cell.label
          : level === 'year'
            ? cell.start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            : level === 'month' || level === 'week'
              ? cell.start.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
              : cell.start.toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'UTC',
                });
      // A stable anchor key for calendar-period comments, at this cell's grain.
      const iso = cell.start.toISOString();
      const refKey =
        level === 'decade'
          ? iso.slice(0, 4)
          : level === 'year'
            ? iso.slice(0, 7)
            : level === 'month' || level === 'week'
              ? iso.slice(0, 10)
              : iso.slice(0, 13);
      onSelect({ start: iso, end: cell.end.toISOString(), label: filterLabel, refKey });
      // Coarse levels drill one zoom finer along the natural chain. At a day
      // grain (a day cell in month/week, or an hour cell in day view) we open
      // a popup listing that period's evidence instead of drilling further.
      setAnchor(cell.start);
      if (level === 'decade') {
        setDetail(null);
        setLevel('year');
      } else if (level === 'year') {
        setDetail(null);
        setLevel('month');
      } else {
        setDetail({ label: filterLabel, items: eventsInRange(events, cell.start, cell.end) });
      }
    },
    [level, onSelect, events],
  );

  // Cells that carry a weekday sublabel (week grid) need a touch more height.
  const cellMinH = level === 'week' ? 'min-h-[42px]' : level === 'day' ? 'min-h-[34px]' : 'min-h-[36px]';

  return (
    <section className="card p-3 space-y-2" aria-label={t('Calendar')}>
      {/* Level switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 overflow-hidden" role="group" aria-label={t('Zoom level')}>
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => { setDetail(null); setLevel(l.value); }}
              aria-pressed={level === l.value}
              className={
                (level === l.value
                  ? 'bg-forest-900/10 dark:bg-cream-100/10 font-semibold text-forest-900 dark:text-cream-100 '
                  : 'text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                'px-2 py-0.5 text-[11px] transition-colors'
              }
            >
              <T>{l.label}</T>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('Previous')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/80 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            type="button"
            onClick={() => { setDetail(null); setAnchor(new Date()); }}
            className="rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2 py-0.5 text-[11px] text-ink-700 dark:text-cream-100/80 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <T>Today</T>
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('Next')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/80 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {/* Heading */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-forest-900 dark:text-cream-100" data-no-translate>
          {heading}
        </h3>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          {total} <T>in view</T>
        </p>
      </div>

      {/* Weekday header for day-grid levels */}
      {(level === 'month' || level === 'week') && (
        <div className="grid grid-cols-7 gap-1 text-center text-[9.5px] text-ink-400 dark:text-cream-100/45">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {/* Cells */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
      >
        {cells.map((c) => {
          const shade = intensityClass(c.count, maxCount);
          const isActive =
            activeRange &&
            c.start.toISOString() === activeRange.start &&
            c.end.toISOString() === activeRange.end;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => drillInto(c)}
              aria-label={`${c.label}${c.sub ? ' ' + c.sub : ''} · ${c.count} ${c.count === 1 ? t('event') : t('events')}`}
              title={`${c.count} ${c.count === 1 ? t('event') : t('events')}`}
              className={
                'relative ' + cellMinH + ' rounded p-1 text-left transition-colors ' +
                'ring-1 ' +
                (isActive
                  ? 'ring-2 ring-forest-900 dark:ring-gold-400 '
                  : 'ring-ink-100 dark:ring-forest-700/40 ') +
                (c.inScope ? '' : 'opacity-35 ') +
                (shade || 'hover:bg-cream-50 dark:hover:bg-forest-800/40 ') +
                (c.count > 0 ? 'font-medium ' : 'text-ink-500 dark:text-cream-100/55 ')
              }
            >
              <span className="flex items-start justify-between gap-0.5">
                <span className="text-[10px] leading-none" data-no-translate>{c.label}</span>
                {c.isToday && (
                  <span className="h-1 w-1 rounded-full bg-forest-900 dark:bg-gold-400" aria-hidden />
                )}
              </span>
              {c.sub && (
                <span className="block text-[8.5px] text-current/70 leading-none mt-0.5" data-no-translate>{c.sub}</span>
              )}
              {c.count > 0 && (
                <span className="absolute bottom-0.5 right-0.5 inline-flex min-w-[13px] items-center justify-center rounded-full bg-forest-900/85 dark:bg-forest-950/70 px-1 text-[8.5px] font-semibold text-cream-50 dark:text-cream-100 leading-tight">
                  {c.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Day detail: the clicked day/hour's evidence, with thumbnails + open. */}
      {detail && (
        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/60 dark:bg-forest-800/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-forest-900 dark:text-cream-100">
              <span data-no-translate>{detail.label}</span>{' '}
              <span className="text-ink-400 dark:text-cream-100/45">({detail.items.length})</span>
            </p>
            <button
              type="button"
              onClick={() => setDetail(null)}
              aria-label={t('Close')}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          {detail.items.length === 0 ? (
            <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55"><T>No evidence on this day.</T></p>
          ) : (
            <ul className="space-y-1.5">
              {detail.items.map((e) => {
                const m = e.media[0];
                return (
                  <li key={e.id} className="flex items-center gap-2.5 rounded-md bg-white/70 dark:bg-forest-900/40 ring-1 ring-ink-100 dark:ring-forest-700/30 px-2 py-1.5">
                    <DayThumb
                      firmId={firmId}
                      caseId={caseId}
                      path={m?.path ?? null}
                      mime={m?.mime}
                      fallback={<KindIcon kind={e.kind} className="h-4 w-4" />}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[12px] font-medium text-forest-900 dark:text-cream-100">
                        <span className="break-words" data-no-translate>{e.title || t('(untitled)')}</span>
                        <RelevanceBadge score={e.aiExtracted.relevance_score} reason={e.aiExtracted.relevance_reason} size="xs" />
                      </span>
                      <span className="block text-[10.5px] text-ink-500 dark:text-cream-100/55" data-no-translate>
                        {formatOccurred(e.occurredAt, e.occurredPrecision)}
                        {' · '}
                        {KIND_LABEL[e.kind]}
                      </span>
                    </span>
                    {m && (
                      <button
                        type="button"
                        onClick={() => onOpenItem(e.id)}
                        className="shrink-0 inline-flex items-center min-h-[28px] px-2.5 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-[11.5px] hover:bg-cream-50 dark:hover:bg-forest-800/30"
                      >
                        <T>Open</T>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Legend + undated + active filter */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 text-[10px] text-ink-500 dark:text-cream-100/55">
          <T>Fewer</T>
          <span className="h-2.5 w-2.5 rounded-sm bg-gold-500/25" />
          <span className="h-2.5 w-2.5 rounded-sm bg-gold-500/45" />
          <span className="h-2.5 w-2.5 rounded-sm bg-gold-500/60" />
          <span className="h-2.5 w-2.5 rounded-sm bg-gold-500/80" />
          <T>More</T>
        </div>
        {undatedCount > 0 && (
          <p className="text-[10px] text-ink-400 dark:text-cream-100/45">
            {undatedCount} <T>undated</T>
          </p>
        )}
      </div>
    </section>
  );
}
