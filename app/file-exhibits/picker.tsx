'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Jurisdiction } from '@/lib/jurisdictions';
import { STATE_CENTROIDS, haversineKm } from '@/lib/state-centroids';

const PRO_SE_LABELS: Record<Jurisdiction['proSeAllowed'], string> = {
  yes: 'Pro se filing supported',
  limited: 'Pro se filing limited',
  no: 'Attorneys only',
  'paper-fallback': 'File on paper',
};

const PRO_SE_TONES: Record<Jurisdiction['proSeAllowed'], string> = {
  yes: 'bg-forest-900/10 text-forest-900 dark:bg-forest-900/40 dark:text-cream-100',
  limited: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  no: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
  'paper-fallback': 'bg-ink-100 text-ink-700 dark:bg-forest-800/60 dark:text-cream-100/80',
};

export function FileExhibitsPicker({ states }: { states: Jurisdiction[] }) {
  const [code, setCode] = useState<string>('');
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'asking' | 'denied' | 'unsupported' | 'ok'>(
    'idle',
  );

  // Best-effort geolocation. We never auto-prompt - the user has to
  // click "Use my location" first - because asking for GPS on the
  // file-exhibits page out of nowhere reads as creepy. Once the user
  // opts in we sort the picker by Haversine distance from their
  // coords to each state's capital centroid.
  function requestLocation() {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoStatus('unsupported');
      return;
    }
    setGeoStatus('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus('ok');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeoStatus('denied');
        else setGeoStatus('idle');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60 * 1000 },
    );
  }

  // If the user already opted into geolocation on another page,
  // re-use it silently. Permissions API is widely supported but
  // gracefully no-ops where not.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('permissions' in navigator)) return;
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') requestLocation();
      })
      .catch(() => {
        /* permissions API rejected - no-op */
      });
  }, []);

  const ordered = useMemo(() => {
    // No coords = alphabetical (default behavior, matches v1.0.1).
    if (!coords) {
      return [...states].sort((a, b) => a.name.localeCompare(b.name));
    }
    // With coords, score each state by distance from the user's
    // location to that state's capital centroid. Federal sorts to
    // the bottom (it's not bound to one place). States with no
    // centroid in our table fall back to a huge distance so they
    // sink to the end - we don't have data on them either way.
    return [...states]
      .map((s) => {
        const c = STATE_CENTROIDS[s.code];
        const distance = c ? haversineKm(coords, c) : Number.POSITIVE_INFINITY;
        return { s, distance };
      })
      .sort((a, b) => a.distance - b.distance)
      .map((x) => x.s);
  }, [states, coords]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    // Defensive coercion (audit V2-1): each field is typed `string` but
    // tests / fixture rows can produce null. `.toLowerCase()` on null
    // throws a hard crash that propagates to the React tree.
    return ordered.filter(
      (s) =>
        String(s.name ?? '').toLowerCase().includes(q) ||
        String(s.code ?? '').toLowerCase().includes(q) ||
        String(s.courtName ?? '').toLowerCase().includes(q),
    );
  }, [ordered, query]);

  const selected = ordered.find((s) => s.code === code);

  return (
    <section className="space-y-5">
      <div className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="eyebrow mb-1">State courts</p>
            <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
              Pick your state
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!coords && geoStatus !== 'unsupported' && geoStatus !== 'denied' && (
              <button
                type="button"
                onClick={requestLocation}
                disabled={geoStatus === 'asking'}
                className="btn-ghost text-[12.5px] inline-flex items-center gap-1.5"
                aria-label="Sort states by distance to me"
              >
                <PinIcon />
                {geoStatus === 'asking' ? 'Locating...' : 'Use my location'}
              </button>
            )}
            {coords && (
              <span className="text-[11px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                <PinIcon />
                Sorted by distance to you
              </span>
            )}
            {geoStatus === 'denied' && (
              <span className="text-[11px] text-ink-500 dark:text-cream-100/55">
                Location blocked - sorted alphabetically.
              </span>
            )}
            {selected && (
              <button
                type="button"
                onClick={() => setCode('')}
                className="btn-ghost text-[12.5px]"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="sr-only">Search states</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search state, court, or 2-letter code"
              className="input w-full"
            />
          </label>
          <label className="block">
            <span className="sr-only">Choose state</span>
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input w-full sm:w-[280px]"
              aria-label="Choose state"
            >
              <option value="">Choose state...</option>
              {filtered.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!selected && (
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
            {filtered.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  onClick={() => setCode(s.code)}
                  className="w-full text-left rounded-lg border border-ink-200 dark:border-forest-700/40 px-3 py-2 hover:bg-ink-50/60 dark:hover:bg-forest-800/40 transition-colors"
                >
                  <span className="font-medium text-forest-900 dark:text-cream-100">
                    {s.name}
                  </span>
                  <span className="ml-2 text-ink-500 dark:text-cream-100/55">{s.code}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="col-span-full text-sm text-ink-500 dark:text-cream-100/55">
                No matches.
              </li>
            )}
          </ul>
        )}
      </div>

      {selected && <Detail jurisdiction={selected} />}
    </section>
  );
}

function Detail({ jurisdiction: j }: { jurisdiction: Jurisdiction }) {
  return (
    <article className="card p-6 sm:p-7 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{j.name}</p>
          <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
            {j.courtName}
          </h3>
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.18em] font-semibold rounded-full px-2.5 py-1 ${PRO_SE_TONES[j.proSeAllowed]}`}
        >
          {PRO_SE_LABELS[j.proSeAllowed]}
        </span>
      </header>

      <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">{j.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={j.portalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-4 py-2 text-[13px]"
        >
          Open the e-filing portal
        </a>
        {j.selfHelpUrl && (
          <a
            href={j.selfHelpUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary text-[13px] px-4 py-2"
          >
            Self-help center
          </a>
        )}
        {j.feeWaiver?.url && (
          <a
            href={j.feeWaiver.url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary text-[13px] px-4 py-2"
          >
            Fee waiver form
          </a>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 text-sm">
        <Field label="Accepted formats" value={j.formats} />
        <Field label="Service of process" value={j.service} />
        {j.feeWaiver && !j.feeWaiver.url && (
          <Field label="Fee waiver" value={j.feeWaiver.label} />
        )}
      </dl>

      {j.notes.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300 mb-2">
            What to know
          </p>
          <ul className="list-disc list-outside pl-5 text-[13px] text-ink-600 dark:text-cream-100/75 space-y-1.5 leading-relaxed">
            {j.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        We share this as a starting point. Court rules change quietly: confirm everything against
        the court&apos;s own page before you file. Advottic does not provide legal advice.
      </p>
    </article>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {label}
      </dt>
      <dd className="text-[13.5px] text-ink-700 dark:text-cream-100/80 mt-1 leading-relaxed">
        {value}
      </dd>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
