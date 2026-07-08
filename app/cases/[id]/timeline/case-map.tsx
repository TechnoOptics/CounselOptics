'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { relevanceBand } from '@/lib/timeline-types';

/**
 * Live case map with a breadcrumb time-slider. Every geocoded pin carries the
 * time of its event and the people tagged to it, so the map can trace a route:
 * scrub the slider along the checkpoints and the trail fills in point by point,
 * a moving marker shows "here, then", and a path connects the movements in
 * chronological order. Filter to one person to follow just their movements, or
 * press play to watch the whole thing animate.
 *
 * Gated on NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: with no key it renders nothing, so
 * the timeline is unaffected until the key is present.
 */

export type MapPoint = {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'place';
  time?: string | null; // ISO occurredAt of the owning event
  when?: string; // human label, e.g. "March 14, 2023, 2:07 PM"
  people?: string[]; // names tagged to the event
  title?: string; // event title
  relevance?: number; // 0-100 relevance of the owning event to the case
};

/** Marker opacity by relevance band: low pins are de-emphasised, not hidden. */
function relevanceOpacity(rel: number | undefined): number {
  const band = relevanceBand(rel);
  if (band === 'low') return 0.4;
  if (band === 'medium') return 0.8;
  return 1; // high or unscored: full strength
}

const MAP_STYLE = [
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f4f1ea' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dcd3' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#6f6f6f' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e7e2d6' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#0f2d24' }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#0f2d24' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

type LatLng = { lat: number; lng: number };
type GMarker = { setMap(m: unknown): void };
type GMap = { fitBounds(b: unknown, padding?: number): void; setCenter(c: LatLng): void; setZoom(z: number): void; panTo(c: LatLng): void };
type GMaps = {
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => GMap;
  Marker: new (opts: Record<string, unknown>) => GMarker;
  Polyline: new (opts: Record<string, unknown>) => GMarker;
  LatLngBounds: new () => { extend(p: LatLng): void };
  InfoWindow: new (opts: Record<string, unknown>) => { open(map: GMap, anchor: unknown): void; setContent(c: string): void };
  SymbolPath: { CIRCLE: number };
  event: { addListener(target: unknown, ev: string, cb: () => void): void };
};
function gmaps(): GMaps | null {
  const g = (window as unknown as { google?: { maps?: GMaps } }).google;
  return g?.maps ?? null;
}

let loaderPromise: Promise<void> | null = null;
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (gmaps()) return Promise.resolve();
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('maps load failed')));
      if (gmaps()) resolve();
      return;
    }
    const s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.dataset.googleMaps = '1';
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&v=weekly`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('maps load failed'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function CaseMap({ points, title = 'Case map' }: { points: MapPoint[]; title?: string }) {
  const key = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<GMarker[]>([]);
  const pathRef = useRef<GMarker | null>(null);
  const infoRef = useRef<{ open(map: GMap, anchor: unknown): void; setContent(c: string): void } | null>(null);
  const lastFitRef = useRef<string>('');
  const [failed, setFailed] = useState(false);

  // Everyone who appears on a timed, located point — the person filter.
  const [person, setPerson] = useState<string | null>(null);
  // Optionally hide points whose owning event scored low relevance to the case.
  const [focusRelevant, setFocusRelevant] = useState(false);
  const hasLowRelevance = useMemo(
    () => points.some((p) => relevanceBand(p.relevance) === 'low'),
    [points],
  );
  const keepByRelevance = (p: MapPoint) => !focusRelevant || relevanceBand(p.relevance) !== 'low';

  const allPeople = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) for (const n of p.people ?? []) if (n) set.add(n);
    return [...set].sort();
  }, [points]);

  // Timed + located points, sorted chronologically; these drive the slider.
  const timed = useMemo(() => {
    const list = points
      .filter((p) => p.time && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .filter((p) => !person || (p.people ?? []).includes(person))
      .filter(keepByRelevance)
      .map((p) => ({ ...p, t: new Date(p.time as string).getTime() }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, person, focusRelevant]);

  // Located-but-undated points: shown faintly, always, since they have no place
  // on the time slider.
  const undated = useMemo(
    () => points.filter((p) => !p.time && Number.isFinite(p.lat) && Number.isFinite(p.lng) && (!person || (p.people ?? []).includes(person)) && keepByRelevance(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, person, focusRelevant],
  );

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const filterSig = useMemo(() => `${person ?? '*'}|${timed.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)},${p.t}`).join(';')}`, [person, timed]);

  // Reset the cursor to the end whenever the filtered set changes.
  useEffect(() => {
    setCursor(timed.length ? timed.length - 1 : 0);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig]);

  // Play: advance the cursor along the checkpoints.
  useEffect(() => {
    if (!playing || timed.length < 2) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c >= timed.length - 1) { window.clearInterval(id); setPlaying(false); return c; }
        return c + 1;
      });
    }, 1100);
    return () => window.clearInterval(id);
  }, [playing, timed.length]);

  const hasAny = timed.length > 0 || undated.length > 0;

  // Draw / redraw the map for the current cursor.
  useEffect(() => {
    if (!key || !boxRef.current || !hasAny) return;
    let cancelled = false;
    loadMaps(key)
      .then(() => {
        const maps = gmaps();
        if (cancelled || !maps || !boxRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new maps.Map(boxRef.current, {
            styles: MAP_STYLE,
            disableDefaultUI: true,
            zoomControl: true,
            gestureHandling: 'cooperative',
            backgroundColor: '#f4f1ea',
          });
          infoRef.current = new maps.InfoWindow({});
        }
        const map = mapRef.current;
        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        if (pathRef.current) { pathRef.current.setMap(null); pathRef.current = null; }

        const visibleTimed = timed.slice(0, cursor + 1);

        // Breadcrumb path connecting movements up to the cursor.
        if (visibleTimed.length >= 2) {
          pathRef.current = new maps.Polyline({
            path: visibleTimed.map((p) => ({ lat: p.lat, lng: p.lng })),
            geodesic: true,
            strokeColor: '#c9a227',
            strokeOpacity: 0.9,
            strokeWeight: 2.5,
            map,
          });
        }

        const openInfo = (p: MapPoint, marker: GMarker) => {
          if (!infoRef.current) return;
          const who = (p.people ?? []).length ? `<div style="color:#0f2d24;margin-top:2px">${escapeHtml((p.people ?? []).join(', '))}</div>` : '';
          const when = p.when ? `<div style="color:#8a8a8a;margin-top:2px">${escapeHtml(p.when)}</div>` : '';
          infoRef.current.setContent(
            `<div style="font:500 12px/1.4 system-ui;max-width:230px"><div style="color:#0f2d24;font-weight:600">${escapeHtml(p.title || p.label)}</div><div style="color:#6f6f6f">${escapeHtml(p.label)}</div>${who}${when}</div>`,
          );
          infoRef.current.open(map, marker);
        };

        // Undated located points: faint, always shown.
        for (const p of undated) {
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng }, map, title: p.label, opacity: 0.55 * relevanceOpacity(p.relevance),
            icon: { path: maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#9aa39d', fillOpacity: 0.8, strokeColor: '#ffffff', strokeWeight: 1.5 },
          });
          maps.event.addListener(marker, 'click', () => openInfo(p, marker));
          markersRef.current.push(marker);
        }

        // Timed breadcrumbs up to the cursor; the last is the "current" stop.
        visibleTimed.forEach((p, i) => {
          const isCurrent = i === visibleTimed.length - 1;
          // The current stop is always full strength; earlier stops fade with
          // low case-relevance so the eye follows the pins that matter.
          const marker = new maps.Marker({
            position: { lat: p.lat, lng: p.lng }, map, title: p.label,
            zIndex: isCurrent ? 999 : i,
            opacity: isCurrent ? 1 : relevanceOpacity(p.relevance),
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: isCurrent ? 9 : 6,
              fillColor: isCurrent ? '#0f2d24' : '#c9a227',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: isCurrent ? 3 : 2,
            },
          });
          maps.event.addListener(marker, 'click', () => openInfo(p, marker));
          markersRef.current.push(marker);
        });

        // Fit bounds once per filter change (stable frame while scrubbing);
        // gently pan to the current stop as the cursor moves.
        const allForFit = [...timed, ...undated];
        if (lastFitRef.current !== filterSig && allForFit.length) {
          lastFitRef.current = filterSig;
          if (allForFit.length === 1) {
            map.setCenter({ lat: allForFit[0].lat, lng: allForFit[0].lng });
            map.setZoom(14);
          } else {
            const bounds = new maps.LatLngBounds();
            allForFit.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
            map.fitBounds(bounds, 56);
          }
        } else if (visibleTimed.length) {
          const cur = visibleTimed[visibleTimed.length - 1];
          map.panTo({ lat: cur.lat, lng: cur.lng });
        }
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filterSig, cursor, hasAny]);

  if (!key || !hasAny || failed) return null;

  const current = timed[cursor];
  const showSlider = timed.length >= 2;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-forest-900/10 bg-white shadow-card dark:border-cream-50/10 dark:bg-forest-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-forest-900/10 bg-forest-900/[0.02] px-5 py-3 dark:border-cream-50/10 dark:bg-cream-50/[0.03]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-500">{title}</p>
        <p className="text-xs text-ink-500 dark:text-cream-300/70">
          {timed.length} timed {timed.length === 1 ? 'point' : 'points'}{undated.length ? ` · ${undated.length} undated` : ''}
        </p>
      </div>

      {/* Relevance focus toggle */}
      {hasLowRelevance && (
        <div className="flex items-center justify-end border-b border-forest-900/10 px-5 py-2 dark:border-cream-50/10">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-ink-500 dark:text-cream-300/70">
            <input
              type="checkbox"
              checked={focusRelevant}
              onChange={(e) => setFocusRelevant(e.target.checked)}
              className="h-3.5 w-3.5 accent-forest-700"
            />
            Hide low-relevance pins
          </label>
        </div>
      )}

      {/* Person filter */}
      {allPeople.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-forest-900/10 px-5 py-2.5 dark:border-cream-50/10">
          <span className="mr-1 self-center text-[11px] font-medium text-ink-400 dark:text-cream-300/50">Follow:</span>
          <button
            type="button" onClick={() => setPerson(null)} aria-pressed={person === null}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${person === null ? 'bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950' : 'bg-forest-900/5 text-ink-600 hover:bg-forest-900/10 dark:bg-cream-50/10 dark:text-cream-300'}`}
          >
            Everyone
          </button>
          {allPeople.map((name) => (
            <button
              key={name} type="button" onClick={() => setPerson(name)} aria-pressed={person === name}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${person === name ? 'bg-forest-900 text-cream-50 dark:bg-gold-metal dark:text-forest-950' : 'bg-forest-900/5 text-ink-600 hover:bg-forest-900/10 dark:bg-cream-50/10 dark:text-cream-300'}`}
              data-no-translate
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div ref={boxRef} className="h-80 w-full" data-no-translate />

      {/* Time scrubber with checkpoint marks */}
      {showSlider && (
        <div className="border-t border-forest-900/10 px-5 py-3 dark:border-cream-50/10">
          <div className="mb-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (cursor >= timed.length - 1) { setCursor(0); setPlaying(true); }
                else setPlaying((p) => !p);
              }}
              className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-forest-900 text-cream-50 hover:bg-forest-800 dark:bg-gold-metal dark:text-forest-950"
              aria-label={playing ? 'Pause' : 'Play movements'}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range" min={0} max={timed.length - 1} step={1} value={cursor}
                onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
                className="adv-timeslider w-full"
                style={{ ['--adv-fill' as string]: `${timed.length > 1 ? (cursor / (timed.length - 1)) * 100 : 100}%` }}
                aria-label="Scrub through time"
              />
            </div>
            <span className="flex-none text-xs font-medium text-forest-900 dark:text-cream-100" data-no-translate>
              {cursor + 1}/{timed.length}
            </span>
          </div>

          {/* Checkpoint dots the user can jump to */}
          {timed.length <= 24 && (
            <div className="mb-1.5 flex items-center justify-between">
              {timed.map((p, i) => (
                <button
                  key={`${p.lat},${p.lng},${p.t},${i}`}
                  type="button"
                  onClick={() => { setPlaying(false); setCursor(i); }}
                  title={p.when || p.label}
                  aria-label={`Jump to ${p.when || p.label}`}
                  className={`h-2.5 w-2.5 rounded-full transition-colors ${i <= cursor ? 'bg-gold-600 dark:bg-gold-500' : 'bg-forest-900/20 dark:bg-cream-50/20'} ${i === cursor ? 'ring-2 ring-forest-900/40 dark:ring-gold-500/50' : ''}`}
                />
              ))}
            </div>
          )}

          <p className="truncate text-center text-xs text-ink-600 dark:text-cream-300/80" data-no-translate>
            {current ? (
              <>
                <span className="font-medium text-forest-900 dark:text-cream-100">{current.when || current.label}</span>
                {current.title ? ` · ${current.title}` : ''}
                {(current.people ?? []).length ? ` · ${(current.people ?? []).join(', ')}` : ''}
              </>
            ) : null}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[11px] text-ink-500 dark:text-cream-300/70">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0f2d24] ring-1 ring-white" />Current stop</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#c9a227] ring-1 ring-white" />Earlier stop</span>
        {undated.length > 0 && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#9aa39d] ring-1 ring-white" />Undated</span>}
      </div>
    </section>
  );
}
