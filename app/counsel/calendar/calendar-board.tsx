'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from '@/components/ExternalLink';

export type BoardEvent = {
  at: number;
  endAt?: number;
  kind: 'meeting' | 'deadline' | 'reminder' | 'synced';
  title: string;
  sub: string;
  href: string;
  external: boolean;
};

const KIND_DOT: Record<BoardEvent['kind'], string> = {
  meeting: 'bg-gold-500',
  deadline: 'bg-rose-500',
  reminder: 'bg-ink-400 dark:bg-cream-100/40',
  synced: 'bg-sky-500',
};

const KIND_CHIP: Record<BoardEvent['kind'], string> = {
  meeting:
    'bg-gold-500/15 text-gold-700 dark:text-gold-200 ring-gold-500/30',
  deadline:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  reminder:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  synced:
    'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200 ring-sky-200 dark:ring-sky-700/40',
};

const KIND_LABEL: Record<BoardEvent['kind'], string> = {
  meeting: 'meeting',
  deadline: 'deadline',
  reminder: 'reminder',
  synced: 'outlook',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local midnight of a timestamp, as epoch ms - the day bucket key. */
function dayKey(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function CalendarBoard({
  events,
  hasSync,
}: {
  events: BoardEvent[];
  hasSync: boolean;
}) {
  const [view, setView] = useState<'month' | 'agenda'>('month');
  // `cursor` is local midnight of the first day of the visible month.
  const [cursor, setCursor] = useState<number>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  const todayKey = dayKey(Date.now());
  const [selected, setSelected] = useState<number>(todayKey);

  // Bucket events by local day for O(1) lookup while rendering cells.
  const byDay = useMemo(() => {
    const m = new Map<number, BoardEvent[]>();
    for (const e of events) {
      const k = dayKey(e.at);
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.at - b.at);
    return m;
  }, [events]);

  const cursorDate = new Date(cursor);
  const monthLabel = cursorDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  // Build the 6-week grid starting on the Sunday on/before the 1st.
  const gridStart = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(1 - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [cursor]);

  const cells = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < 42; i++) {
      out.push(gridStart + i * 24 * 3600_000);
    }
    return out;
  }, [gridStart]);

  function shiftMonth(delta: number) {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + delta);
    setCursor(d.getTime());
  }
  function goToday() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    setCursor(d.getTime());
    setSelected(todayKey);
  }

  const selectedEvents = byDay.get(selected) ?? [];

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
            aria-label="Next month"
          >
            ›
          </button>
          <p className="font-display text-lg font-medium text-forest-900 dark:text-cream-100 ml-1 min-w-[9ch]">
            {monthLabel}
          </p>
          <button
            type="button"
            onClick={goToday}
            className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2.5 py-1.5 text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
          >
            Today
          </button>
        </div>
        <div
          className="inline-flex rounded-md ring-1 ring-ink-200 dark:ring-forest-700/60 overflow-hidden text-[12px]"
          role="group"
          aria-label="Calendar view"
        >
          <button
            type="button"
            onClick={() => setView('month')}
            aria-pressed={view === 'month'}
            className={`px-3 py-1.5 ${view === 'month' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setView('agenda')}
            aria-pressed={view === 'agenda'}
            className={`px-3 py-1.5 ${view === 'agenda' ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950' : 'text-ink-700 dark:text-cream-100/85'}`}
          >
            Agenda
          </button>
        </div>
      </div>

      {view === 'month' ? (
        <>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-400 dark:text-cream-100/40 text-center pb-1"
              >
                <span className="hidden sm:inline">{w}</span>
                <span className="sm:hidden">{w[0]}</span>
              </div>
            ))}
            {cells.map((cellMs) => {
              const inMonth =
                new Date(cellMs).getMonth() === cursorDate.getMonth();
              const isToday = cellMs === todayKey;
              const isSelected = cellMs === selected;
              const dayEvents = byDay.get(cellMs) ?? [];
              return (
                <button
                  key={cellMs}
                  type="button"
                  onClick={() => setSelected(cellMs)}
                  className={`min-h-[68px] sm:min-h-[92px] rounded-md p-1 sm:p-1.5 text-left ring-1 transition-colors flex flex-col gap-1 ${
                    isSelected
                      ? 'ring-forest-900/40 dark:ring-gold-400/40 bg-cream-50 dark:bg-forest-800/40'
                      : 'ring-ink-100 dark:ring-forest-700/30 hover:bg-cream-50/60 dark:hover:bg-forest-800/25'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span
                    className={`text-[11px] font-semibold inline-flex h-5 w-5 items-center justify-center rounded-full ${
                      isToday
                        ? 'bg-forest-900 text-white dark:bg-gold-400 dark:text-forest-950'
                        : 'text-ink-700 dark:text-cream-100/80'
                    }`}
                  >
                    {new Date(cellMs).getDate()}
                  </span>
                  {/* Chips on sm+, dots on mobile. */}
                  <span className="hidden sm:flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((e, i) => (
                      <span
                        key={i}
                        className={`truncate text-[10px] leading-tight px-1 py-[1px] rounded ring-1 ${KIND_CHIP[e.kind]}`}
                        title={e.title}
                      >
                        {e.title}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[9px] text-ink-500 dark:text-cream-100/50 pl-1">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </span>
                  <span className="flex sm:hidden flex-wrap gap-0.5 mt-auto">
                    {dayEvents.slice(0, 4).map((e, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[e.kind]}`}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected-day detail */}
          <div className="border-t border-ink-100 dark:border-forest-700/40 pt-3">
            <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-500 dark:text-cream-100/70 mb-2">
              {new Date(selected).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            {selectedEvents.length === 0 ? (
              <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
                Nothing scheduled this day.
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedEvents.map((e, i) => (
                  <EventRow key={i} e={e} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <AgendaView events={events} />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
        <Legend dot={KIND_DOT.meeting} label="Meeting" />
        <Legend dot={KIND_DOT.deadline} label="Deadline" />
        <Legend dot={KIND_DOT.reminder} label="Reminder" />
        {hasSync && <Legend dot={KIND_DOT.synced} label="Outlook" />}
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function EventRow({ e }: { e: BoardEvent }) {
  const inner = (
    <>
      <div className="min-w-0">
        <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
          {e.title}
        </p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
          {new Date(e.at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {e.sub}
        </p>
      </div>
      <span
        className={`shrink-0 inline-flex items-center px-2 py-[2px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${KIND_CHIP[e.kind]}`}
      >
        {KIND_LABEL[e.kind]}
      </span>
    </>
  );
  const noLink = !e.href || e.href === '#';
  return (
    <li className="rounded-lg ring-1 ring-ink-100 dark:ring-forest-700/30 p-3 hover:bg-cream-50/60 dark:hover:bg-forest-800/25 transition-colors">
      {noLink ? (
        <div className="flex items-center justify-between gap-3">{inner}</div>
      ) : e.external ? (
        <ExternalLink
          href={e.href}
          className="flex items-center justify-between gap-3"
        >
          {inner}
        </ExternalLink>
      ) : (
        <Link href={e.href} className="flex items-center justify-between gap-3">
          {inner}
        </Link>
      )}
    </li>
  );
}

function AgendaView({ events }: { events: BoardEvent[] }) {
  const now = Date.now();
  const upcoming = events
    .filter((e) => e.at >= now - 24 * 3600_000)
    .sort((a, b) => a.at - b.at);
  const groups = new Map<string, BoardEvent[]>();
  for (const e of upcoming) {
    const key = new Date(e.at).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }
  if (upcoming.length === 0) {
    return (
      <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
        Nothing upcoming. Schedule a meeting or add a deadline on a case.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([day, dayItems]) => (
        <section key={day} className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-500 dark:text-cream-100/70">
            {day}
          </p>
          <ul className="space-y-2">
            {dayItems.map((e, i) => (
              <EventRow key={i} e={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
