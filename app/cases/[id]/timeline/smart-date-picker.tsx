'use client';

import { useId, useMemo, useState } from 'react';
import { PRECISION_GRAINS, type OccurredPrecision } from '@/lib/timeline-types';

/**
 * Smart timeline picker. The user first chooses how precisely they can place a
 * moment — second, minute, hour, day, week, month, year, or undated — and the
 * field adapts to ask for exactly that much and no more. It stores a full UTC
 * timestamp plus the chosen grain, so the timeline can render "2:07:33 PM" or
 * just "March 2023" from the same value. Wall-clock entries are treated as UTC
 * so what the user types is what every view (and the court PDF) shows back.
 */

export type PickerValue = { occurredAt: string | null; precision: OccurredPrecision };

// Grains offered in the compact (personal) variant — no sub-day noise.
const MINIMAL_GRAINS: OccurredPrecision[] = ['day', 'week', 'month', 'year', 'unknown'];

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Break an ISO timestamp into the UTC field pieces the inputs bind to. */
function partsFromIso(iso: string | null) {
  const d = iso ? new Date(iso) : null;
  const ok = d && !Number.isNaN(d.getTime());
  return {
    date: ok ? `${d!.getUTCFullYear()}-${pad(d!.getUTCMonth() + 1)}-${pad(d!.getUTCDate())}` : '',
    month: ok ? `${d!.getUTCFullYear()}-${pad(d!.getUTCMonth() + 1)}` : '',
    year: ok ? String(d!.getUTCFullYear()) : '',
    hour: ok ? d!.getUTCHours() : 9,
    minute: ok ? pad(d!.getUTCMinutes()) : '00',
    second: ok ? pad(d!.getUTCSeconds()) : '00',
    datetimeMin: ok ? `${d!.getUTCFullYear()}-${pad(d!.getUTCMonth() + 1)}-${pad(d!.getUTCDate())}T${pad(d!.getUTCHours())}:${pad(d!.getUTCMinutes())}` : '',
    datetimeSec: ok ? `${d!.getUTCFullYear()}-${pad(d!.getUTCMonth() + 1)}-${pad(d!.getUTCDate())}T${pad(d!.getUTCHours())}:${pad(d!.getUTCMinutes())}:${pad(d!.getUTCSeconds())}` : '',
  };
}

const inputCls =
  'rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-forest-900 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 dark:border-cream-50/20 dark:bg-forest-950 dark:text-cream-100';

export function SmartDatePicker({
  value,
  precision,
  onChange,
  minimal = false,
}: {
  value: string | null;
  precision: OccurredPrecision;
  onChange: (next: PickerValue) => void;
  minimal?: boolean;
}) {
  const uid = useId();
  const p = useMemo(() => partsFromIso(value), [value]);
  const [grain, setGrain] = useState<OccurredPrecision>(precision);

  const grains = minimal
    ? PRECISION_GRAINS.filter((g) => MINIMAL_GRAINS.includes(g.value))
    : PRECISION_GRAINS;

  // Recompute the stored ISO for a grain from the current field values.
  function emit(nextGrain: OccurredPrecision, overrides: Partial<ReturnType<typeof partsFromIso>> = {}) {
    const f = { ...p, ...overrides };
    let occurredAt: string | null = null;
    switch (nextGrain) {
      case 'unknown':
        occurredAt = null;
        break;
      case 'year':
        occurredAt = f.year ? `${f.year.padStart(4, '0')}-01-01T00:00:00Z` : null;
        break;
      case 'month':
        occurredAt = f.month ? `${f.month}-01T00:00:00Z` : null;
        break;
      case 'week':
      case 'day':
        occurredAt = f.date ? `${f.date}T00:00:00Z` : null;
        break;
      case 'hour':
        occurredAt = f.date ? `${f.date}T${pad(f.hour)}:00:00Z` : null;
        break;
      case 'minute':
      case 'exact':
        occurredAt = f.datetimeMin ? `${f.datetimeMin}:00Z` : null;
        break;
      case 'second':
        occurredAt = f.datetimeSec ? `${f.datetimeSec}Z` : null;
        break;
    }
    onChange({ occurredAt, precision: nextGrain });
  }

  function pick(nextGrain: OccurredPrecision) {
    setGrain(nextGrain);
    emit(nextGrain);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {grains.map((g) => (
          <button
            key={g.value}
            type="button"
            onClick={() => pick(g.value)}
            title={g.hint}
            aria-pressed={grain === g.value}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              grain === g.value
                ? 'bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950'
                : 'bg-forest-900/5 text-ink-600 hover:bg-forest-900/10 dark:bg-cream-50/10 dark:text-cream-300 dark:hover:bg-cream-50/15'
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {grain === 'unknown' && (
          <span className="text-xs text-ink-500 dark:text-cream-300/70">No date — this entry sorts to the end until dated.</span>
        )}

        {grain === 'year' && (
          <input
            type="number" min={1900} max={2200} placeholder="Year" defaultValue={p.year}
            onChange={(e) => emit('year', { year: e.target.value })}
            className={`${inputCls} w-28`} aria-label="Year"
          />
        )}

        {grain === 'month' && (
          <input
            type="month" defaultValue={p.month}
            onChange={(e) => emit('month', { month: e.target.value })}
            className={inputCls} aria-label="Month"
          />
        )}

        {(grain === 'day' || grain === 'week') && (
          <input
            type="date" defaultValue={p.date}
            onChange={(e) => emit(grain, { date: e.target.value })}
            className={inputCls} aria-label={grain === 'week' ? 'A day in the week' : 'Date'}
          />
        )}

        {grain === 'hour' && (
          <>
            <input
              type="date" defaultValue={p.date}
              onChange={(e) => emit('hour', { date: e.target.value })}
              className={inputCls} aria-label="Date"
            />
            <select
              defaultValue={String(p.hour)}
              onChange={(e) => emit('hour', { hour: Number(e.target.value) })}
              className={inputCls} aria-label="Hour"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${((h % 12) || 12)}:00 ${h < 12 ? 'AM' : 'PM'}`}</option>
              ))}
            </select>
          </>
        )}

        {(grain === 'minute' || grain === 'exact') && (
          <input
            id={`${uid}-min`}
            type="datetime-local" defaultValue={p.datetimeMin}
            onChange={(e) => emit('minute', { datetimeMin: e.target.value })}
            className={inputCls} aria-label="Date and time"
          />
        )}

        {grain === 'second' && (
          <input
            id={`${uid}-sec`}
            type="datetime-local" step={1} defaultValue={p.datetimeSec}
            onChange={(e) => emit('second', { datetimeSec: e.target.value })}
            className={inputCls} aria-label="Date and time to the second"
          />
        )}

        {grain !== 'unknown' && grain !== 'second' && grain !== 'minute' && grain !== 'exact' && (
          <span className="text-[11px] text-ink-400 dark:text-cream-300/50">Times are recorded in UTC.</span>
        )}
      </div>
    </div>
  );
}
